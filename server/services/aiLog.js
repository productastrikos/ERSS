/**
 * The AI log, KEPT — what every screen's AI said about an incident, and when.
 *
 * Two AIs speak during a response and, until now, both were written for the moment only:
 *
 *   console   the dispatch reasoning (services/decisions.js `trace`) — rebuilt on every
 *             read from the database and an in-memory preview that a restart forgets
 *   crew      the crew app's AI co-pilot (services/crewAssist.js) — the briefing, the road
 *             advice, scene safety and backup, the drafted handover — computed on the
 *             phone's poll and never written anywhere
 *
 * This service writes both into `incident_ai_log` as they happen, so an after-action
 * replay can play the response back with the reasoning beside it: what the AI saw, what it
 * weighed, what it told the crew, and what happened next. Three kinds of row:
 *
 *   console:<step>     every finished step of the dispatch log, rewritten as it settles
 *   console:drive@…    a checkpoint of the drive every ~15 s (speed, distance, next manoeuvre)
 *   console:__decision the whole decision snapshot — every ambulance, every road compared
 *   crew:<stage>       the co-pilot's output at each stage of the job
 *   review:<id>        the after-action findings, written when the incident closes
 *
 * Nothing here invents a line: every row is the text a screen showed, or the review
 * computed from the record (services/afterAction.js). Failures are logged and swallowed —
 * keeping the log must never get in the way of the response it is logging.
 */

import { pool, one } from '../lib/db.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/logger.js';
import * as decisions from './decisions.js';
import { assistFor } from './crewAssist.js';
import { review } from './afterAction.js';

const DEBOUNCE_MS = 1200;
const CHECKPOINT_MS = 15_000;

const timers = new Map();
let tableOk = null;

async function incidentId(ref) {
  return (await one('SELECT id FROM incidents WHERE ref = $1', [ref]))?.id ?? null;
}

async function upsert(incId, source, rows, { keep = null } = {}) {
  if (!incId || !rows.length || tableOk === false) return;
  try {
    for (const r of rows) {
      // `keep`: rows already written are left as they are — a step rebuilt from the record
      // after a restart is a thinner version of the one kept when it happened.
      const onConflict = keep?.has(r.key)
        ? 'DO NOTHING'
        : `DO UPDATE SET
           ts = EXCLUDED.ts, title = EXCLUDED.title, detail = EXCLUDED.detail, tone = EXCLUDED.tone,
           items = EXCLUDED.items, meta = EXCLUDED.meta, recorded_at = now()`;
      await pool.query(
        `INSERT INTO incident_ai_log (incident_id, source, key, ts, title, detail, tone, items, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (incident_id, source, key) ${onConflict}`,
        [incId, source, r.key, r.ts, r.title, r.detail ?? null, r.tone ?? null, JSON.stringify(r.items ?? []), r.meta ? JSON.stringify(r.meta) : null],
      );
    }
    tableOk = true;
  } catch (err) {
    if (/incident_ai_log/.test(err.message) && /does not exist/.test(err.message)) {
      tableOk = false;
      logger.warn('[ailog] incident_ai_log is missing — run `npm run db:schema`; AI logs are not being kept');
      return;
    }
    logger.warn({ err: err.message }, '[ailog] write failed');
  }
}

// ── Console: the dispatch reasoning ──────────────────────────────────────────

export async function recordConsole(ref) {
  const incId = await incidentId(ref);
  if (!incId) return;
  const tr = await decisions.trace(ref, null);
  const rows = tr.steps
    .filter((s) => s.state !== 'active')
    .map((s) => ({ key: s.key, ts: s.at, title: s.title, detail: s.detail, tone: s.tone, items: s.items, meta: s.unitRefs ? { unitRefs: s.unitRefs } : null }));
  const snap = decisions.snapshot(ref);
  // Without the in-memory decision (lost on a restart) the dispatch steps can only be
  // rebuilt from the stored rationale — never let that thinner version replace the kept one.
  const keep = decisions.previewFor(ref) && !decisions.previewFor(ref).stub ? null : new Set(rows.map((r) => r.key).filter((k) => !/^(dispatched|ack|declined|onscene|patient|hospital|cleared|timeout|closed)/.test(k)));
  if (snap) {
    rows.push({
      key: '__decision', ts: snap.readyAt ?? snap.startedAt ?? tr.incident.reportedAt,
      title: 'Decision snapshot', detail: `${snap.candidates.length} ambulances ranked · ${snap.fleet.length} checked`,
      tone: 'ai', items: [], meta: snap,
    });
  }
  await upsert(incId, 'console', rows, { keep });
}

