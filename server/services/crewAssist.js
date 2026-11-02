/**
 * The crew's AI co-pilot — what the platform already knows about this job, turned into
 * what the crew needs next: why they were sent, what to bring, what is on the road ahead,
 * whether one ambulance is enough, and a handover drafted from the record.
 *
 * Deterministic, like every engine here. Each line names where it came from, and nothing
 * is said that the incident, the dispatch decision or the road does not support.
 */

import { pool } from '../lib/db.js';
import * as incidents from '../repos/incidents.js';
import * as fleet from '../repos/fleet.js';
import * as traffic from '../sim/traffic.js';
import { liveFor, remainingPathFor } from '../sim/live.js';
import { haversineM } from './eta.js';

/** What to have in hand at the door, by incident kind. */
const KIT = {
  rta: ['Spinal board and collars', 'Trauma bag and tourniquets', 'Scoop stretcher'],
  trauma_fall: ['Spinal board and collars', 'Splints', 'Trauma bag'],
  workplace_injury: ['Trauma bag', 'Splints', 'Burns dressings'],
  cardiac_arrest: ['Defibrillator', 'Mechanical CPR device', 'Airway kit'],
  cardiac: ['12-lead ECG', 'Aspirin and GTN', 'Defibrillator on standby'],
  stroke: ['Glucose meter', 'FAST assessment', 'Stroke-unit pre-alert'],
  respiratory: ['Oxygen and nebuliser', 'Pulse oximeter', 'Airway kit'],
  heat_illness: ['Cooling packs', 'IV fluids', 'Thermometer'],
  medical_general: ['Observation kit', 'Glucose meter', 'Oxygen'],
};

const KIND_LABEL = {
  rta: 'road traffic collision', trauma_fall: 'injury from a fall', cardiac_arrest: 'cardiac arrest',
  cardiac: 'chest pain', stroke: 'suspected stroke', respiratory: 'breathing difficulty',
  heat_illness: 'heat illness', medical_general: 'unwell person', workplace_injury: 'workplace injury',
};

const MOTORWAY = /\b(E\d{2,3}|motorway|interchange|slip)\b/i;

/** How a crew says the agencies — "Transport" would read as patient transport. */
const AGENCY_LABEL = { POLICE: 'Police', RTA: 'RTA (roads)', CIVIL_DEFENCE: 'Civil Defence', DCAS: 'DCAS' };

const mins = (sec) => (sec == null ? null : sec < 90 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`);
const km = (m) => (m == null ? null : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
/** GST wall-clock time, from an ISO string or a Date. */
const clock = (v) => (v ? new Date(new Date(v).getTime() + 4 * 3600_000).toISOString().slice(11, 16) : null);
const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * @param {string} unitId  the signed-in crew's unit
 * @returns {Promise<null | object>} null when the unit has no job
 */
export async function assistFor(unitId) {
  const unit = await fleet.unitById(pool, unitId);
  if (!unit?.currentAssignmentRef) return null;
  const asg = await fleet.assignmentByRef(pool, unit.currentAssignmentRef);
  if (!asg) return null;
  const inc = await incidents.incidentSummary(pool, asg.incident_ref);
  if (!inc) return null;

  const [agencies, others] = await Promise.all([
    pool.query(
      `SELECT agency_code, agency_name, notified_at, acknowledged_at FROM v_agency_sla
        WHERE incident_id = (SELECT id FROM incidents WHERE ref = $1) ORDER BY notified_at`,
      [inc.ref],
    ).then((r) => r.rows).catch(() => []),
    pool.query(
      `SELECT u.callsign FROM assignments a JOIN units u ON u.id = a.unit_id
        WHERE a.incident_id = (SELECT id FROM incidents WHERE ref = $1) AND a.ref <> $2
          AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital')`,
      [inc.ref, asg.ref],
    ).then((r) => r.rows.map((x) => x.callsign)).catch(() => []),
  ]);

  return {
    at: new Date().toISOString(),
    assignmentRef: asg.ref,
    state: asg.state,
    briefing: briefing(inc, unit, asg, agencies, others),
    route: await route(asg, unit, inc),
    handover: handover(inc, asg),
  };
}

