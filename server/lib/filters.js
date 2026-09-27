/**
 * The universal analytical filter — ONE contract every chart in the product shares.
 *
 * Client requirement: "wherever a graph/trend/bar/chart is, it should have as many
 * filters as possible, with predictions." That only stays honest if every endpoint
 * accepts the SAME filter set, so a filter chosen once on the console applies to the
 * almanac, the monthly forecast, the call mix, the radial circle and the performance
 * stages alike — and so any panel can always name its own slice.
 *
 * Two shapes of source table are addressed, because the aggregates read from both:
 *   'incidents'  → the base table, aliased `i`
 *   'response'   → v_incident_response, aliased `r` (pre-computed stage seconds)
 *
 * Every builder instance owns its own parameter array: Postgres rejects a bind with more
 * parameters than the statement uses, so a query that deliberately drops part of the
 * filter (the emirate baseline in `radial`, say) must build its own.
 *
 * Enum columns are compared as text. `priority = ANY($1)` against an enum column cannot
 * resolve an operator; `priority::text = ANY($1)` is the form that works.
 */

import { z } from 'zod';

const GST = 'Asia/Dubai';

/** Comma-separated list → array, trimmed and de-duplicated, capped so a URL cannot fan
 *  a query out indefinitely. */
const list = (max = 40) => z.preprocess(
  (v) => {
    if (v == null || v === '') return undefined;
    const raw = Array.isArray(v) ? v : String(v).split(',');
    const out = [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))];
    return out.length ? out.slice(0, max) : undefined;
  },
  z.array(z.string().max(120)).optional(),
);

const intList = (max = 24) => z.preprocess(
  (v) => {
    if (v == null || v === '') return undefined;
    const raw = Array.isArray(v) ? v : String(v).split(',');
    const out = [...new Set(raw.map((s) => Number(String(s).trim())).filter((n) => Number.isFinite(n)))];
    return out.length ? out.slice(0, max) : undefined;
  },
  z.array(z.number()).optional(),
);

/** Tri-state: absent means "either", which is NOT the same as false. */
const bool3 = z.preprocess(
  (v) => {
    if (v == null || v === '' || v === 'any') return undefined;
    if (v === 'true' || v === '1' || v === 'yes' || v === true) return true;
    if (v === 'false' || v === '0' || v === 'no' || v === false) return false;
    return undefined;
  },
  z.boolean().optional(),
);

/**
 * Every dimension a chart can be sliced by. All optional: an endpoint's own window
 * default (days/weeks/months) still applies when `from`/`to` are absent.
 */
export const FILTER_SHAPE = {
  // Window
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),

  // Categorical, multi-select
  kind: list(),
  priority: list(8),
  source: list(16),
  outcome: list(16),
  zone: list(),          // zone ref; a sector ref also matches everything beneath it
  zoneClass: list(12),
  unitKind: list(16),
  agency: list(12),
  station: list(30),
  escalation: list(8),
  complaint: list(30),

  // Temporal slices, inside the window
  dow: intList(7),              // 0=Sunday … 6=Saturday, GST
  hourFrom: z.coerce.number().int().min(0).max(23).optional(),
  hourTo: z.coerce.number().int().min(0).max(23).optional(),

  // Numeric bands
  floorMin: z.coerce.number().int().min(0).max(200).optional(),
  floorMax: z.coerce.number().int().min(0).max(200).optional(),
  acuityMin: z.coerce.number().int().min(1).max(5).optional(),
  acuityMax: z.coerce.number().int().min(1).max(5).optional(),
  patientsMin: z.coerce.number().int().min(1).max(500).optional(),
  responseMinSec: z.coerce.number().int().min(0).max(86400).optional(),
  responseMaxSec: z.coerce.number().int().min(0).max(86400).optional(),

  // Booleans
  withinTarget: bool3,
  highrise: bool3,          // floor >= 10 — the vertical-city slice
  transported: bool3,
  multiAgency: bool3,
  seeded: bool3,            // synthesised history vs live-recorded
  includeResting: bool3,    // the demo resting state, normally excluded
};

export const filterSchema = z.object(FILTER_SHAPE);

/** Pull only the filter keys out of a query string, leaving an endpoint's own knobs alone. */
export function parseFilters(query) {
  const picked = {};
  for (const k of Object.keys(FILTER_SHAPE)) if (query?.[k] !== undefined) picked[k] = query[k];
  const r = filterSchema.safeParse(picked);
  if (!r.success) {
    const err = new Error('Invalid filter');
    err.fieldErrors = r.error.flatten().fieldErrors;
    throw err;
  }
  return r.data;
}

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Column maps ───────────────────────────────────────────────────────────────