/** Where the drive has got to: the active "driving" step, kept as a timestamped checkpoint. */
async function checkpoint(ref) {
  const incId = await incidentId(ref);
  if (!incId) return;
  const tr = await decisions.trace(ref, null);
  const live = tr.steps.filter((s) => s.state === 'active' && /^(driving|transportdrive):/.test(s.key));
  const at = new Date().toISOString();
  await upsert(incId, 'console', live.map((s) => ({
    key: `drive@${at}`, ts: at, title: s.title, detail: s.detail, tone: s.tone, items: s.items,
    meta: { leg: s.key.startsWith('transport') ? 'hospital' : 'scene', unitRefs: s.unitRefs ?? [] },
  })));
}

// ── Crew: the AI co-pilot on the phone ───────────────────────────────────────

const STAGE = {
  offered: 'briefing', acknowledged: 'briefing', enroute: 'route:scene', onscene: 'scene',
  transporting: 'route:hospital', at_hospital: 'handover',
};

export async function recordCrew(asgRef, { checkpointAt = null } = {}) {
  const row = await one(
    `SELECT a.state, a.unit_id, a.at_patient_at, i.ref AS inc_ref, i.id AS inc_id
       FROM assignments a JOIN incidents i ON i.id = a.incident_id WHERE a.ref = $1`, [asgRef]);
  if (!row) return;
  const assist = await assistFor(row.unit_id).catch(() => null);
  if (!assist || assist.assignmentRef !== asgRef) return;
  const now = new Date().toISOString();
  const b = assist.briefing;
  const rows = [];
  const stage = row.state === 'onscene' && row.at_patient_at ? 'patient' : STAGE[row.state];

  if (checkpointAt) {
    if (assist.route?.advice) {
      rows.push({
        key: `drive@${checkpointAt}`, ts: checkpointAt, tone: 'info',
        title: assist.route.to === 'scene' ? 'Co-pilot · road to the scene' : `Co-pilot · road to ${assist.route.to}`,
        detail: assist.route.advice,
        items: [
          ...(assist.route.remainingM != null ? [{ label: 'To go', value: `${(assist.route.remainingM / 1000).toFixed(1)} km` }] : []),
          ...(assist.route.etaSec != null ? [{ label: 'ETA', value: `${Math.floor(assist.route.etaSec / 60)}:${String(assist.route.etaSec % 60).padStart(2, '0')} min` }] : []),
        ],
        meta: { stage: 'drive', spoken: false },
      });
    }
    await upsert(row.inc_id, 'crew', rows);
    return;
  }

  if (stage === 'briefing') {
    rows.push({
      key: 'briefing', ts: now, tone: 'ai',
      title: `Briefing · ${b.headline}`,
      detail: b.whyYou,
      items: [
        ...b.points.map((p) => ({ label: p.source, value: p.text })),
        { label: 'Prepare', value: b.prepare.join(' · ') },
        ...b.safety.map((s) => ({ label: 'Scene safety', value: s, tone: 'warn' })),
        ...(b.backup ? [{ label: 'Backup', value: b.backup, tone: 'warn' }] : []),
      ],
      meta: { stage, spoken: `New job. ${b.headline}. ${b.whyYou}. Prepare ${b.prepare.join(', ')}.` },
    });
  }
  if ((stage === 'route:scene' || stage === 'route:hospital') && assist.route) {
    rows.push({
      key: stage, ts: now, tone: 'info',
      title: stage === 'route:scene' ? 'Co-pilot · road to the scene' : `Co-pilot · road to ${assist.route.to}`,
      detail: assist.route.advice ?? null,
      items: [
        ...(assist.route.remainingM != null ? [{ label: 'Distance', value: `${(assist.route.remainingM / 1000).toFixed(1)} km` }] : []),
        ...(assist.route.trafficAhead?.length ? [{ label: 'Traffic', value: `${assist.route.trafficAhead.length} slow stretch(es) ahead (simulated)` }] : [{ label: 'Traffic', value: 'clear (simulated)' }]),
      ],
      meta: { stage, spoken: assist.route.advice ?? null },
    });
  }
  if (stage === 'scene') {
    rows.push({
      key: 'scene', ts: now, tone: b.safety.length || b.backup ? 'warn' : 'info',
      title: 'Co-pilot · on scene',
      detail: [b.safety[0], b.backup].filter(Boolean).join('. ') || 'Scene safe to approach — no extra hazards on record',
      items: b.safety.map((s) => ({ label: 'Scene safety', value: s })),
      meta: { stage, spoken: [b.safety[0], b.backup].filter(Boolean).join('. ') || null },
    });
  }
  if (stage === 'route:hospital' || stage === 'handover' || stage === 'patient') {
    rows.push({
      key: stage === 'handover' ? 'handover' : 'handover-draft', ts: now, tone: 'ai',
      title: stage === 'handover' ? 'Handover — drafted by AI from the record' : 'Handover draft started',
      detail: assist.handover.ready ? 'Facts from the record — the crew checks and completes clinical findings' : 'In progress — completed as the job goes on',
      items: assist.handover.lines.map(([k, v]) => ({ label: k, value: v })),
      meta: { stage },
    });
  }
  await upsert(row.inc_id, 'crew', rows);
}

