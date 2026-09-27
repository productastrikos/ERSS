/**
 * The incident, assignment and unit state machines — docs/03-DOMAIN-MODEL §3.
 *
 * Pure: no database, no clock, no socket. The routes, the acknowledge-timeout sweeper
 * and (Phase 10) the scenario runner all move state through these tables, so a
 * transition that is illegal here is illegal everywhere. The console renders its action
 * buttons from `allowedActions`, so the UI cannot offer a transition the server refuses.
 */

export const INCIDENT_OUTCOMES = [
  'transported', 'treated_released', 'refused', 'deceased',
  'false_alarm', 'duplicate', 'cancelled_by_caller', 'no_patient_found',
];

export const INCIDENT_SOURCES = [
  'call_998', 'call_999', 'call_997', 'call_996', 'app_sos',
  'aed_activation', 'cad_feed', 'sensor', 'field_unit', 'transfer',
];

export const CALLER_ROLES = ['self', 'bystander', 'family', 'security', 'staff'];

/** An assignment in one of these states still commits its unit. */
export const ACTIVE_ASSIGNMENT_STATES = new Set([
  'offered', 'acknowledged', 'enroute', 'onscene', 'transporting', 'at_hospital', 'resolved_on_scene',
]);

/** A crew in one of these states is with a patient: the incident cannot be closed
 *  over their heads — they clear first. */
export const CREW_COMMITTED_STATES = new Set(['onscene', 'transporting', 'at_hospital', 'resolved_on_scene']);

/** Before arrival an assignment can simply be stood down. */
export const PRE_ARRIVAL_STATES = new Set(['offered', 'acknowledged', 'enroute']);

/** Units a dispatcher may offer a job to. */
export const DISPATCHABLE_UNIT_STATUSES = new Set(['available', 'standby']);

/**
 * Every assignment transition.
 *
 *   from        states the action is legal in
 *   to          the resulting assignment state
 *   stamp       the timestamp column the action sets (null: none — the timeline row is the record)
 *   unitStatus  what the unit becomes
 *   stage       machine key written to incident_timeline
 *   who         'unit' actions may be logged by the crew or, on their radio call, by a
 *               dispatcher; 'dispatcher' actions only from the console; 'system' only
 *               by the server itself
 *   requires    body fields that must be present
 */
export const ASSIGNMENT_ACTIONS = {
  acknowledge:  { from: ['offered'],      to: 'acknowledged', stamp: 'acknowledged_at', unitStatus: 'assigned',     stage: 'unit_acknowledged', who: 'unit' },
  decline:      { from: ['offered'],      to: 'declined',     stamp: 'declined_at',     unitStatus: 'available',    stage: 'unit_declined',     who: 'unit', requires: ['reason'] },
  timeout:      { from: ['offered'],      to: 'timed_out',    stamp: null,              unitStatus: 'available',    stage: 'offer_timed_out',   who: 'system' },
  enroute:      { from: ['acknowledged'], to: 'enroute',      stamp: 'enroute_at',      unitStatus: 'responding',   stage: 'unit_enroute',      who: 'unit' },
  onscene:      { from: ['enroute'],      to: 'onscene',      stamp: 'onscene_at',      unitStatus: 'on_scene',     stage: 'unit_onscene',      who: 'unit' },
  at_patient:   { from: ['onscene'],      to: 'onscene',      stamp: 'at_patient_at',   unitStatus: 'on_scene',     stage: 'crew_at_patient',   who: 'unit', once: true },
  transporting: { from: ['onscene'],      to: 'transporting', stamp: 'transporting_at', unitStatus: 'transporting', stage: 'transporting',      who: 'unit', requires: ['hospitalRef'] },
  resolve:      { from: ['onscene'],      to: 'resolved_on_scene', stamp: null,         unitStatus: 'on_scene',     stage: 'resolved_on_scene', who: 'unit' },
  at_hospital:  { from: ['transporting'], to: 'at_hospital',  stamp: 'at_hospital_at',  unitStatus: 'at_hospital',  stage: 'at_hospital',       who: 'unit' },
  clear:        { from: ['onscene', 'resolved_on_scene', 'at_hospital'], to: 'cleared', stamp: 'cleared_at', unitStatus: 'available', stage: 'unit_cleared', who: 'unit' },
  cancel:       { from: ['offered', 'acknowledged', 'enroute'], to: 'cancelled', stamp: null, unitStatus: 'available', stage: 'unit_stood_down', who: 'dispatcher', requires: ['reason'] },
};