const COLUMNS = {
  incidents: (a) => ({
    kind: `${a}.kind`,
    priority: `${a}.priority::text`,
    source: `${a}.source`,
    outcome: `${a}.outcome`,
    escalation: `${a}.escalation_level`,
    complaint: `COALESCE(NULLIF(${a}.chief_complaint, ''), ${a}.kind)`,
    zoneId: `${a}.zone_id`,
    zoneClass: null,
    floor: `${a}.floor`,
    acuity: `${a}.acuity`,
    patients: `${a}.patients_count`,
    reportedAt: `${a}.reported_at`,
    hour: `EXTRACT(HOUR FROM ${a}.reported_at AT TIME ZONE '${GST}')::int`,
    dow: `EXTRACT(DOW  FROM ${a}.reported_at AT TIME ZONE '${GST}')::int`,
    responseSec: `EXTRACT(EPOCH FROM ${a}.first_onscene_at - ${a}.reported_at)`,
    agencies: `${a}.agencies_involved`,
    seeded: `${a}.is_seed`,
    resting: `${a}.is_resting`,
    // The view's within_target column and this are the same function (db/views.sql).
    withinTarget: `erss_within_target(${a}.priority, ${a}.reported_at, ${a}.first_onscene_at)`,
    unitKind: null,           // reached through the assignment
    unitId: null,             // ditto
    id: `${a}.id`,
  }),
  response: (a) => ({
    kind: `${a}.kind`,
    priority: `${a}.priority::text`,
    source: `${a}.source`,
    outcome: `${a}.outcome`,
    escalation: null,        // not projected by the view
    complaint: null,
    zoneId: `${a}.zone_id`,
    zoneClass: `${a}.zone_class`,
    floor: `${a}.floor`,
    acuity: null,
    patients: null,
    reportedAt: `${a}.reported_at`,
    hour: `${a}.gst_hour`,
    dow: `${a}.gst_dow`,
    responseSec: `${a}.response_sec`,
    agencies: null,
    seeded: `${a}.is_seed`,
    resting: null,
    withinTarget: `${a}.within_target`,
    unitKind: `${a}.unit_kind::text`,
    unitId: `${a}.unit_id`,   // already the PRIMARY assignment's unit
    id: `${a}.id`,
  }),
};

const DEFAULT_ALIAS = { incidents: 'i', response: 'r' };

// ── The builder ───────────────────────────────────────────────────────────────

/**
 * Build the WHERE fragment for ONE query.
 *
 * @param filters      output of parseFilters()
 * @param opts.source  'incidents' | 'response'
 * @param opts.alias   table alias used in the caller's SQL (default 'i' / 'r')
 * @param opts.window  fallback relative window when from/to are absent, e.g.
 *                     { days: 30 } | { weeks: 12 } | { months: 18 }
 * @param opts.skipWindow  true when the caller writes its own time predicate
 * @param opts.shift   whole-window offset, for prior-period queries:
 *                     { periods: 1, unit: 'days', span: 30 } shifts back one span
 * @returns { where, params, push, describe, active, window }
 */
