/**
 * Patients and telemetry. docs/03 §7, docs/07 §3.4.
 */

export async function patientRow(db, id) {
  const { rows } = await db.query(
    `SELECT p.*, i.ref AS incident_ref FROM patients p JOIN incidents i ON i.id = p.incident_id WHERE p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createPatient(db, { incidentId, assignmentId, seq = 1, chiefComplaint, ageBand, sex }) {
  const { rows } = await db.query(
    `INSERT INTO patients (incident_id, assignment_id, seq, chief_complaint, age_band, sex)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [incidentId, assignmentId ?? null, seq, chiefComplaint ?? null, ageBand ?? null, sex ?? null],
  );
  return rows[0].id;
}

/** The raw Emirates ID never reaches this far — the route hashes it first. */
export async function identifyPatient(db, id, { hash, last3 }) {
  await db.query('UPDATE patients SET eid_hash = $2, eid_last3 = $3 WHERE id = $1', [id, hash, last3]);
}

export async function insertVitals(db, patientId, sample) {
  await db.query(
    `INSERT INTO telemetry (patient_id, ts, hr, spo2, bp_sys, bp_dia, resp_rate, temp_c, etco2, rhythm, source)
     VALUES ($1, now(), $2,$3,$4,$5,$6,$7,$8,$9,'manual')`,
    [patientId, sample.hr ?? null, sample.spo2 ?? null, sample.bpSys ?? null, sample.bpDia ?? null,
     sample.respRate ?? null, sample.tempC ?? null, sample.etco2 ?? null, sample.rhythm ?? null],
  );
}

export async function setTriageTag(db, id, tag) {
  await db.query('UPDATE patients SET triage_tag = $2 WHERE id = $1', [id, tag]);
}

export async function setPrealert(db, id, hospitalId) {
  await db.query('UPDATE patients SET destination_id = $2, prealert_sent_at = now() WHERE id = $1', [id, hospitalId]);
}

export async function latestVitals(db, patientId, limit = 20) {
  const { rows } = await db.query(
    `SELECT ts, hr, spo2, bp_sys AS "bpSys", bp_dia AS "bpDia", resp_rate AS "respRate", temp_c AS "tempC", etco2, rhythm
       FROM telemetry WHERE patient_id = $1 ORDER BY ts DESC LIMIT $2`,
    [patientId, limit],
  );
  return rows;
}
