/**
 * Automatic dispatch rules — what the AI may do by itself, and how it weighs a choice.
 *
 * The trial is automatic dispatch (config/poc.js), but "automatic" is a policy, and a
 * policy somebody cannot see or change is one they will not trust. So the policy is ONE
 * row (`dispatch_rules`) in one of two modes:
 *
 *   ai       the engine sets every value itself. It starts from the published defaults
 *            below and ADAPTS them to the moment: as the free share of the fleet falls,
 *            it shifts weight from raw arrival time to coverage, so the last free
 *            ambulance in an area is not spent on the first call that comes along. Every
 *            adjustment is returned as a sentence, so the screen can say what it did.
 *   custom   a duty officer fixed the values. They are applied exactly as chosen — no
 *            adaptation — until someone puts it back to the AI.
 *
 * Every rule here CHANGES BEHAVIOUR somewhere; nothing is a label:
 *
 *   autoDispatch[P]   off → that priority waits for a person (sim/live.js, runAutoDispatch)
 *   windowSec[P]      how long the AI shows its choice before committing it
 *   weights           the score vector engines/dispatch.js ranks candidates by
 *   requireAlsForP1   a hard filter: a P1 is only offered to an ALS-capable ambulance
 *   reserveMin        P3/P4 wait rather than take the fleet below this many free
 *   escalateArrivalSec  the duty officer is alerted when the best arrival is slower
 *   avoidTraffic      arrival is scored WITH the traffic on each candidate's road route
 */

import { one, query } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { emitTo, room } from '../realtime/index.js';
import { pocFleet, pocFleetSize } from '../config/poc.js';

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

/** The AI's starting point, and what "reset to AI" restores. Published, not hidden. */
export const AI_DEFAULTS = Object.freeze({
  autoDispatch: Object.freeze({ P1: true, P2: true, P3: true, P4: true }),
  windowSec: Object.freeze({ P1: 10, P2: 15, P3: 30, P4: 45 }),
  weights: Object.freeze({ travel: 0.55, capability: 0.20, coverage: 0.15, crew: 0.10 }),
  requireAlsForP1: false,
  reserveMin: 1,
  escalateArrivalSec: 720,
  avoidTraffic: true,
});

const LIMITS = {
  windowSec: [0, 180],
  reserveMin: [0, 4],
  escalateArrivalSec: [240, 1800],
};

let cache = { mode: 'ai', custom: null, updatedBy: null, updatedAt: null, loaded: false };

/** Read the stored row once; afterwards the cache is the truth and writes keep it so. */
export async function loadRules() {
  try {
    const row = await one('SELECT mode, custom, updated_by, updated_at FROM dispatch_rules WHERE id = 1');
    cache = {
      mode: row?.mode ?? 'ai',
      custom: row?.mode === 'custom' ? sanitise(row.custom) : null,
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      loaded: true,
    };
  } catch (err) {
    // The table may not exist on a database older than this build. The AI defaults are a
    // complete policy on their own, so dispatch carries on with them.
    logger.warn({ err: err.message }, '[rules] could not read dispatch_rules — using the AI defaults');
    cache = { ...cache, loaded: true };
  }
  return cache;
}

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;

/** Make any stored or submitted object a complete, in-range rule set. */
export function sanitise(input = {}) {
  const src = input ?? {};
  const out = {
    autoDispatch: { ...AI_DEFAULTS.autoDispatch },
    windowSec: { ...AI_DEFAULTS.windowSec },
    weights: { ...AI_DEFAULTS.weights },
    requireAlsForP1: typeof src.requireAlsForP1 === 'boolean' ? src.requireAlsForP1 : AI_DEFAULTS.requireAlsForP1,
    reserveMin: Number.isFinite(src.reserveMin) ? clamp(Math.round(src.reserveMin), LIMITS.reserveMin) : AI_DEFAULTS.reserveMin,
    escalateArrivalSec: Number.isFinite(src.escalateArrivalSec)
      ? clamp(Math.round(src.escalateArrivalSec), LIMITS.escalateArrivalSec) : AI_DEFAULTS.escalateArrivalSec,
    avoidTraffic: typeof src.avoidTraffic === 'boolean' ? src.avoidTraffic : AI_DEFAULTS.avoidTraffic,
  };
  for (const p of PRIORITIES) {
    if (typeof src.autoDispatch?.[p] === 'boolean') out.autoDispatch[p] = src.autoDispatch[p];
    if (Number.isFinite(src.windowSec?.[p])) out.windowSec[p] = clamp(Math.round(src.windowSec[p]), LIMITS.windowSec);
  }
  // Weights are a vector that sums to one. Whatever proportions were entered are kept;
  // only the scale is fixed, so "travel 3, coverage 1" means 75 / 25.
  const w = src.weights ?? {};
  const raw = Object.fromEntries(Object.keys(AI_DEFAULTS.weights).map((k) =>
    [k, Number.isFinite(w[k]) && w[k] >= 0 ? w[k] : AI_DEFAULTS.weights[k]]));
  const sum = Object.values(raw).reduce((s, v) => s + v, 0);
  if (sum > 0) for (const k of Object.keys(raw)) out.weights[k] = r2(raw[k] / sum);
  return out;
}

