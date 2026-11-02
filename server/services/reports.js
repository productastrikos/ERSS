/**
 * Reports — every incident the platform handled, as a document someone can read, edit and
 * take away.
 *
 * ONE report model per incident, read from the record (the incident, its assignments, the
 * timeline, the dispatch rationale, the hospital pre-alert, the patient's own vitals, the
 * after-action review and the kept AI log) — so a report drafted on the day and one drafted
 * six months later say the same thing. The web turns it into the preview, the PDF and the
 * Excel workbook (web/src/shared/report); nothing here knows about a file format.
 *
 * Three audiences, because three kinds of people ask for it:
 *
 *   full     the console — everything, including the AI's alternatives and its log
 *   crew     the crew that ran the job — the patient-care / hand-over view, no AI internals
 *   citizen  the person who raised the SOS — their own incident, their own vitals and
 *            profile, who came and where they were taken; nothing about other people
 *
 * Edits a person makes before downloading (title, summary, clinical notes, recommendations,
 * sections left out) are kept per incident and audience, so a report can be finished later.
 */

import { pool, one } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { can } from '../lib/auth.js';
import { forbidden, notFound } from '../lib/errors.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { poc } from '../config/poc.js';
import { TRIAL_CREWS } from '../data/reference/crews.js';
import { auditActor } from './actor.js';
import { kindLabel } from './alerts.js';
import { review } from './afterAction.js';
import { logFor } from './aiLog.js';
import { loadIncident } from './dispatch.js';
import * as vitals from './vitals.js';

const SOURCE_LABEL = {
  sensor: 'Road camera (AI detection)', app_sos: 'Citizen app SOS', call_998: '998 call', call_999: '999 call',
  aed_activation: 'AED activation', field_unit: 'Field unit', transfer: 'Inter-facility transfer', cad_feed: 'CAD feed',
};
const OUTCOME_LABEL = {
  transported: 'Transported to hospital', treated_released: 'Treated and released on scene',
  cancelled_by_caller: 'Cancelled by the caller', refused: 'Patient refused transport',
};

const iso = (v) => (v ? new Date(v).toISOString() : null);
/** Where it was, in words. A camera's note is "<what it saw> — <road>"; any other source's
 *  note is about the caller, not the place, so the community stands in. */
