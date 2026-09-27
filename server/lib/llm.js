/**
 * The assistant seam. docs/08 §5.
 *
 * NEVER THROWS. NEVER REQUIRED. Order of resolution:
 *   1. Rules — a small table of recognised intents, each a real query against the
 *      engines/repos below. Answers from data, exactly and citably, no model involved.
 *   2. LLM — only if LLM_PROVIDER is configured. Given the question plus whatever the
 *      matched-nothing rules pass turned up, and told to answer only from that.
 *   3. Neither — a plain "I don't have that" with suggestions.
 *
 * Every answer states which path produced it, per docs/08 §5's labelling requirement.
 */

import { env } from '../config/env.js';
import { pool } from '../lib/db.js';
import { logger } from './logger.js';

const SUGGESTIONS = [
  'What is the response time in Al Barsha this week?',
  'Which zones are below target?',
  'Why was AMB-14 sent to that incident?',
  'How many cardiac arrests last month?',
];

async function ruleResponseTime(zoneName) {
  const { rows } = await pool.query(
    `SELECT z.ref, z.name,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
            PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90,
            COUNT(*)::int n
       FROM v_incident_response r JOIN zones z ON z.id = r.zone_id
      WHERE z.name ILIKE $1 AND r.reported_at >= now() - interval '7 days'
      GROUP BY z.ref, z.name`,
    [`%${zoneName}%`],
  );
  const row = rows[0];
  if (!row || row.n < 5) return null;
  return {
    answer: `${row.name}: p50 response ${Math.round(row.p50)}s, p90 ${Math.round(row.p90)}s, over ${row.n} calls in the last 7 days.`,
    evidence: [{ source: 'v_incident_response', rows: row.n, window: '7 days', zone: row.ref }],
  };
}

async function ruleBelowTarget() {
  const { rows } = await pool.query(
    `SELECT z.name, z.ref,
            100.0 * COUNT(*) FILTER (WHERE r.within_target) / NULLIF(COUNT(*), 0) AS pct, COUNT(*)::int n
       FROM v_incident_response r JOIN zones z ON z.id = r.zone_id
      WHERE r.reported_at >= now() - interval '30 days' AND z.level = 'community'
      GROUP BY z.name, z.ref HAVING COUNT(*) >= 30
      ORDER BY pct ASC LIMIT 5`,
  );
  const below = rows.filter((r) => r.pct < 80);
  if (!below.length) return { answer: 'No zone with at least 30 calls in the last 30 days is below 80% within target.', evidence: [{ source: 'v_incident_response', rows: rows.length, window: '30 days' }] };
  return {
    answer: `Below 80% within target over the last 30 days: ${below.map((r) => `${r.name} (${Math.round(r.pct)}%)`).join(', ')}.`,
    evidence: [{ source: 'v_incident_response', rows: below.length, window: '30 days' }],
  };
}

async function ruleWhySent(unitRef) {
  const { rows } = await pool.query(
    `SELECT a.dispatch_rationale AS r, i.ref AS inc_ref
       FROM assignments a JOIN units u ON u.id = a.unit_id JOIN incidents i ON i.id = a.incident_id
      WHERE u.ref ILIKE $1 AND a.dispatch_rationale IS NOT NULL
      ORDER BY a.offered_at DESC LIMIT 1`,
    [`%${unitRef}%`],
  );
  const row = rows[0];
  if (!row) return null;
  const r = row.r;
  const top = r?.chosen ?? r?.rank ?? null;
  return {
    answer: `${unitRef} on ${row.inc_ref}: ${r?.summary ?? `ranked #${top ?? '?'} by the dispatch engine — see the full rationale in the incident timeline.`}`,
    evidence: [{ source: 'assignments.dispatch_rationale', rows: 1, incident: row.inc_ref }],
  };
}

async function ruleCountKind(kind, months = 1) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int n FROM incidents
      WHERE kind ILIKE $1 AND reported_at >= now() - ($2 || ' months')::interval`,
    [`%${kind}%`, months],
  );
  return {
    answer: `${rows[0].n.toLocaleString()} ${kind} call(s) in the last ${months} month(s).`,
    evidence: [{ source: 'incidents', rows: rows[0].n, window: `${months} month(s)` }],
  };
}

const RULES = [
  { re: /response time.*?\bin\s+([a-z0-9 '-]+?)\??$/i, fn: (m) => ruleResponseTime(m[1].trim()) },
  { re: /below target|underperform/i, fn: () => ruleBelowTarget() },
  { re: /why was\s+([a-z0-9-]+)\s+sent/i, fn: (m) => ruleWhySent(m[1].trim()) },
  { re: /how many\s+([a-z_ ]+?)\s+(?:calls?\s+)?(?:last|in the last)\s+(\d+)?\s*(month|week)s?/i, fn: (m) => ruleCountKind(m[1].trim().replace(/\s+/g, '_'), m[3] === 'week' ? Math.max(1, Math.round((+(m[2] ?? 1)) / 4)) : +(m[2] ?? 1)) },
];

/** Try every rule; the first that both matches AND returns a real answer wins. */
async function tryRules(question) {
  for (const rule of RULES) {
    const m = question.match(rule.re);
    if (!m) continue;
    try {
      const r = await rule.fn(m);
      if (r) return r;
    } catch (err) {
      logger.warn({ err }, '[llm] rule failed');
    }
  }
  return null;
}

/** OpenAI-compatible chat completion. Best-effort, short timeout, never throws upward. */
async function tryProvider(question, retrieved) {
  if (!env.llm.enabled) return null;
  const base = env.llm.baseUrl || (env.llm.provider === 'groq' ? 'https://api.groq.com/openai/v1'
    : env.llm.provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
    : env.llm.provider === 'ollama' ? 'http://localhost:11434/v1'
    : null);
  if (!base) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(env.llm.apiKey ? { Authorization: `Bearer ${env.llm.apiKey}` } : {}) },
      body: JSON.stringify({
        model: env.llm.model || 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are the ERSS Dubai assistant. Answer ONLY from the supplied context. If it does not answer the question, say so plainly. Be concise.' },
          { role: 'user', content: `Context: ${JSON.stringify(retrieved ?? {})}\n\nQuestion: ${question}` },
        ],
        max_tokens: 300,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const answer = body?.choices?.[0]?.message?.content;
    return answer ? { answer, evidence: retrieved ? [{ source: 'context', rows: 1 }] : [] } : null;
  } catch (err) {
    logger.warn({ err }, '[llm] provider call failed — falling back');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string} question
 * @param {object} [context]  retrieved engine results the caller already has, for the LLM step
 * @returns {Promise<{answer:string, path:'rules'|'llm'|'none', evidence?:object[]}>}
 */
export async function ask(question, context) {
  if (!question || typeof question !== 'string') {
    return { answer: "I need a question to answer. Try: \"" + SUGGESTIONS[0] + '"', path: 'none' };
  }

  const ruled = await tryRules(question);
  if (ruled) return { ...ruled, path: 'rules' };

  const llm = await tryProvider(question, context);
  if (llm) return { ...llm, path: 'llm' };

  return {
    answer: `I don't have a computed answer for that yet. Try one of: ${SUGGESTIONS.join(' · ')}`,
    path: 'none',
  };
}