/**
 * Actions legal right now, in the order a crew performs them. `at_patient` drops out once
 * stamped — it happens once per assignment; `transporting` is absent for a unit that
 * cannot carry a patient.
 * @param {{ state: string, at_patient_at?: string|null }} assignment
 * @param {{ canTransport?: boolean }} [unit]
 */
export function allowedActions(assignment, { canTransport = true } = {}) {
  return Object.entries(ASSIGNMENT_ACTIONS)
    .filter(([name, a]) => a.who !== 'system'
      && a.from.includes(assignment.state)
      && !(a.once && assignment[a.stamp])
      && !(name === 'transporting' && !canTransport))
    .map(([name]) => name);
}

/**
 * Validate a transition. Returns null when legal, or a reason a person can read.
 * @param {string} action
 * @param {{ state: string, at_patient_at?: string|null }} assignment
 * @param {object} [body]
 * @param {{ canTransport?: boolean, unitKind?: string }} [unit]
 */
export function transitionError(action, assignment, body = {}, { canTransport = true, unitKind = 'This unit' } = {}) {
  const def = ASSIGNMENT_ACTIONS[action];
  if (!def) return `Unknown action "${action}"`;
  if (!def.from.includes(assignment.state)) {
    return `Cannot ${action.replace('_', ' ')} an assignment that is ${assignment.state.replace(/_/g, ' ')}`;
  }
  if (action === 'transporting' && !canTransport) return `${unitKind} cannot transport a patient — send an ambulance`;
  if (def.once && assignment[def.stamp]) return `Already recorded at ${assignment[def.stamp]}`;
  for (const field of def.requires ?? []) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      return `"${field}" is required to ${action.replace('_', ' ')}`;
    }
  }
  return null;
}

/** How far each assignment state has carried its incident. */
const PROGRESS = {
  offered: 1, acknowledged: 2, enroute: 2, onscene: 3, resolved_on_scene: 4, transporting: 5, at_hospital: 6,
};
const PROGRESS_STATE = [null, 'dispatched', 'responding', 'on_scene', 'resolved_on_scene', 'transporting', 'at_hospital'];

/** What a cleared assignment had reached before it cleared, read from its stamps. */
function clearedProgress(a) {
  if (a.at_hospital_at) return 6;
  if (a.transporting_at) return 5;
  if (a.onscene_at) return 4;     // cleared from scene without transport
  return 0;
}

/**
 * The incident's state is DERIVED from its assignments, never set independently —
 * so the queue can never say "on scene" while every unit on it says "en route".
 *
 * @param {{ state: string, triaged_at?: string|null }} incident
 * @param {Array<{ state: string, onscene_at?: string|null, transporting_at?: string|null, at_hospital_at?: string|null }>} assignments
 */
export function deriveIncidentState(incident, assignments) {
  if (incident.state === 'closed') return 'closed';

  let best = 0;
  for (const a of assignments) {
    const p = a.state === 'cleared' ? clearedProgress(a) : (PROGRESS[a.state] ?? 0);
    if (p > best) best = p;
  }
  if (best > 0) return PROGRESS_STATE[best];

  // Nothing live: every offer was declined, timed out or stood down, or none was made.
  if (incident.state === 'non_emergency') return 'non_emergency';
  return incident.triaged_at ? 'triaged' : 'reported';
}

/**
 * Timestamps the incident carries that are derived from its assignments. The FIRST
 * arrival stops the headline clock, whichever unit it was.
 */
export function derivedIncidentStamps(assignments) {
  const min = (col) => assignments
    .map((a) => a[col])
    .filter(Boolean)
    .map((v) => new Date(v).getTime())
    .reduce((m, v) => (m === null || v < m ? v : m), null);
  const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
  return {
    first_onscene_at: iso(min('onscene_at')),
    first_at_patient_at: iso(min('at_patient_at')),
  };
}

/**
 * Why an incident cannot be closed yet, or null.
 * Pre-arrival assignments are stood down by the close; a crew with a patient is not.
 */
export function closeBlocker(assignments) {
  const committed = assignments.filter((a) => CREW_COMMITTED_STATES.has(a.state));
  if (!committed.length) return null;
  return `${committed.map((a) => a.unit_ref ?? a.ref).join(', ')} still ${committed.length === 1 ? 'has' : 'have'} the patient — clear the unit first`;
}

/** Unit status for a manual console change. Assignment-driven statuses are not settable. */
export const MANUAL_UNIT_STATUSES = new Set(['available', 'off_duty', 'out_of_service', 'standby']);
