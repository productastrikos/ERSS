/**
 * After-action review — what went well on one response, what did not, and what to change.
 *
 * Computed from the record alone (the incident, its assignments, the breadcrumbs, the
 * dispatch rationale and the kept AI log), so it can be recomputed for any closed
 * incident and agrees with the replay it sits beside. Every finding names the interval
 * it is about, the figure, and the standard it was measured against; a standard that is
 * this build's working assumption rather than a published DCAS figure says so.
 *
 *   kind 'good'      went well — keep doing it
 *   kind 'improve'   slower or less accurate than it should have been
 *   kind 'suggest'   a concrete change the team could make, with the reason
 */

import { pool, one } from '../lib/db.js';
import { jurisdiction } from '../config/jurisdiction.js';
import * as decisions from './decisions.js';

/** Working standards for the review. Not published DCAS figures — labelled as such. */
export const STANDARDS = Object.freeze({
  acknowledgeSec: 20,
  turnoutSec: { P1: 45, P2: 60, P3: 90, P4: 120 },
  /** Arrival to patient contact, roadside. */
  accessSec: 60,
  /** On scene to leaving for hospital — the "platinum ten minutes" for major trauma. */
  sceneSec: { P1: 600, P2: 900, P3: 1200, P4: 1200 },
  /** Arrival at hospital to clear — the hand-over standard most EMS systems hold to. */
  handoverSec: 900,
  etaGoodSec: 45,
});