// ── Review: the after-action findings ────────────────────────────────────────

export async function recordReview(ref) {
  const incId = await incidentId(ref);
  if (!incId) return;
  const r = await review(ref);
  if (!r) return;
  await upsert(incId, 'review', r.findings.map((f, i) => ({
    key: f.id ?? `finding-${i}`, ts: r.at, title: f.title, detail: f.detail, tone: f.tone,
    items: f.metric ? [f.metric] : [], meta: { kind: f.kind, order: i },
  })));
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function soon(key, fn, delay = DEBOUNCE_MS) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  const timer = setTimeout(() => {
    timers.delete(key);
    fn().catch((err) => logger.warn({ err: err.message, key }, '[ailog] record failed'));
  }, delay);
  timer.unref?.();
  timers.set(key, timer);
}

let wired = false;
export function wireAiLog() {
  if (wired) return;
  wired = true;

  bus.on('incident:new', (s) => { if (s?.ref && !s.isResting) soon(`c:${s.ref}`, () => recordConsole(s.ref), 4000); });
  bus.on('decision:ready', ({ incidentRef }) => soon(`c:${incidentRef}`, () => recordConsole(incidentRef)));
  bus.on('assignment:offer', ({ incident, assignment }) => {
    if (incident?.ref) soon(`c:${incident.ref}`, () => recordConsole(incident.ref));
    if (assignment?.ref) soon(`k:${assignment.ref}`, () => recordCrew(assignment.ref), 1500);
  });
  bus.on('assignment:update', (p) => {
    if (p?.incidentRef) soon(`c:${p.incidentRef}`, () => recordConsole(p.incidentRef));
    // The road legs wait for the crew's route to be planned, so the co-pilot's advice exists.
    if (p?.ref && STAGE[p.state]) soon(`k:${p.ref}:${p.state}`, () => recordCrew(p.ref), p.state === 'enroute' || p.state === 'transporting' ? 6000 : 1500);
  });
  bus.on('incident:closed', (s) => {
    if (!s?.ref) return;
    soon(`c:${s.ref}`, () => recordConsole(s.ref), 800);
    soon(`r:${s.ref}`, () => recordReview(s.ref), 2500);
  });

  // The drive, narrated: a checkpoint of every response on the road, every ~15 s.
  const timer = setInterval(async () => {
    try {
      const { rows } = await pool.query(`
        SELECT a.ref AS asg_ref, i.ref AS inc_ref
          FROM assignments a JOIN incidents i ON i.id = a.incident_id
         WHERE a.state IN ('enroute', 'transporting') AND NOT i.is_resting AND NOT i.is_seed
         LIMIT 6`);
      const at = new Date().toISOString();
      for (const r of rows) {
        await checkpoint(r.inc_ref);
        await recordCrew(r.asg_ref, { checkpointAt: at });
      }
    } catch (err) {
      logger.debug({ err: err.message }, '[ailog] checkpoint failed');
    }
  }, CHECKPOINT_MS);
  timer.unref?.();
}

/** Everything kept for one incident, oldest first. */
export async function logFor(ref) {
  if (tableOk === false) return null;
  try {
    const { rows } = await pool.query(
      `SELECT l.source, l.key, l.ts, l.title, l.detail, l.tone, l.items, l.meta
         FROM incident_ai_log l JOIN incidents i ON i.id = l.incident_id
        WHERE i.ref = $1 ORDER BY l.ts, l.id`, [ref]);
    return rows.map((r) => ({
      source: r.source, key: r.key, ts: new Date(r.ts).toISOString(), title: r.title, detail: r.detail,
      tone: r.tone, items: r.items ?? [], meta: r.meta ?? null,
    }));
  } catch (err) {
    logger.warn({ err: err.message }, '[ailog] read failed');
    return null;
  }
}
