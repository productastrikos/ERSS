/**
 * Phase 5 flow — the definition of done, executed against the RUNNING backend.
 *
 *   npm run test:flow          (backend on PORT, database seeded)
 *
 * "An incident can be created, recommended, dispatched, tracked and closed entirely from
 * the console, with the rationale visible at every step and every stage timestamp
 * landing correctly in the database." Every clause of that sentence is asserted below,
 * plus the paths that go wrong: decline, timeout, re-dispatch, exhaustion, a close over a
 * crew's head, a double click, and a phone listening in on the console.
 *
 * Not part of `npm test`: it needs a live server and writes to the database. Everything it
 * creates is removed at the end, and every unit it touched is put back as it was.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';

import { env } from '../../config/env.js';
import { pool } from '../../lib/db.js';
import { jurisdiction } from '../../config/jurisdiction.js';

const BASE = `http://localhost:${env.port}`;
const PASSWORD = 'erss2026';
const created = [];
let unitSnapshot = [];

// ── helpers ─────────────────────────────────────────────────────────────────

async function login(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  assert.equal(res.status, 200, `login ${identifier}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    return { status: r.status, body: json, headers: r.headers };
  };
  return { cookie, call };
}

function listen(cookie) {
  const socket = connect(BASE, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true });
  const events = [];
  socket.onAny((event, payload) => events.push({ event, payload }));
  const ready = new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, events, ready };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, { timeoutMs = 15_000, everyMs = 250 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

async function createIncident(api, body) {
  const r = await api.call('POST', '/api/incidents', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  created.push(r.body.incident.ref);
  return r.body;
}

// ── fixtures ────────────────────────────────────────────────────────────────

let dispatcher;
let police;
let responder;
let citizen;
let TOWER;          // a Makani entrance on a tall building

before(async () => {
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  assert.equal(health?.database, 'up', `backend not reachable at ${BASE} — start it with npm run dev`);

  const { rows: units } = await pool.query('SELECT id, status, current_geom, last_seen_at, standby_geom FROM units');
  unitSnapshot = units;

  const { rows } = await pool.query(
    `SELECT m.makani, m.floors FROM makani_points m JOIN zones z ON z.id = m.zone_id
      WHERE z.name = 'Al Barsha 1' AND m.floors >= 40 ORDER BY m.makani LIMIT 1`,
  );
  TOWER = rows[0];
  assert.ok(TOWER, 'seed has no Al Barsha tower');

  [dispatcher, police, responder, citizen] = await Promise.all([
    login('DSP-4A1C'), login('POL-5D31'), login('RSP-AMB14'), login('CIT-71BE'),
  ]);
});

after(async () => {
  // Remove what this run created, and put every unit back exactly as it was.
  if (created.length) {
    await pool.query(`UPDATE advisories SET incident_id = NULL WHERE incident_id IN (SELECT id FROM incidents WHERE ref = ANY($1))`, [created]);
    await pool.query(`DELETE FROM incidents WHERE ref = ANY($1)`, [created]);
  }
  for (const u of unitSnapshot) {
    await pool.query(
      `UPDATE units SET status = $2, current_geom = $3, last_seen_at = $4, standby_geom = $5 WHERE id = $1`,
      [u.id, u.status, u.current_geom, u.last_seen_at, u.standby_geom],
    );
  }
  await pool.end();
});

// ═══════════════════════════════════════════════════════════════════════════════

describe('dispatch flow', () => {
  test('create → recommend → dispatch → track → close, stamped and explained at every step', async () => {
    const console1 = listen(dispatcher.cookie);
    const phone = listen(citizen.cookie);
    await Promise.all([console1.ready, phone.ready]);
    await until('units:snapshot on join', () => console1.events.find((e) => e.event === 'units:snapshot'));

    // Create — the recommendation arrives with it.
    const { incident, recommendation } = await createIncident(dispatcher, {
      kind: 'cardiac_arrest', priority: 'P1', source: 'call_998', makani: TOWER.makani, floor: 30,
      chiefComplaint: 'Collapsed, not breathing', callerRole: 'bystander',
    });
    assert.match(incident.ref, /^INC-\d{6}-\d{4,}$/);
    assert.equal(incident.state, 'triaged');
    assert.equal(incident.floor, 30);
    assert.ok(incident.building?.entranceCount >= 1);

    const recs = recommendation.value.recommendations;
    assert.ok(recs.length > 0, 'no recommendation');
    assert.equal(recommendation.method, 'weighted-multicriteria-v1');
    assert.ok(recommendation.window.from && recommendation.inputs.length);
    for (const r of recs) {
      assert.deepEqual(r.rationale.factors.map((f) => f.key), ['travel', 'capability', 'coverage', 'crew', 'equity']);
      assert.ok(r.arrivalSec > 0 && r.etaMethod.startsWith('pace-calibrated-v1'));
    }
    assert.ok(recommendation.value.vrt?.value?.seconds > 0, 'a floor 30 call has a vertical stage');

    await until('incident:new', () => console1.events.find((e) => e.event === 'incident:new' && e.payload.ref === incident.ref));
    console1.socket.emit('incident:watch', { ref: incident.ref });

    // Prefer a unit that can carry the patient to hospital, so the whole lifecycle runs.
    const pick = recs.find((r) => r.canTransport) ?? recs[0];
    const overrideReason = pick.rank === 1 ? undefined : 'Transporting unit — test';
    const key = randomUUID();
    const d1 = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: pick.unitRef, overrideReason }, { 'Idempotency-Key': key });
    assert.equal(d1.status, 201, JSON.stringify(d1.body));
    const asg = d1.body.assignment;
    assert.equal(asg.state, 'offered');
    assert.deepEqual(asg.allowedActions, ['acknowledge', 'decline', 'cancel']);
    assert.equal(asg.dispatchRationale.selected.rank, pick.rank);
    assert.ok(asg.etaPredictedAt, 'a predicted arrival is stored');

    // A double click replays; it does not send a second ambulance.
    const d2 = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: pick.unitRef, overrideReason }, { 'Idempotency-Key': key });
    assert.equal(d2.status, 201);
    assert.equal(d2.headers.get('idempotent-replayed'), 'true');
    assert.equal(d2.body.assignment.ref, asg.ref);
    const count = await pool.query('SELECT COUNT(*)::int n FROM assignments a JOIN incidents i ON i.id = a.incident_id WHERE i.ref = $1', [incident.ref]);
    assert.equal(count.rows[0].n, 1);

    // The unit is now busy.
    const busy = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: pick.unitRef, overrideReason: 'again' });
    assert.equal(busy.status, 409);

    // A responder cannot move someone else's assignment, nor stand anything down.
    const foreign = await responder.call('POST', `/api/assignments/${asg.ref}/acknowledge`);
    if (pick.unitRef !== 'AMB-14') assert.equal(foreign.status, 403);

    // Track — every stage, logged from the console as a radio call would be.
    const steps = [['acknowledge'], ['enroute'], ['onscene'], ['at-patient', { liftUsed: true }]];
    for (const [action, body] of steps) {
      await sleep(1100);   // distinct, measurable stage durations
      const r = await dispatcher.call('POST', `/api/assignments/${asg.ref}/${action}`, body);
      assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
    }

    // Closing over a crew with the patient is refused.
    const blocked = await dispatcher.call('POST', `/api/incidents/${incident.ref}/close`, { outcome: 'transported' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error.message, /clear the unit first/);

    const hospitals = await dispatcher.call('GET', `/api/hospitals/recommend?incident=${incident.ref}`);
    assert.equal(hospitals.status, 200);
    assert.equal(hospitals.body.value.requirement.capability, 'cath_lab');
    const dest = hospitals.body.value.hospitals[0];
    assert.ok(dest.capabilities.includes('cath_lab') && dest.reasoning.length > 20);

    for (const [action, body] of [['transporting', { hospitalRef: dest.ref }], ['at-hospital'], ['clear']]) {
      await sleep(1100);
      const r = await dispatcher.call('POST', `/api/assignments/${asg.ref}/${action}`, body);
      assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
    }

    const closed = await dispatcher.call('POST', `/api/incidents/${incident.ref}/close`, { outcome: 'transported' });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.state, 'closed');

    // Every stage timestamp landed, in order, and the ONE response definition agrees.
    const { rows: [a] } = await pool.query(
      `SELECT a.* FROM assignments a WHERE a.ref = $1`, [asg.ref]);
    const order = ['offered_at', 'acknowledged_at', 'enroute_at', 'onscene_at', 'at_patient_at', 'transporting_at', 'at_hospital_at', 'cleared_at'];
    for (let i = 1; i < order.length; i++) {
      assert.ok(a[order[i]], `${order[i]} stamped`);
      assert.ok(a[order[i]] >= a[order[i - 1]], `${order[i]} after ${order[i - 1]}`);
    }
    assert.ok(a.vrt_sec >= 1, 'vertical response time measured');
    assert.ok(a.vrt_breakdown.predictedSec > 0, 'and compared with its prediction');
    assert.ok(a.eta_error_sec !== null, 'the ETA is held to account');
    assert.ok(a.dispatch_rationale.selected.factors.length === 5, 'the rationale is kept');

    const { rows: [v] } = await pool.query('SELECT * FROM v_incident_response WHERE ref = $1', [incident.ref]);
    const { rows: [i] } = await pool.query('SELECT * FROM incidents WHERE ref = $1', [incident.ref]);
    assert.ok(i.triaged_at && i.dispatched_at && i.first_onscene_at && i.first_at_patient_at && i.closed_at);
    assert.equal(v.response_sec, Math.round((i.first_onscene_at - i.reported_at) / 1000));
    assert.equal(v.acknowledge_sec, Math.round((a.acknowledged_at - a.offered_at) / 1000));
    assert.equal(v.travel_sec, Math.round((a.onscene_at - a.enroute_at) / 1000));
    assert.equal(v.unit_ref, pick.unitRef);

    // The timeline tells the story in order, attributed.
    const detail = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
    const stages = detail.body.timeline.map((t) => t.stage);
    for (const s of ['reported', 'triaged', 'dispatched', 'unit_acknowledged', 'unit_enroute', 'unit_onscene', 'crew_at_patient', 'transporting', 'at_hospital', 'unit_cleared', 'closed']) {
      assert.ok(stages.includes(s), `timeline has ${s}`);
    }
    assert.ok(detail.body.timeline.find((t) => t.stage === 'unit_enroute').label.includes('logged by DSP-4A1C'));

    // Live: the watching console heard the lifecycle; the citizen's phone heard none of it.
    await until('timeline events', () => console1.events.filter((e) => e.event === 'incident:timeline').length >= 8);
    assert.ok(console1.events.some((e) => e.event === 'unit:position' && e.payload.some((f) => f.unitRef === pick.unitRef)));
    assert.ok(console1.events.some((e) => e.event === 'incident:closed' && e.payload.ref === incident.ref));
    const leaked = phone.events.filter((e) => e.event.startsWith('incident') || e.event.startsWith('unit'));
    assert.deepEqual(leaked, [], 'a citizen socket received console traffic');

    console1.socket.close();
    phone.socket.close();
  });

  test('a decline re-dispatches to a different unit automatically', async () => {
    const { incident, recommendation } = await createIncident(dispatcher, {
      kind: 'medical_general', priority: 'P3', source: 'call_998', lng: 55.2260, lat: 25.1330, chiefComplaint: 'Fever',
    });
    const first = recommendation.value.recommendations[0];
    const d = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: first.unitRef });
    assert.equal(d.status, 201);

    const noReason = await dispatcher.call('POST', `/api/assignments/${d.body.assignment.ref}/decline`, {});
    assert.equal(noReason.status, 409);
    const declined = await dispatcher.call('POST', `/api/assignments/${d.body.assignment.ref}/decline`, { reason: 'Vehicle defect' });
    assert.equal(declined.status, 200);
    assert.equal(declined.body.assignment.state, 'declined');

    const next = await until('automatic re-dispatch', async () => {
      const r = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
      return r.body.assignments.find((a) => a.state === 'offered');
    });
    assert.notEqual(next.unitRef, first.unitRef);
    assert.equal(next.dispatchRationale.redispatch.reason, 'decline');
    assert.equal(next.isPrimary, true);
    const detail = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
    assert.ok(detail.body.timeline.some((t) => t.stage === 'redispatched' && t.actorKind === 'system'));

    // Standing down pre-arrival on close.
    const closed = await dispatcher.call('POST', `/api/incidents/${incident.ref}/close`, { outcome: 'cancelled_by_caller' });
    assert.equal(closed.status, 200);
    const after = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
    assert.equal(after.body.assignments.find((a) => a.ref === next.ref).state, 'cancelled');
  });

  test('an unacknowledged offer times out, re-dispatches, and stops after the cap', async () => {
    const { incident, recommendation } = await createIncident(dispatcher, {
      kind: 'trauma_fall', priority: 'P3', source: 'call_998', lng: 55.1990, lat: 25.1130, chiefComplaint: 'Fall on same level',
    });
    const d = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: recommendation.value.recommendations[0].unitRef });
    assert.equal(d.status, 201);

    // Age every live offer past the window; the sweep (every 2 s) takes it from there.
    const age = () => pool.query(
      `UPDATE assignments a SET offered_at = offered_at - make_interval(secs => $2)
         FROM incidents i WHERE i.id = a.incident_id AND i.ref = $1 AND a.state = 'offered'`,
      [incident.ref, jurisdiction.dispatch.acknowledgeTimeoutSec + 5],
    );

    const cap = jurisdiction.dispatch.maxAutoRedispatch;
    for (let n = 1; n <= cap + 1; n++) {
      await age();
      await until(`timeout ${n}`, async () => {
        const r = await pool.query(
          `SELECT COUNT(*) FILTER (WHERE a.state = 'timed_out')::int AS t FROM assignments a JOIN incidents i ON i.id = a.incident_id WHERE i.ref = $1`,
          [incident.ref]);
        return r.rows[0].t >= n;
      });
      if (n <= cap) {
        await until(`re-offer after timeout ${n}`, async () => {
          const r = await pool.query(
            `SELECT COUNT(*)::int AS o FROM assignments a JOIN incidents i ON i.id = a.incident_id WHERE i.ref = $1 AND a.state = 'offered'`,
            [incident.ref]);
          return r.rows[0].o === 1;
        });
      }
    }

    const detail = await until('exhaustion recorded', async () => {
      const r = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
      return r.body.timeline.some((t) => t.stage === 'redispatch_exhausted') ? r.body : null;
    });
    assert.equal(detail.incident.state, 'triaged', 'back in the queue for a person');
    const units = new Set(detail.assignments.map((a) => a.unitRef));
    assert.equal(units.size, cap + 1, 'every offer went to a different unit');
    assert.ok(detail.assignments.every((a) => a.state === 'timed_out' && a.isPrimary === false));

    await dispatcher.call('POST', `/api/incidents/${incident.ref}/close`, { outcome: 'no_patient_found' });
  });

  test('correlated agencies are notified on dispatch and their SLA clock is measured', async () => {
    const { incident, recommendation } = await createIncident(dispatcher, {
      kind: 'rta', priority: 'P2', source: 'call_999', lng: 55.2390, lat: 25.1460, chiefComplaint: 'Vehicle collision', patientsCount: 2,
    });
    const corr = await dispatcher.call('GET', `/api/incidents/${incident.ref}/correlation`);
    assert.equal(corr.status, 200);
    assert.deepEqual(corr.body.value.recommendedAgencies.map((a) => a.code).sort(), ['POLICE', 'RTA']);
    assert.equal(corr.body.confidence, null);
    assert.equal(corr.body.meta.rulesBased, true);

    const d = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: recommendation.value.recommendations[0].unitRef });
    assert.equal(d.status, 201);

    const before = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
    assert.deepEqual(before.body.notifications.map((n) => n.agencyCode).sort(), ['POLICE', 'RTA']);
    // An array, not the Postgres literal '{DCAS,POLICE}' — which also has .includes().
    assert.ok(Array.isArray(before.body.incident.agenciesInvolved), 'agenciesInvolved is an array');
    assert.deepEqual([...before.body.incident.agenciesInvolved].sort(), ['DCAS', 'POLICE', 'RTA']);

    // Police acknowledge for themselves; they may not acknowledge for RTA.
    const ack = await police.call('POST', `/api/incidents/${incident.ref}/notifications/POLICE/acknowledge`);
    assert.equal(ack.status, 200, JSON.stringify(ack.body));
    const pol = ack.body.find((n) => n.agencyCode === 'POLICE');
    assert.equal(pol.met, true);
    assert.equal(pol.acknowledgedBy, 'POL-5D31');
    const notTheirs = await police.call('POST', `/api/incidents/${incident.ref}/notifications/RTA/acknowledge`);
    assert.equal(notTheirs.status, 403);

    const note = await police.call('POST', `/api/incidents/${incident.ref}/notes`, { body: 'Two patrols diverted to the junction' });
    assert.equal(note.status, 201);
    const after = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
    assert.equal(after.body.notes[0].agencyCode, 'POLICE');

    await dispatcher.call('POST', `/api/incidents/${incident.ref}/close`, { outcome: 'treated_released' });
  });

  test('on scene is stamped from the unit\'s own position fix, and the route taken is recorded', async () => {
    // AMB-14 is bound to the demo responder account, whose phone reports positions.
    const { rows: [unit] } = await pool.query(
      `SELECT ST_X(current_geom) AS lng, ST_Y(current_geom) AS lat, status FROM units WHERE ref = 'AMB-14'`);
    if (unit.status !== 'available' && unit.status !== 'standby') {
      await pool.query(`UPDATE units SET status = 'available' WHERE ref = 'AMB-14'`);
    }
    // An incident ~1.2 km east of the unit, so the drive is short and the fixes are plausible.
    const target = { lng: unit.lng + 0.012, lat: unit.lat };
    const { incident } = await createIncident(dispatcher, {
      kind: 'medical_general', priority: 'P3', source: 'call_998', lng: target.lng, lat: target.lat, chiefComplaint: 'Dizziness',
    });

    // The phone is online BEFORE the dispatch: the offer is pushed once, at commit. (A phone
    // that connects later reads its assignment over REST — the socket is enrichment.)
    const phone = listen(responder.cookie);
    await phone.ready;

    const d = await dispatcher.call('POST', `/api/incidents/${incident.ref}/assignments`, { unitRef: 'AMB-14', overrideReason: 'Position-fix test' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    const asgRef = d.body.assignment.ref;
    const offer = await until('offer pushed to the unit', () => phone.events.find((e) => e.event === 'assignment:offer' && e.payload.assignment.ref === asgRef));
    assert.equal(offer.payload.incident.ref, incident.ref);
    assert.ok(offer.payload.acknowledgeBy, 'the offer carries its acknowledge deadline');

    // …and the same assignment over REST, for a phone that was not listening.
    const unitView = await dispatcher.call('GET', '/api/units/AMB-14');
    assert.equal(unitView.body.assignment.ref, asgRef);

    // The crew acts from its own phone.
    assert.equal((await responder.call('POST', `/api/assignments/${asgRef}/acknowledge`)).status, 200);
    assert.equal((await responder.call('POST', `/api/assignments/${asgRef}/enroute`)).status, 200);

    const console1 = listen(dispatcher.cookie);
    await console1.ready;

    // Drive in: fixes 6 s apart (the server persists at most one per 5 s), the last two
    // inside the arrival radius.
    const path = [0.25, 0.6, 0.995, 0.999].map((f) => ({ lng: unit.lng + (target.lng - unit.lng) * f, lat: unit.lat }));
    const arrivedFixAt = [];
    for (const [i, p] of path.entries()) {
      phone.socket.emit('unit:position', { lng: p.lng, lat: p.lat, speed: 40, heading: 90 });
      if (i === 2) arrivedFixAt.push(Date.now());
      await sleep(6000);
    }
    const frame = await until('batched position frame on the console', () =>
      console1.events.find((e) => e.event === 'unit:position' && e.payload.some((f) => f.unitRef === 'AMB-14' && f.status === 'responding')));
    assert.ok(frame);

    // The crew presses "on scene" late — 6 s after the fix that put it at the entrance.
    const onscene = await responder.call('POST', `/api/assignments/${asgRef}/onscene`);
    assert.equal(onscene.status, 200, JSON.stringify(onscene.body));

    const { rows: [a] } = await pool.query(
      `SELECT onscene_at, enroute_at, route_taken_m, ST_NPoints(route_taken) AS pts FROM assignments WHERE ref = $1`, [asgRef]);
    const pressedAt = Date.now();
    assert.ok(a.onscene_at.getTime() < pressedAt - 3000, 'on scene was stamped from the fix, not the button');
    assert.ok(Math.abs(a.onscene_at.getTime() - arrivedFixAt[0]) < 2500, 'and from the first fix inside the radius');
    assert.ok(a.pts >= 2 && a.route_taken_m > 500, `route taken recorded (${a.pts} points, ${a.route_taken_m} m)`);

    const detail = await dispatcher.call('GET', `/api/incidents/${incident.ref}`);
    assert.ok(detail.body.timeline.some((t) => t.stage === 'unit_onscene' && t.label.includes('stamped from its position fix')));

    // Clean up the unit's positions from this test too.
    await pool.query(`DELETE FROM unit_positions WHERE unit_id = (SELECT id FROM units WHERE ref = 'AMB-14') AND ts >= $1`, [a.enroute_at]);
    await responder.call('POST', `/api/assignments/${asgRef}/clear`);
    await dispatcher.call('POST', `/api/incidents/${incident.ref}/close`, { outcome: 'treated_released' });
    phone.socket.close();
    console1.socket.close();
  });

  test('roles without the capability are refused on the server', async () => {
    const create = await police.call('POST', '/api/incidents', { kind: 'rta', source: 'call_999', lng: 55.2, lat: 25.1 });
    assert.equal(create.status, 403);
    const list = await citizen.call('GET', '/api/incidents');
    assert.equal(list.status, 403);
    const units = await citizen.call('GET', '/api/units');
    assert.equal(units.status, 403);
    const kpi = await dispatcher.call('GET', '/api/kpi/today');
    assert.equal(kpi.status, 200);
    assert.equal(kpi.body.source, 'v_incident_response');
  });
});