// ── The fleet the AI adapts to ───────────────────────────────────────────────

let fleetCache = { at: 0, free: null, total: null };

/** Free trial ambulances right now. Cached for five seconds; dispatch runs every second. */
async function fleetNow() {
  if (Date.now() - fleetCache.at < 5000 && fleetCache.free != null) return fleetCache;
  try {
    const row = await one(
      `SELECT COUNT(*) FILTER (WHERE u.status IN ('available', 'standby'))::int AS free,
              COUNT(*)::int AS total
         FROM units u JOIN agencies a ON a.id = u.agency_id
        WHERE a.code = 'DCAS' AND u.archived_at IS NULL
          AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))`,
      [pocFleet()],
    );
    fleetCache = { at: Date.now(), free: row?.free ?? 0, total: row?.total || pocFleetSize() };
  } catch {
    fleetCache = { at: Date.now(), free: null, total: pocFleetSize() };
  }
  return fleetCache;
}

/**
 * The rules in force THIS moment, and why each AI-set value is what it is.
 *
 * @returns {Promise<{ mode: 'ai'|'custom', rules: ReturnType<typeof sanitise>, notes: string[],
 *   fleet: { free: number|null, total: number }, updatedBy: string|null, updatedAt: string|null }>}
 */
export async function effectiveRules() {
  if (!cache.loaded) await loadRules();
  const fleet = await fleetNow();
  if (cache.mode === 'custom' && cache.custom) {
    return { mode: 'custom', rules: cache.custom, notes: [], fleet: { free: fleet.free, total: fleet.total }, updatedBy: cache.updatedBy, updatedAt: cache.updatedAt };
  }

  const rules = sanitise(AI_DEFAULTS);
  const notes = [];
  if (fleet.free != null && fleet.total > 0) {
    // Fleet pressure: 0 with every ambulance free, 1 with none. Coverage gains up to 0.15
    // of weight, taken from arrival — the two are the trade the whole engine makes.
    const pressure = clamp(1 - fleet.free / fleet.total, [0, 1]);
    const shift = r2(0.15 * pressure);
    if (shift >= 0.02) {
      rules.weights.coverage = r2(AI_DEFAULTS.weights.coverage + shift);
      rules.weights.travel = r2(AI_DEFAULTS.weights.travel - shift);
      notes.push(`Only ${fleet.free} of ${fleet.total} ambulances are free, so coverage is weighted `
        + `${Math.round(rules.weights.coverage * 100)}% (normally ${Math.round(AI_DEFAULTS.weights.coverage * 100)}%): `
        + 'the AI avoids emptying an area that has no other ambulance near it.');
    } else {
      notes.push(`${fleet.free} of ${fleet.total} ambulances are free — the standard weights apply, arrival time leads.`);
    }
    if (fleet.free <= rules.reserveMin) {
      notes.push(`At or below the reserve of ${rules.reserveMin} free: P3 and P4 wait for a crew to clear; P1 and P2 are never held.`);
    }
  }
  notes.push('Traffic on each candidate’s road route is added to its predicted arrival before scoring.');
  return { mode: 'ai', rules, notes, fleet: { free: fleet.free, total: fleet.total }, updatedBy: cache.updatedBy, updatedAt: cache.updatedAt };
}

/** The whole picture for the settings panel: what is in force, and the AI's own values. */
export async function describeRules() {
  const eff = await effectiveRules();
  return {
    ...eff,
    aiDefaults: sanitise(AI_DEFAULTS),
    custom: cache.custom,
    limits: LIMITS,
  };
}

async function persist(mode, custom, actor) {
  await query(
    `INSERT INTO dispatch_rules (id, mode, custom, updated_by, updated_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, custom = EXCLUDED.custom,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [mode, JSON.stringify(custom ?? {}), actor?.ref ?? null],
  );
  cache = { mode, custom: mode === 'custom' ? custom : null, updatedBy: actor?.ref ?? null, updatedAt: new Date().toISOString(), loaded: true };
  fleetCache.at = 0;
  const out = await describeRules();
  emitTo(room.consoleFleet, 'dispatch:rules', out);
  return out;
}

/** A duty officer fixes the rules. Everything submitted is sanitised; nothing is trusted. */
export async function setCustomRules(input, actor) {
  const before = cache.mode === 'custom' ? cache.custom : sanitise(AI_DEFAULTS);
  const next = sanitise({ ...before, ...input, autoDispatch: { ...before.autoDispatch, ...input?.autoDispatch },
    windowSec: { ...before.windowSec, ...input?.windowSec }, weights: { ...before.weights, ...input?.weights } });
  const out = await persist('custom', next, actor);
  await audit({ action: 'dispatch.rules.set', entity: 'dispatch_rules', entityId: '1', actor, payload: { rules: next } })
    .catch(() => {});
  return out;
}

/** Hand the policy back to the AI. */
export async function resetToAi(actor) {
  const out = await persist('ai', {}, actor);
  await audit({ action: 'dispatch.rules.ai', entity: 'dispatch_rules', entityId: '1', actor, payload: {} }).catch(() => {});
  return out;
}
