/**
 * The patient's own vitals, from the citizen app's health monitor — kept, streamed, analysed.
 *
 * The SOS carries the last minutes of wearable readings that led up to it, and the app keeps
 * sending new ones until the job ends. They are stored in the ordinary clinical tables — a
 * `patients` row for the incident (created on first need) and `telemetry` rows with
 * `source = 'wearable:<device>'` — so a closed incident's report, the hospital pre-alert and
 * the crew's screen all read the same record. Pushed live to the crew answering the call and
 * to any console watching the incident.
 *
 * Telemetry rows carry no run id on purpose: they belong to their patient, and go with it —
 * deleted by the cascade when a PoC restart removes the incident, kept when the incident is
 * archived as a completed response.
 */

import { pool, one } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { analyseVitals } from '../engines/vitalsTrend.js';
import { emitTo, room } from '../realtime/index.js';

const MAX_BATCH = 900;

/** The incident's first patient, created if the record has none yet. */
export async function ensurePatient(incidentId, { chiefComplaint = null, runId = null } = {}) {
  const found = await one('SELECT id FROM patients WHERE incident_id = $1 ORDER BY seq LIMIT 1', [incidentId]);
  if (found) return found.id;
  const row = await one(
    `INSERT INTO patients (incident_id, seq, chief_complaint, run_id) VALUES ($1, 1, $2, $3) RETURNING id`,
    [incidentId, chiefComplaint, runId],
  );
  return row.id;
}

const clean = (r) => {
  const ts = typeof r.ts === 'number' ? r.ts : Date.parse(r.ts);
  const hr = r.bpm ?? r.hr;
  return {
    ts,
    hr: Number.isFinite(Number(hr)) && hr != null ? Math.round(Number(hr)) : null,
    spo2: Number.isFinite(Number(r.spo2)) && r.spo2 != null ? Math.round(Number(r.spo2)) : null,
  };
};

/**
 * Append wearable readings to an incident's record. Readings at or before the newest one
 * already stored are skipped, so a phone may resend safely.
 * @returns {{ added: number, latest: object|null }}
 */
export async function appendWearable(incidentRef, readings, { device = null, unitRef = null } = {}) {
  const inc = await one('SELECT id, chief_complaint, run_id FROM incidents WHERE ref = $1', [incidentRef]);
  if (!inc) return { added: 0, latest: null };
  const patientId = await ensurePatient(inc.id, { chiefComplaint: inc.chief_complaint, runId: inc.run_id });
  const last = await one(`SELECT max(ts) AS ts FROM telemetry WHERE patient_id = $1 AND source LIKE 'wearable%'`, [patientId]);
  const after = last?.ts ? new Date(last.ts).getTime() : -Infinity;
  const fresh = (readings ?? []).slice(-MAX_BATCH).map(clean)
    .filter((r) => Number.isFinite(r.ts) && r.ts > after && (r.hr != null || r.spo2 != null))
    .sort((a, b) => a.ts - b.ts);
  if (!fresh.length) return { added: 0, latest: null };
  const source = `wearable${device ? `:${String(device).slice(0, 60)}` : ''}`;
  try {
    await pool.query(
      `INSERT INTO telemetry (patient_id, ts, hr, spo2, source)
       SELECT $1, to_timestamp(t / 1000.0), h, s, $5
         FROM unnest($2::float8[], $3::int[], $4::int[]) AS u(t, h, s)`,
      [patientId, fresh.map((r) => r.ts), fresh.map((r) => r.hr), fresh.map((r) => r.spo2), source],
    );
  } catch (err) {
    logger.warn({ err: err.message, incidentRef }, '[vitals] could not store wearable readings');
    return { added: 0, latest: null };
  }
  const latest = fresh[fresh.length - 1];
  // Live: the crew answering the call, and any console with the incident open.
  emitTo([room.incident(incidentRef), unitRef && room.unit(unitRef)].filter(Boolean), 'patient:vitals', {
    incidentRef,
    readings: fresh.map((r) => ({ ts: new Date(r.ts).toISOString(), hr: r.hr, spo2: r.spo2 })),
    latest: { ts: new Date(latest.ts).toISOString(), hr: latest.hr, spo2: latest.spo2 },
    device,
  });
  return { added: fresh.length, latest };
}

/** Every reading kept for an incident, oldest first. */
export async function seriesFor(incidentId) {
  const { rows } = await pool.query(
    `SELECT t.ts, t.hr, t.spo2, t.bp_sys AS "bpSys", t.bp_dia AS "bpDia", t.resp_rate AS "respRate", t.source
       FROM telemetry t JOIN patients p ON p.id = t.patient_id
      WHERE p.incident_id = $1 ORDER BY t.ts`,
    [incidentId],
  );
  return rows.map((r) => ({ ...r, ts: new Date(r.ts).toISOString() }));
}

/** The series and what it shows. Null when the incident has no readings at all. */
export async function vitalsFor(incidentRef) {
  const inc = await one('SELECT id FROM incidents WHERE ref = $1', [incidentRef]);
  if (!inc) return null;
  const series = await seriesFor(inc.id);
  if (!series.length) return null;
  const wearable = series.filter((r) => r.source?.startsWith('wearable'));
  const device = wearable.find((r) => r.source.includes(':'))?.source.split(':').slice(1).join(':') ?? null;
  const used = wearable.length ? wearable : series;
  return {
    source: wearable.length ? 'wearable' : 'monitor',
    device,
    series: used.map(({ ts, hr, spo2 }) => ({ ts, hr, spo2 })),
    analysis: analyseVitals(used, { device, source: wearable.length ? 'wearable' : 'monitor' }),
  };
}