export function buildFilter(filters = {}, opts = {}) {
  const source = opts.source ?? 'incidents';
  const alias = opts.alias ?? DEFAULT_ALIAS[source];
  const col = COLUMNS[source](alias);
  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const and = [];
  const described = [];
  const describe = (label, value) => described.push({ label, value });

  // ── Time window ───────────────────────────────────────────────────────────
  const unit = opts.window?.days != null ? 'days'
    : opts.window?.weeks != null ? 'weeks'
      : opts.window?.months != null ? 'months' : null;
  const span = unit ? opts.window[unit] : null;
  const shift = opts.shift ?? 0;   // in whole windows, back in time

  if (!opts.skipWindow) {
    if (filters.from || filters.to) {
      const ms = (filters.to ? Date.parse(filters.to) : Date.now()) - (filters.from ? Date.parse(filters.from) : Date.now());
      const fromIso = filters.from ? new Date(Date.parse(filters.from) - shift * ms).toISOString() : null;
      const toIso = filters.to ? new Date(Date.parse(filters.to) - shift * ms).toISOString()
        : shift ? new Date(Date.now() - shift * ms).toISOString() : null;
      if (fromIso) and.push(`${col.reportedAt} >= ${push(fromIso)}::timestamptz`);
      if (toIso) and.push(`${col.reportedAt} < ${push(toIso)}::timestamptz`);
      describe('Window', `${(fromIso ?? '').slice(0, 10) || '…'} → ${(toIso ?? '').slice(0, 10) || 'now'}`);
    } else if (unit) {
      const back = (n) => `now() - (${push(String(n))} || ' ${unit}')::interval`;
      and.push(`${col.reportedAt} >= ${back(span * (shift + 1))}`);
      if (shift) and.push(`${col.reportedAt} < ${back(span * shift)}`);
    }
  }

  // ── The demo resting state is history's impostor: excluded unless asked for ─
  if (filters.includeResting !== true) {
    and.push(col.resting
      ? `NOT ${col.resting}`
      : `NOT EXISTS (SELECT 1 FROM incidents ri WHERE ri.id = ${alias}.id AND ri.is_resting)`);
  }

  // ── Categorical ───────────────────────────────────────────────────────────
  const inList = (column, values, label) => {
    if (!values?.length || !column) return;
    and.push(`${column} = ANY(${push(values)})`);
    describe(label, values.join(', '));
  };
  inList(col.kind, filters.kind, 'Call type');
  inList(col.priority, filters.priority, 'Priority');
  inList(col.source, filters.source, 'Origin');
  inList(col.outcome, filters.outcome, 'Outcome');
  inList(col.escalation, filters.escalation, 'Escalation');
  inList(col.complaint, filters.complaint, 'Complaint');

  // A zone ref matches the zone itself OR anything beneath it, so picking a sector
  // filters its communities without the caller enumerating them.
  if (filters.zone?.length) {
    const p = push(filters.zone);
    and.push(`${col.zoneId} IN (
      WITH RECURSIVE picked AS (
        SELECT id FROM zones WHERE ref = ANY(${p})
        UNION ALL
        SELECT z.id FROM zones z JOIN picked pk ON z.parent_id = pk.id
      ) SELECT id FROM picked)`);
    describe('Zone', filters.zone.join(', '));
  }

  if (filters.zoneClass?.length) {
    if (col.zoneClass) and.push(`${col.zoneClass} = ANY(${push(filters.zoneClass)})`);
    else and.push(`${col.zoneId} IN (SELECT id FROM zones WHERE class = ANY(${push(filters.zoneClass)}))`);
    describe('Zone class', filters.zoneClass.join(', '));
  }

  // ── Who responded ─────────────────────────────────────────────────────────
  // Unit kind, agency and station are properties of the PRIMARY responding unit, in both
  // sources, so the same filter means the same thing on every chart.
  //
  // Each resolves to a SET OF UNIT IDS first, and only then touches assignments — and it
  // is spelled `= ANY(ARRAY(subquery))`, not `IN (subquery)`, deliberately.
  //
  // With `IN (subquery)` the planner flattens the EXISTS into a semi-join and then drives
  // it from the WRONG side: it materialises all 409k primary assignments for the matching
  // units and probes incidents_pkey once per assignment, 2.3 seconds to answer a question
  // about 17k rows (verified with EXPLAIN ANALYZE). `ANY(ARRAY(…))` is an expression, not
  // a flattenable sublink, so the unit set is computed once as an InitPlan and the EXISTS
  // stays correlated — one asg_inc_idx probe per incident in the window instead.
  const unitArray = (sql, values) => `ARRAY(SELECT fu.id FROM units fu ${sql}(${push(values)}))`;
  const primaryUnitIn = (arr) => (col.unitId
    ? `${col.unitId} = ANY(${arr})`
    : `EXISTS (SELECT 1 FROM assignments fa
                WHERE fa.incident_id = ${col.id} AND fa.is_primary AND fa.unit_id = ANY(${arr}))`);

  if (filters.unitKind?.length) {
    // The view projects the primary unit's kind already — no lookup needed there.
    and.push(col.unitKind
      ? `${col.unitKind} = ANY(${push(filters.unitKind)})`
      : primaryUnitIn(unitArray('WHERE fu.kind::text = ANY', filters.unitKind)));
    describe('Unit type', filters.unitKind.join(', '));
  }
  if (filters.agency?.length) {
    and.push(primaryUnitIn(unitArray('JOIN agencies fg ON fg.id = fu.agency_id WHERE fg.code::text = ANY', filters.agency)));
    describe('Agency', filters.agency.join(', '));
  }
  if (filters.station?.length) {
    and.push(primaryUnitIn(unitArray('JOIN stations fs ON fs.id = fu.home_station_id WHERE fs.ref = ANY', filters.station)));
    describe('Station', filters.station.join(', '));
  }

  // ── Temporal slices ───────────────────────────────────────────────────────
  if (filters.dow?.length) {
    and.push(`${col.dow} = ANY(${push(filters.dow)})`);
    describe('Weekday', filters.dow.map((d) => DOW_SHORT[d] ?? d).join(', '));
  }
  const hf = filters.hourFrom, ht = filters.hourTo;
  if (hf != null || ht != null) {
    const from = hf ?? 0, to = ht ?? 23;
    // A band that wraps midnight (22 → 04) is a real shift pattern, not a mistake.
    and.push(from <= to
      ? `${col.hour} BETWEEN ${push(from)} AND ${push(to)}`
      : `(${col.hour} >= ${push(from)} OR ${col.hour} <= ${push(to)})`);
    describe('Hours', `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:59 GST`);
  }

  // ── Numeric bands ─────────────────────────────────────────────────────────
  const band = (column, min, max, label, fmt = (v) => v) => {
    if (!column) return;
    if (min != null) and.push(`${column} >= ${push(min)}`);
    if (max != null) and.push(`${column} <= ${push(max)}`);
    if (min != null || max != null) describe(label, `${min != null ? fmt(min) : '…'} – ${max != null ? fmt(max) : '…'}`);
  };
  band(col.floor, filters.floorMin, filters.floorMax, 'Floor');
  band(col.acuity, filters.acuityMin, filters.acuityMax, 'Acuity');
  band(col.responseSec, filters.responseMinSec, filters.responseMaxSec, 'Response', (v) => `${v}s`);
  if (filters.patientsMin != null && col.patients) {
    and.push(`${col.patients} >= ${push(filters.patientsMin)}`);
    describe('Patients', `at least ${filters.patientsMin}`);
  }

  // ── Booleans ──────────────────────────────────────────────────────────────
  if (filters.highrise != null) {
    and.push(filters.highrise ? `${col.floor} >= 10` : `(${col.floor} IS NULL OR ${col.floor} < 10)`);
    describe('High-rise', filters.highrise ? 'floor 10 and above' : 'ground and low-rise');
  }
  if (filters.withinTarget != null) {
    // Same rule either way — db/views.sql owns the definition, and the base table gets it
    // from the function rather than from a correlated lookup into the view.
    and.push(`${col.withinTarget} IS ${filters.withinTarget ? 'TRUE' : 'FALSE'}`);
    describe('Target', filters.withinTarget ? 'met' : 'missed');
  }
  if (filters.transported != null) {
    and.push(filters.transported ? `${col.outcome} = 'transported'` : `${col.outcome} IS DISTINCT FROM 'transported'`);
    describe('Transport', filters.transported ? 'transported' : 'not transported');
  }
  if (filters.multiAgency != null) {
    const pred = col.agencies
      ? `array_length(${col.agencies}, 1) > 1`
      : `(SELECT array_length(mi.agencies_involved, 1) FROM incidents mi WHERE mi.id = ${alias}.id) > 1`;
    and.push(filters.multiAgency ? pred : `NOT COALESCE(${pred}, false)`);
    describe('Agencies', filters.multiAgency ? 'multi-agency only' : 'single agency');
  }
  if (filters.seeded != null) {
    and.push(`${col.seeded} IS ${filters.seeded ? 'TRUE' : 'FALSE'}`);
    describe('Source data', filters.seeded ? 'seeded history' : 'live-recorded');
  }

  return {
    where: and.length ? ` AND ${and.join(' AND ')}` : '',
    params,
    push,
    /** What the panel prints under its title, so a slice is never anonymous. */
    describe: described,
    /** True when anything beyond the endpoint's own default window is applied. */
    active: described.length > 0,
    window: { from: filters.from ?? null, to: filters.to ?? null, unit, span },
  };
}

/** Day span of the effective window — the divisor behind every "per day" figure. */
export function windowDays(filters, fallbackDays) {
  if (filters?.from) {
    const to = filters.to ? Date.parse(filters.to) : Date.now();
    return Math.max(1, Math.round((to - Date.parse(filters.from)) / 86400000));
  }
  return fallbackDays;
}

/** A one-line human summary of a filter set, for a chart subtitle or an export header. */
export function summarise(describe) {
  if (!describe?.length) return 'No filter — everything in the window';
  return describe.map((d) => `${d.label}: ${d.value}`).join(' · ');
}