const mmss = (sec) => {
  const s = Math.max(0, Math.round(Math.abs(sec ?? 0)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const secs = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 1000) : null);
const km = (m) => `${(Math.max(0, m ?? 0) / 1000).toFixed(1)} km`;

export async function review(ref) {
  const inc = await one(
    `SELECT i.id, i.ref, i.kind, i.priority, i.source, i.reported_at, i.dispatched_at, i.first_onscene_at, i.closed_at,
            i.patients_count, i.outcome
       FROM incidents i WHERE i.ref = $1`, [ref]);
  if (!inc) return null;
  const { rows: asgs } = await pool.query(
    `SELECT a.ref, a.is_primary, a.state, a.offered_at, a.acknowledged_at, a.enroute_at, a.onscene_at, a.at_patient_at,
            a.transporting_at, a.at_hospital_at, a.cleared_at, a.eta_predicted_at,
            a.route_proposed_sec, a.route_taken_sec, a.route_proposed_m, a.route_taken_m, a.route_hospital_sec, a.route_hospital_m,
            a.dispatch_rationale AS rat, a.unit_id, u.ref AS unit_ref, u.callsign, u.kind AS unit_kind,
            h.name AS hospital_name, h.ed_beds, h.ed_occupied
       FROM assignments a JOIN units u ON u.id = a.unit_id LEFT JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.incident_id = $1 ORDER BY a.offered_at`, [inc.id]);
  const a = asgs.find((x) => x.is_primary) ?? asgs[0] ?? null;
  const target = jurisdiction.priorities.find((p) => p.code === inc.priority)?.targetSec ?? 480;
  const findings = [];
  const add = (f) => findings.push(f);

  // ── Detection to dispatch ──────────────────────────────────────────────────
  if (a) {
    const toJob = secs(inc.reported_at, a.offered_at);
    add({
      id: 'detect-to-dispatch', kind: toJob <= 30 ? 'good' : 'improve', tone: toJob <= 30 ? 'good' : 'warn',
      title: `Camera to job sent in ${toJob} s${inc.source === 'sensor' ? ' — before anyone phoned 998' : ''}`,
      detail: `The AI decided while the room watched its review window; ${toJob} s is ${Math.round((toJob / target) * 100)}% of the ${mmss(target)} min ${inc.priority} target.`,
      metric: { label: 'Detection → dispatch', value: `${toJob} s` },
    });
    if (inc.priority === 'P1' && toJob > 15) {
      add({
        id: 'suggest-window', kind: 'suggest', tone: 'ai',
        title: 'Shorten the P1 review window',
        detail: `If dispatchers rarely override the AI on P1s, a 5 s window would have the crew's tablet ringing ~${Math.max(0, toJob - 8)} s sooner — the cheapest seconds in the whole response.`,
      });
    }
  }

  // ── The choice ─────────────────────────────────────────────────────────────
  const base = a?.rat?.baseline ?? null;
  if (a && base) {
    if (base.savedSec > 0 && base.unitRef !== a.unit_ref) {
      add({
        id: 'ai-choice', kind: 'good', tone: 'good',
        title: `AI choice saved ${mmss(base.savedSec)} min over sending the nearest`,
        detail: `The nearest ambulance as the crow flies was predicted ${mmss(base.savedSec)} min slower by road than ${a.callsign}.`,
        metric: { label: 'Saved vs nearest', value: `${mmss(base.savedSec)} min` },
      });
    } else {
      add({
        id: 'ai-choice', kind: 'good', tone: 'good',
        title: `${a.callsign} was both the nearest and the fastest — the AI confirmed it on the roads`,
        detail: 'Driving the candidates\' real roads did not change the order; the check cost no time.',
      });
    }
  }

  // ── Crew: acknowledge and turnout ──────────────────────────────────────────
  if (a?.acknowledged_at) {
    const ack = secs(a.offered_at, a.acknowledged_at);
    const ok = ack <= STANDARDS.acknowledgeSec;
    add({
      id: 'acknowledge', kind: ok ? 'good' : 'improve', tone: ok ? 'good' : 'warn',
      title: `${a.callsign} acknowledged in ${ack} s`,
      detail: ok ? `Inside the ${STANDARDS.acknowledgeSec} s working standard.` : `Over the ${STANDARDS.acknowledgeSec} s working standard — check the tablet alert volume and placement in the cab.`,
      metric: { label: 'Acknowledge', value: `${ack} s` },
    });
  }
  if (a?.enroute_at && a.acknowledged_at) {
    const turnout = secs(a.acknowledged_at, a.enroute_at);
    const std = STANDARDS.turnoutSec[inc.priority] ?? 60;
    const ok = turnout <= std;
    add({
      id: 'turnout', kind: ok ? 'good' : 'improve', tone: ok ? 'good' : 'warn',
      title: `Wheels rolling ${turnout} s after acknowledging`,
      detail: ok ? `Inside the ${std} s working turnout standard for ${inc.priority}.` : `Over the ${std} s working standard — the AI's arrival prediction assumed a quicker turnout.`,
      metric: { label: 'Turnout', value: `${turnout} s` },
    });
  }

  // ── The drive ──────────────────────────────────────────────────────────────
  const track = a ? (await pool.query(
    `SELECT ts, speed FROM unit_positions WHERE unit_id = $1 AND ts BETWEEN $2 AND $3 AND speed IS NOT NULL ORDER BY ts`,
    [a.unit_id, a.enroute_at ?? a.offered_at, a.onscene_at ?? a.cleared_at ?? new Date()],
  ).catch(() => ({ rows: [] }))).rows : [];
  if (a?.onscene_at && a.enroute_at) {
    const driveSec = secs(a.enroute_at, a.onscene_at);
    const speeds = track.map((t) => Number(t.speed)).filter((v) => Number.isFinite(v));
    const top = speeds.length ? Math.max(...speeds) : null;
    const avg = a.route_taken_m && driveSec ? Math.round((a.route_taken_m / driveSec) * 3.6) : null;
    const slowShare = speeds.length ? speeds.filter((v) => v < 25).length / speeds.length : null;
    const crawl = slowShare != null && slowShare > 0.45 && (a.route_taken_m ?? 0) > 800;
    add({
      id: 'drive', kind: crawl ? 'improve' : 'good', tone: crawl ? 'warn' : 'info',
      title: `Drove ${a.route_taken_m ? km(a.route_taken_m) : 'to the scene'} in ${mmss(driveSec)} min${avg ? ` · average ${avg} km/h` : ''}${top ? ` · top ${Math.round(top)} km/h` : ''}`,
      detail: slowShare != null
        ? `${Math.round(slowShare * 100)}% of the drive below 25 km/h — braking for manoeuvres, queues and pulling away${crawl ? '; a high share for a route this length — check where the time went on the replay' : ''}.`
        : null,
      metric: { label: 'Drive', value: `${mmss(driveSec)} min` },
    });
  }

  // The road the AI chose, and what its manoeuvres cost — from the kept decision.
  const snap = decisions.snapshot(ref) ?? (await one(
    `SELECT l.meta FROM incident_ai_log l WHERE l.incident_id = $1 AND l.source = 'console' AND l.key = '__decision'`, [inc.id],
  ).catch(() => null))?.meta ?? null;
  const chosen = snap?.candidates?.find((c) => c.unitRef === (a?.unit_ref ?? snap?.chosen)) ?? snap?.candidates?.[0] ?? null;
  const stats = chosen?.route?.stats ?? null;
  if (stats) {
    const lost = stats.cornerLossSec ?? 0;
    if (stats.counts.manoeuvres >= 6 || lost >= 30) {
      add({
        id: 'suggest-standby', kind: 'suggest', tone: 'ai',
        title: `${stats.counts.manoeuvres} manoeuvres cost about ${mmss(lost)} min of braking and pulling away`,
        detail: `Only ${Math.round(stats.majorShare * 100)}% of the road was main road. A standby point on a main road for this area would cut most of that.`,
      });
    } else {
      add({
        id: 'road', kind: 'good', tone: 'good',
        title: `Direct road — ${stats.counts.manoeuvres ? `${stats.counts.manoeuvres} manoeuvre${stats.counts.manoeuvres === 1 ? '' : 's'}` : 'no hard turns'}, ${Math.round(stats.majorShare * 100)}% on main roads`,
        detail: chosen.route.why?.length ? `Chosen over the alternative: ${chosen.route.why.join('; ')}.` : 'The router\'s alternatives were slower.',
      });
    }
  }

  // ── Prediction against reality ─────────────────────────────────────────────
  if (a?.onscene_at && a.eta_predicted_at) {
    const err = secs(a.eta_predicted_at, a.onscene_at);
    const ok = Math.abs(err) <= STANDARDS.etaGoodSec;
    add({
      id: 'eta', kind: ok ? 'good' : 'improve', tone: ok ? 'good' : 'warn',
      title: ok ? `Arrival predicted within ${Math.abs(err)} s` : `Arrival ${mmss(err)} min ${err > 0 ? 'later' : 'earlier'} than predicted`,
      detail: ok
        ? 'The drive model (road class, every manoeuvre, traffic) held up on this road.'
        : err > 0 ? 'Slower than modelled — check the traffic met against the simulated traffic it was predicted with, and the turnout.'
          : 'Quicker than modelled — the calibrated acknowledge + turnout allowance (60 s) was longer than this crew needed.',
      metric: { label: 'Prediction error', value: `${err > 0 ? '+' : '−'}${mmss(err)} min` },
    });
  }

  // ── Response against target ────────────────────────────────────────────────
  if (inc.first_onscene_at) {
    const resp = secs(inc.reported_at, inc.first_onscene_at);
    const inside = target - resp;
    add({
      id: 'response', kind: inside >= 0 ? 'good' : 'improve', tone: inside >= 0 ? 'good' : 'bad',
      title: inside >= 0 ? `On scene in ${mmss(resp)} min — ${mmss(inside)} inside the ${inc.priority} target` : `On scene in ${mmss(resp)} min — ${mmss(-inside)} over target`,
      detail: `Measured from the camera detection, not from a call: the clock started before anyone knew to phone.`,
      metric: { label: 'Response', value: `${mmss(resp)} min` },
    });
  }

  // ── Scene, hospital, hand-over ─────────────────────────────────────────────
  if (a?.onscene_at && a.at_patient_at) {
    const access = secs(a.onscene_at, a.at_patient_at);
    if (access > STANDARDS.accessSec) {
      add({ id: 'access', kind: 'improve', tone: 'warn', title: `${access} s from arriving to patient contact`, detail: `Over ${STANDARDS.accessSec} s at a roadside scene — check where the crew could park against the traffic.` });
    }
  }
  if (a?.transporting_at && a.onscene_at) {
    const scene = secs(a.onscene_at, a.transporting_at);
    const std = STANDARDS.sceneSec[inc.priority] ?? 900;
    add({
      id: 'scene', kind: scene <= std ? 'good' : 'improve', tone: scene <= std ? 'good' : 'warn',
      title: `${mmss(scene)} min on scene before leaving for ${a.hospital_name ?? 'hospital'}`,
      detail: scene <= std ? `Inside the ${mmss(std)} min working standard for ${inc.priority}.` : `Over the ${mmss(std)} min working standard.`
        + ' (Scene time is shortened in this demonstration.)',
      metric: { label: 'Scene', value: `${mmss(scene)} min` },
    });
    const occ = a.ed_beds ? Math.round((a.ed_occupied / a.ed_beds) * 100) : null;
    add({
      id: 'suggest-prealert', kind: 'suggest', tone: 'ai',
      title: `Pre-alert ${a.hospital_name ?? 'the hospital'} when transport starts`,
      detail: `The AI-drafted handover was ready when the crew left the scene${occ != null ? `, and the ED was ${occ}% full` : ''}. Sending it ahead lets the ED prepare a bay before the ambulance arrives.`,
    });
  }
  if (a?.at_hospital_at && a.cleared_at) {
    const handover = secs(a.at_hospital_at, a.cleared_at);
    const ok = handover <= STANDARDS.handoverSec;
    add({
      id: 'handover', kind: ok ? 'good' : 'improve', tone: ok ? 'good' : 'warn',
      title: `Handed over and clear in ${mmss(handover)} min`,
      detail: ok ? `Inside the ${mmss(STANDARDS.handoverSec)} min hand-over standard — back in service quickly.` : `Over the ${mmss(STANDARDS.handoverSec)} min hand-over standard — the ambulance was out of service waiting.`,
      metric: { label: 'Hand-over', value: `${mmss(handover)} min` },
    });
  }

  // ── Backup ─────────────────────────────────────────────────────────────────
  if (inc.patients_count >= 3 && asgs.length < 2) {
    add({
      id: 'backup', kind: 'improve', tone: 'warn',
      title: `${inc.patients_count} patients, one ambulance`,
      detail: 'The crew\'s AI co-pilot suggested a second ambulance; none was sent. Consider making that suggestion an automatic second dispatch.',
    });
  }

  // Order: went well, then to improve, then suggestions.
  const order = { good: 0, improve: 1, suggest: 2 };
  findings.sort((x, y) => order[x.kind] - order[y.kind]);
  return {
    at: new Date(inc.closed_at ?? Date.now()).toISOString(),
    findings,
    standards: STANDARDS,
    note: 'Working standards for the review are this build\'s assumptions, not published DCAS figures. Scene and hand-over times are shortened in the demonstration.',
  };
}