function briefing(inc, unit, asg, agencies, others) {
  const kind = KIND_LABEL[inc.kind] ?? inc.kind.replace(/_/g, ' ');
  const points = [];

  if (inc.source === 'sensor') {
    points.push({ text: `${inc.accessNote ?? `A ${kind}`} — seen by a road camera; nobody has called 998`, source: 'Camera analytics' });
  } else if (inc.accessNote) {
    points.push({ text: inc.accessNote, source: 'Caller' });
  }
  if (inc.chiefComplaint) points.push({ text: inc.chiefComplaint, source: 'Triage' });
  if (inc.patientsCount > 1) points.push({ text: `${inc.patientsCount} patients expected`, source: 'Camera analytics' });
  for (const a of agencies) {
    points.push({
      text: `${AGENCY_LABEL[a.agency_code] ?? a.agency_name} ${a.acknowledged_at ? 'acknowledged — on their way' : 'notified, not yet acknowledged'}`,
      source: 'Agency notifications',
    });
  }

  const alts = asg.dispatch_rationale?.alternatives ?? [];
  const mine = alts.find((x) => x.unitRef === unit.ref);
  const other = alts.find((x) => x.unitRef !== unit.ref);
  const whyYou = !mine ? 'Sent directly to this ambulance'
    : mine.rank === 1
      ? `AI dispatch: the fastest suitable crew — ${mins(mine.arrivalSec)} away${other ? `; next best ${other.callsign} at ${mins(other.arrivalSec)}` : ''}`
      : `AI dispatch ranked this crew ${mine.rank} of ${alts.length} — ${mins(mine.arrivalSec)} away; ${other?.callsign ?? 'the top crew'} was ${mins(other?.arrivalSec)}`;

  const safety = [];
  if (inc.kind === 'rta' || MOTORWAY.test(inc.accessNote ?? '')) {
    safety.push(MOTORWAY.test(inc.accessNote ?? '')
      ? 'Live motorway lanes: park upstream of the wreck, lights on, hi-vis before you step out'
      : 'Live traffic: park to shield the scene, lights on, hi-vis before you step out');
  }
  if (!agencies.some((a) => /police/i.test(a.agency_name)) && inc.kind === 'rta') {
    safety.push('Police are not on this job yet — ask the dispatcher if the road needs closing');
  }

  let backup = null;
  if (inc.patientsCount >= 3 && !others.length) {
    backup = `${inc.patientsCount} patients for one crew — the AI suggests a second ambulance`;
  } else if (inc.priority === 'P1' && unit.kind === 'BLS' && ['cardiac_arrest', 'cardiac', 'stroke'].includes(inc.kind)) {
    backup = 'A P1 cardiac job on a BLS crew — the AI suggests ALS support';
  } else if (others.length) {
    backup = `Also on this job: ${others.join(', ')}`;
  }

  return {
    headline: `${inc.priority} ${kind}${inc.zoneName ? ` · ${inc.zoneName}` : ''}`,
    whyYou,
    points,
    prepare: KIT[inc.kind] ?? KIT.medical_general,
    safety,
    backup,
  };
}

async function route(asg, unit, inc) {
  const toHospital = asg.state === 'transporting';
  const driving = ['offered', 'acknowledged', 'enroute'].includes(asg.state) || toHospital;
  if (!driving) return null;

  const live = liveFor(asg.ref);
  let remainingM = live?.remainingM ?? null;
  let ahead = live?.trafficAhead ?? null;

  // A phone-driven job has no simulated drive: read the planned road ahead of the unit.
  if (!live && !toHospital && unit.lng != null) {
    const coords = remainingPathFor(asg.ref) ?? trimmed(asg.route_proposed?.coordinates ?? null, [unit.lng, unit.lat]);
    if (coords) {
      const jam = traffic.analyseRoute(coords, { queues: await traffic.activeQueues() });
      remainingM = jam.totalM;
      ahead = jam.segments.map((s) => ({ level: s.level, cause: s.cause, incidentRef: s.incidentRef, inM: s.fromM, lengthM: s.lengthM, delaySec: s.delaySec }));
    } else {
      remainingM = Math.round(haversineM([unit.lng, unit.lat], [inc.lng, inc.lat]) * 1.3);
    }
  }

  const etaSec = asg.eta_predicted_at && !toHospital ? Math.max(0, Math.round((ms(asg.eta_predicted_at) - Date.now()) / 1000)) : null;
  const first = ahead?.[0] ?? null;
  const cause = !first ? null
    : first.cause !== 'collision' ? 'traffic'
      : first.incidentRef === inc.ref ? 'queue behind this collision' : 'traffic at another collision';
  const turn = live?.next ?? null;
  const turnText = turn ? `${turn.label.charAt(0).toUpperCase()}${turn.label.slice(1)} in ${km(turn.inM)} — ease to ${turn.kmh} km/h` : null;
  const advice = !ahead ? turnText
    : !first ? (turnText ? `${turnText}. Clear road after it` : 'Clear road ahead — stay on the planned route')
      : `${first.level === 'heavy' ? 'Heavy' : 'Slow'} ${cause} in ${km(first.inM)} for ${km(first.lengthM)} (+${mins(first.delaySec)}) — already allowed for in your ETA${turnText ? `. ${turnText}` : ''}`;

  return {
    to: toHospital ? (asg.hospital_name ?? 'hospital') : 'scene',
    remainingM,
    etaSec: etaSec ?? (live?.etaSec ?? null),
    next: turn,
    advice,
    trafficAhead: ahead ?? [],
    simulatedTraffic: true,
  };
}

function trimmed(coords, at) {
  if (!coords || coords.length < 2) return null;
  let best = 0;
  let bestD = Infinity;
  coords.forEach((c, i) => { const d = haversineM(c, at); if (d < bestD) { bestD = d; best = i; } });
  const rest = coords.slice(best + 1);
  return rest.length ? [at, ...rest] : null;
}

/** A handover drafted from the record — facts only, for the crew to check and complete. */
function handover(inc, asg) {
  const responseSec = inc.firstOnsceneAt ? Math.round((ms(inc.firstOnsceneAt) - ms(inc.reportedAt)) / 1000) : null;
  const lines = [
    ['Incident', `${KIND_LABEL[inc.kind] ?? inc.kind}${inc.zoneName ? `, ${inc.zoneName}` : ''}`],
    ['Mechanism', inc.accessNote ?? inc.chiefComplaint ?? '—'],
    ['Patients', String(inc.patientsCount ?? 1)],
    ['Detected', `${clock(inc.reportedAt)}${inc.source === 'sensor' ? ' by road camera' : ''}`],
    ['On scene', asg.onscene_at ? `${clock(asg.onscene_at)}${responseSec != null ? ` (response ${mins(responseSec)})` : ''}` : '—'],
    ['With patient', asg.at_patient_at ? clock(asg.at_patient_at) : '—'],
    ['Destination', asg.hospital_name ?? '—'],
  ];
  return { lines, ready: Boolean(asg.at_patient_at) };
}