const placeOf = (source, note, zone) => (source === 'sensor' && note?.includes(' — ') ? note.split(' — ').pop() : zone ?? null);
const secs = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 1000) : null);
const mmss = (sec) => {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const gst = (v) => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' }) : '—');

// ── Who may read what ────────────────────────────────────────────────────────

const CONSOLE_CAPS = ['operations.view', 'analytics.view', 'clinical.view', 'executive.view'];

/**
 * The incident and the audience this user reads it as — or a refusal. A console user is held
 * to their zone scope (dispatch.loadIncident), a crew to jobs its unit ran, a citizen to their
 * own SOS.
 */
export async function access(ref, user, actor) {
  const row = await one('SELECT id, ref, reported_by FROM incidents WHERE ref = $1', [ref]);
  if (!row) throw notFound('Incident');
  if (user.role === 'citizen') {
    if (row.reported_by !== user.id) throw forbidden('This report belongs to another account');
    return { row, audience: 'citizen' };
  }
  if (user.role === 'responder') {
    const ran = await one('SELECT 1 FROM assignments WHERE incident_id = $1 AND unit_id = $2 LIMIT 1', [row.id, user.unit_id]);
    if (!ran) throw forbidden('This unit did not attend that incident');
    return { row, audience: 'crew' };
  }
  if (!CONSOLE_CAPS.some((c) => can(user.role, c))) throw forbidden('No access to incident reports');
  await loadIncident(ref, actor);   // zone scope — throws not-found outside it
  return { row, audience: 'full' };
}

// ── The report ───────────────────────────────────────────────────────────────

export async function incidentReport(ref, user, actor) {
  const { row, audience } = await access(ref, user, actor);
  const inc = await one(
    `SELECT i.*, ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat, z.name AS zone_name, u.name AS reporter_name
       FROM incidents i LEFT JOIN zones z ON z.id = i.zone_id LEFT JOIN users u ON u.id = i.reported_by
      WHERE i.id = $1`, [row.id]);
  const { rows: asgs } = await pool.query(
    `SELECT a.*, u.ref AS unit_ref, u.callsign, u.kind AS unit_kind,
            h.ref AS hospital_ref, h.name AS hospital_name, h.ed_beds, h.ed_occupied
       FROM assignments a JOIN units u ON u.id = a.unit_id LEFT JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.incident_id = $1 ORDER BY a.is_primary DESC, a.offered_at`, [row.id]);
  const { rows: tl } = await pool.query(
    `SELECT ts, stage, label, detail FROM incident_timeline WHERE incident_id = $1 ORDER BY ts, id`, [row.id]);
  const patient = await one(
    `SELECT p.triage_tag, p.age_band, p.sex, p.prealert_sent_at, p.prealert_ack_at, p.interventions, h.name AS destination
       FROM patients p LEFT JOIN hospitals h ON h.id = p.destination_id WHERE p.incident_id = $1 ORDER BY p.seq LIMIT 1`, [row.id]);

  const a = asgs.find((x) => x.is_primary && !['declined', 'timed_out', 'cancelled'].includes(x.state)) ?? asgs[0] ?? null;
  const target = jurisdiction.priorities.find((p) => p.code === inc.priority)?.targetSec ?? 480;
  const simulated = poc.enabled && (inc.source === 'sensor' || inc.source === 'app_sos' || inc.run_id != null || inc.is_resting);

  // ── The response, interval by interval ──────────────────────────────────
  const interval = (key, label, from, to, targetSec = null) => {
    const sec = secs(from, to);
    return sec == null ? null : { key, label, from: iso(from), to: iso(to), sec, targetSec, ok: targetSec == null ? null : sec <= targetSec };
  };
  const intervals = a ? [
    interval('dispatch', 'Alert to ambulance sent', inc.reported_at, a.offered_at, 60),
    interval('ack', 'Crew acknowledged', a.offered_at, a.acknowledged_at, 20),
    interval('turnout', 'Turn-out (acknowledged to rolling)', a.acknowledged_at, a.enroute_at),
    interval('travel', 'Drive to the scene', a.enroute_at, a.onscene_at),
    interval('access', 'Arrival to patient contact', a.onscene_at, a.at_patient_at, 60),
    interval('scene', 'Time with the patient on scene', a.at_patient_at, a.transporting_at, inc.priority === 'P1' ? 600 : 900),
    interval('transport', 'Transport to hospital', a.transporting_at, a.at_hospital_at),
    interval('handover', 'Hand-over at hospital', a.at_hospital_at, a.cleared_at, 900),
  ].filter(Boolean) : [];
  const responseSec = secs(inc.reported_at, inc.first_onscene_at ?? a?.onscene_at);
  const totals = {
    responseSec, targetSec: target, withinTarget: responseSec == null ? null : responseSec <= target,
    totalSec: secs(inc.reported_at, inc.closed_at ?? a?.cleared_at),
  };

  // ── Who went ────────────────────────────────────────────────────────────
  const roster = a ? TRIAL_CREWS[a.unit_ref] ?? null : null;
  const unit = a ? {
    ref: a.unit_ref, callsign: a.callsign, kind: a.unit_kind,
    plate: roster?.plate ?? null, vehicle: roster?.vehicle ?? null,
    crew: audience === 'citizen' ? [] : (roster?.crew ?? []).map((c) => ({ name: c.name, title: c.title, staffId: c.staffId })),
  } : null;

  // ── Why that ambulance ──────────────────────────────────────────────────
  const rat = a?.dispatch_rationale ?? null;
  const dispatch = a && rat && audience !== 'citizen' ? {
    by: rat.override ? `${rat.override.by} (override)` : 'AI dispatch',
    rank: rat.selected?.rank ?? null, of: rat.selected?.of ?? null,
    score: rat.selected?.score ?? null, confidence: rat.confidence ?? null,
    alternatives: (rat.alternatives ?? []).map((x) => ({
      callsign: x.callsign, kind: x.kind, rank: x.rank, arrivalSec: x.arrivalSec, distanceM: x.distanceM,
      trafficDelaySec: x.trafficDelaySec ?? 0, score: x.score, chosen: x.unitRef === a.unit_ref,
    })),
    baseline: rat.baseline ?? null,
    notes: rat.policy?.notes ?? [],
    predictedArrival: iso(a.eta_predicted_at),
    predictionErrorSec: a.eta_error_sec ?? null,
  } : null;

  const route = a ? {
    toScene: { distanceM: a.route_taken_m ?? a.route_proposed_m ?? null, sec: a.route_taken_sec ?? null, proposedSec: a.route_proposed_sec ?? null },
    toHospital: a.transporting_at ? { distanceM: a.route_hospital_m ?? null, sec: a.route_hospital_sec ?? secs(a.transporting_at, a.at_hospital_at) } : null,
  } : null;

  // ── The hospital, and what it was told ──────────────────────────────────
  const pre = tl.find((t) => t.stage === 'prealert')?.detail ?? null;
  const ack = tl.find((t) => t.stage === 'prealert_ack')?.detail ?? null;
  const hospital = a?.hospital_ref ? {
    ref: a.hospital_ref, name: a.hospital_name,
    edLoadPct: a.ed_beds ? Math.round((a.ed_occupied / a.ed_beds) * 100) : null,
    chosenAt: iso(a.transporting_at), arrivedAt: iso(a.at_hospital_at),
    prealertSentAt: iso(patient?.prealert_sent_at), prealertAckAt: iso(patient?.prealert_ack_at),
    etaGivenSec: pre?.etaSec ?? null, actualSec: secs(a.transporting_at, a.at_hospital_at),
    bay: ack?.bay ?? null, ready: pre?.ready ?? [], message: audience === 'citizen' ? null : pre,
  } : null;

  // ── The patient's own record ────────────────────────────────────────────
  let profile = null;
  if (inc.source === 'app_sos' && inc.reported_by) {
    profile = (await one('SELECT medical_profile FROM users WHERE id = $1', [inc.reported_by]))?.medical_profile ?? null;
    if (profile && Object.keys(profile).length) {
      // PDPL: a medical profile read is always on the record, whoever reads it.
      await audit({ action: 'report.medical_profile.read', entity: 'incident', entityId: inc.ref, actor: auditActor(actor), payload: { audience } });
    } else {
      profile = null;
    }
  }
  const v = await vitals.vitalsFor(inc.ref).catch((err) => { logger.warn({ err: err.message }, '[reports] vitals'); return null; });

  // ── After-action and AI log (the console's view only) ───────────────────
  const aar = audience === 'full' && (inc.closed_at || a?.cleared_at) ? await review(inc.ref).catch(() => null) : null;
  const aiLog = audience === 'full' ? (await logFor(inc.ref) ?? []).map((l) => ({ source: l.source, ts: l.ts, title: l.title, detail: l.detail, tone: l.tone })) : [];

  const report = {
    ref: inc.ref,
    audience,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.name ?? actor.ref,
    simulated,
    classification: simulated ? 'Trial data — simulated incident (ERSS proof of concept)' : null,
    incident: {
      ref: inc.ref, kind: inc.kind, kindLabel: kindLabel(inc.kind), priority: inc.priority, state: inc.state,
      outcome: inc.outcome, outcomeLabel: OUTCOME_LABEL[inc.outcome] ?? (inc.outcome ? String(inc.outcome).replace(/_/g, ' ') : null),
      source: inc.source, sourceLabel: SOURCE_LABEL[inc.source] ?? inc.source,
      reportedBy: inc.source === 'app_sos' ? inc.reporter_name ?? 'App user' : null,
      place: placeOf(inc.source, inc.access_note, inc.zone_name),
      zoneName: inc.zone_name, lng: inc.lng, lat: inc.lat, makani: inc.makani,
      reportedAt: iso(inc.reported_at), dispatchedAt: iso(inc.dispatched_at), firstOnsceneAt: iso(inc.first_onscene_at),
      closedAt: iso(inc.closed_at), chiefComplaint: inc.chief_complaint, accessNote: inc.access_note, patients: inc.patients_count,
    },
    intervals, totals, unit, dispatch, route, hospital,
    patient: {
      profile,
      triageTag: patient?.triage_tag ?? null, ageBand: patient?.age_band ?? null, sex: patient?.sex ?? null,
    },
    vitals: v ? { device: v.device, source: v.source, series: v.series, analysis: v.analysis } : null,
    timeline: tl.map((t) => ({ ts: iso(t.ts), stage: t.stage, label: t.label })),
    review: aar?.findings?.map((f) => ({ kind: f.kind, tone: f.tone, title: f.title, detail: f.detail, metric: f.metric ?? null })) ?? [],
    aiLog,
    draft: await draftFor(row.id, audience),
  };
  report.narrative = narrative(report);
  report.recommendations = recommendations(report);
  return report;
}

/** The summary paragraph, drafted from the record — what a person would write first. */
function narrative(r) {
  const i = r.incident;
  const a = r.unit;
  const parts = [];
  parts.push(`At ${gst(i.reportedAt)} GST on ${new Date(i.reportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' })}, a ${i.priority} ${i.kindLabel.toLowerCase()} was raised by ${i.source === 'app_sos' ? 'a citizen SOS from the ERSS app' : i.source === 'sensor' ? 'road-camera AI detection' : (i.sourceLabel ?? 'a report').toLowerCase()}${i.place ? ` at ${i.place}` : ''}${i.zoneName && i.place !== i.zoneName ? ` (${i.zoneName})` : ''}.`);
  if (a) {
    const sent = r.intervals.find((x) => x.key === 'dispatch');
    parts.push(`${r.dispatch?.by === 'AI dispatch' || !r.dispatch ? 'The AI dispatched' : `${r.dispatch.by} dispatched`} ${a.callsign} (${a.kind})${sent ? ` ${mmss(sent.sec)} min after the alert` : ''}${r.dispatch?.notes?.some((n) => /paramedic app/i.test(n)) ? ', paired with the paramedic app' : ''}.`);
  }
  if (r.totals.responseSec != null) {
    parts.push(`The crew reached the scene ${mmss(r.totals.responseSec)} min after the alert — ${r.totals.withinTarget ? 'inside' : 'outside'} the ${mmss(r.totals.targetSec)} min ${i.priority} target.`);
  }
  if (r.hospital) {
    parts.push(`The patient was taken to ${r.hospital.name}${r.hospital.prealertSentAt ? `; the emergency department was pre-alerted automatically at ${gst(r.hospital.prealertSentAt)}${r.hospital.prealertAckAt ? ` and acknowledged${r.hospital.bay ? ` with ${r.hospital.bay}` : ''}` : ''}` : ''}${r.hospital.arrivedAt ? `, arriving at ${gst(r.hospital.arrivedAt)}` : ''}.`);
  } else if (i.outcomeLabel) {
    parts.push(`Outcome: ${i.outcomeLabel.toLowerCase()}.`);
  }
  const vv = r.vitals?.analysis?.value;
  if (vv?.headline) parts.push(`Wearable readings: ${vv.headline}.${vv.sequence?.text ? ` ${vv.sequence.text}` : ''}`);
  return parts.join(' ');
}

function recommendations(r) {
  const out = (r.review ?? []).filter((f) => f.kind === 'suggest' || f.kind === 'improve').map((f) => `${f.title}${f.detail ? ` — ${f.detail}` : ''}`);
  for (const c of r.vitals?.analysis?.value?.considerations ?? []) out.push(c);
  return out.slice(0, 8);
}

// ── The register: every incident a person may report on ────────────────────

export async function register(user, actor, { days = 30, limit = 300 } = {}) {
  const scope = user.role === 'citizen' ? { sql: 'i.reported_by = $3', arg: user.id }
    : user.role === 'responder' ? { sql: 'EXISTS (SELECT 1 FROM assignments x WHERE x.incident_id = i.id AND x.unit_id = $3)', arg: user.unit_id }
      : user.zone_scope?.length ? { sql: '(i.zone_id = ANY($3::uuid[]) OR i.zone_id IN (SELECT id FROM zones WHERE parent_id = ANY($3::uuid[])))', arg: user.zone_scope }
        : { sql: '$3::text IS NULL', arg: null };
  if (user.role !== 'citizen' && user.role !== 'responder' && !CONSOLE_CAPS.some((c) => can(user.role, c))) throw forbidden('No access to incident reports');
  const { rows } = await pool.query(
    `SELECT i.ref, i.kind, i.priority, i.state, i.outcome, i.source, i.reported_at, i.first_onscene_at, i.closed_at,
            i.access_note, z.name AS zone_name, (i.run_id IS NOT NULL) AS in_run,
            a.callsign, a.unit_kind, a.hospital_name, a.cleared_at,
            EXISTS (SELECT 1 FROM telemetry t JOIN patients p ON p.id = t.patient_id WHERE p.incident_id = i.id) AS has_vitals,
            EXISTS (SELECT 1 FROM incident_timeline t WHERE t.incident_id = i.id AND t.stage = 'prealert') AS prealerted
       FROM incidents i
       LEFT JOIN zones z ON z.id = i.zone_id
       LEFT JOIN LATERAL (
         SELECT u.callsign, u.kind AS unit_kind, h.name AS hospital_name, x.cleared_at
           FROM assignments x JOIN units u ON u.id = x.unit_id LEFT JOIN hospitals h ON h.id = x.hospital_id
          WHERE x.incident_id = i.id ORDER BY x.is_primary DESC, x.offered_at LIMIT 1) a ON true
      WHERE NOT i.is_seed AND NOT i.is_resting
        AND i.reported_at >= now() - make_interval(days => $1)
        AND ${scope.sql}
      ORDER BY i.reported_at DESC
      LIMIT $2`,
    [Math.max(1, Math.min(400, days)), Math.max(1, Math.min(1000, limit)), scope.arg],
  );
  void actor;
  return rows.map((r) => {
    const target = jurisdiction.priorities.find((p) => p.code === r.priority)?.targetSec ?? 480;
    const resp = secs(r.reported_at, r.first_onscene_at);
    return {
      ref: r.ref, kind: r.kind, kindLabel: kindLabel(r.kind), priority: r.priority, state: r.state,
      outcome: r.outcome, source: r.source, sourceLabel: SOURCE_LABEL[r.source] ?? r.source,
      place: placeOf(r.source, r.access_note, r.zone_name), zoneName: r.zone_name,
      reportedAt: iso(r.reported_at), firstOnsceneAt: iso(r.first_onscene_at), closedAt: iso(r.closed_at),
      responseSec: resp, targetSec: target, withinTarget: resp == null ? null : resp <= target,
      callsign: r.callsign, unitKind: r.unit_kind, hospital: r.hospital_name,
      hasVitals: r.has_vitals, prealerted: r.prealerted, live: r.state !== 'closed',
    };
  });
}

// ── Drafts: a person's edits, kept until they come back to them ──────────────

let draftTable = null;
async function ensureDraftTable() {
  if (draftTable) return draftTable;
  draftTable = pool.query(
    `CREATE TABLE IF NOT EXISTS incident_reports (
       incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
       audience    text NOT NULL,
       edits       jsonb NOT NULL DEFAULT '{}',
       updated_by  text,
       updated_at  timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (incident_id, audience))`,
  ).then(() => true).catch((err) => { logger.warn({ err: err.message }, '[reports] draft table unavailable'); draftTable = null; return false; });
  return draftTable;
}

async function draftFor(incidentId, audience) {
  if (!(await ensureDraftTable())) return null;
  const row = await one('SELECT edits, updated_by, updated_at FROM incident_reports WHERE incident_id = $1 AND audience = $2', [incidentId, audience]).catch(() => null);
  return row ? { ...row.edits, updatedBy: row.updated_by, updatedAt: iso(row.updated_at) } : null;
}

export async function saveDraft(ref, edits, user, actor) {
  const { row, audience } = await access(ref, user, actor);
  if (!(await ensureDraftTable())) throw new Error('Report drafts are unavailable — run npm run db:schema');
  await pool.query(
    `INSERT INTO incident_reports (incident_id, audience, edits, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (incident_id, audience) DO UPDATE SET edits = EXCLUDED.edits, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [row.id, audience, JSON.stringify(edits), actor.ref],
  );
  await audit({ action: 'report.draft.save', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { audience } });
  return draftFor(row.id, audience);
}

/** The vitals alone — the crew's live card and the console's incident panel. */
export async function incidentVitals(ref, user, actor) {
  await access(ref, user, actor);
  return vitals.vitalsFor(ref);
}
