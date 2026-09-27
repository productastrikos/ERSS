/**
 * State machines — docs/03 §3. No database.
 *
 * These tables decide what the API accepts AND which buttons the console shows, so a
 * transition that passes here but is wrong is wrong in both places at once.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedActions, transitionError, deriveIncidentState, derivedIncidentStamps, closeBlocker,
  ASSIGNMENT_ACTIONS,
} from '../domain/lifecycle.js';

describe('assignment transitions', () => {
  test('a crew walks the whole happy path in order', () => {
    const path = [
      ['offered', 'acknowledge', 'acknowledged'],
      ['acknowledged', 'enroute', 'enroute'],
      ['enroute', 'onscene', 'onscene'],
      ['onscene', 'transporting', 'transporting'],
      ['transporting', 'at_hospital', 'at_hospital'],
      ['at_hospital', 'clear', 'cleared'],
    ];
    for (const [from, action, to] of path) {
      assert.ok(allowedActions({ state: from }).includes(action), `${action} should be allowed from ${from}`);
      assert.equal(transitionError(action, { state: from }, { hospitalRef: 'HOS-01' }), null);
      assert.equal(ASSIGNMENT_ACTIONS[action].to, to);
    }
  });

  test('skipping a stage is refused with a readable reason', () => {
    assert.match(transitionError('onscene', { state: 'offered' }), /Cannot onscene an assignment that is offered/);
    assert.match(transitionError('clear', { state: 'enroute' }), /enroute/);
  });

  test('decline and stand-down need a reason; transport needs a hospital', () => {
    assert.match(transitionError('decline', { state: 'offered' }, {}), /reason/);
    assert.match(transitionError('cancel', { state: 'enroute' }, { reason: '  ' }), /reason/);
    assert.match(transitionError('transporting', { state: 'onscene' }, {}), /hospitalRef/);
  });

  test('a unit that cannot carry a patient is never offered transport', () => {
    assert.ok(!allowedActions({ state: 'onscene' }, { canTransport: false }).includes('transporting'));
    assert.ok(allowedActions({ state: 'onscene' }, { canTransport: false }).includes('resolve'));
    assert.match(transitionError('transporting', { state: 'onscene' }, { hospitalRef: 'HOS-01' }, { canTransport: false, unitKind: 'MRU' }),
      /MRU cannot transport/);
  });

  test('at-patient happens once and does not change the state', () => {
    assert.ok(allowedActions({ state: 'onscene', at_patient_at: null }).includes('at_patient'));
    assert.ok(!allowedActions({ state: 'onscene', at_patient_at: '2026-09-16T10:00:00Z' }).includes('at_patient'));
    assert.equal(ASSIGNMENT_ACTIONS.at_patient.to, 'onscene');
  });

  test('the system-only timeout is never offered as a button', () => {
    assert.ok(!allowedActions({ state: 'offered' }).includes('timeout'));
    assert.equal(transitionError('timeout', { state: 'offered' }), null);
  });

  test('a finished assignment offers nothing', () => {
    for (const state of ['cleared', 'cancelled', 'declined', 'timed_out']) {
      assert.deepEqual(allowedActions({ state }), [], state);
    }
  });
});

describe('incident state is derived from its assignments', () => {
  const inc = { state: 'triaged', triaged_at: '2026-09-16T10:00:00Z' };

  test('follows the most advanced live assignment', () => {
    assert.equal(deriveIncidentState(inc, [{ state: 'offered' }]), 'dispatched');
    assert.equal(deriveIncidentState(inc, [{ state: 'offered' }, { state: 'enroute' }]), 'responding');
    assert.equal(deriveIncidentState(inc, [{ state: 'enroute' }, { state: 'onscene' }]), 'on_scene');
    assert.equal(deriveIncidentState(inc, [{ state: 'transporting' }]), 'transporting');
  });

  test('falls back to triaged when every offer failed — reassignment returns it to the queue', () => {
    assert.equal(deriveIncidentState(inc, [{ state: 'timed_out' }, { state: 'declined' }]), 'triaged');
    assert.equal(deriveIncidentState({ state: 'reported', triaged_at: null }, []), 'reported');
  });

  test('a cleared unit keeps the incident at what it achieved', () => {
    assert.equal(deriveIncidentState(inc, [{ state: 'cleared', onscene_at: 'x', transporting_at: 'y', at_hospital_at: 'z' }]), 'at_hospital');
    assert.equal(deriveIncidentState(inc, [{ state: 'cleared', onscene_at: 'x' }]), 'resolved_on_scene');
  });

  test('closed stays closed', () => {
    assert.equal(deriveIncidentState({ state: 'closed' }, [{ state: 'enroute' }]), 'closed');
  });

  test('the first arrival across all units stops the headline clock', () => {
    const s = derivedIncidentStamps([
      { onscene_at: '2026-09-16T10:09:00Z', at_patient_at: null },
      { onscene_at: '2026-09-16T10:07:30Z', at_patient_at: '2026-09-16T10:12:00Z' },
    ]);
    assert.equal(s.first_onscene_at, '2026-09-16T10:07:30.000Z');
    assert.equal(s.first_at_patient_at, '2026-09-16T10:12:00.000Z');
  });

  test('closing is blocked while a crew has the patient, not before arrival', () => {
    assert.equal(closeBlocker([{ state: 'enroute', unit_ref: 'AMB-01' }]), null);
    assert.match(closeBlocker([{ state: 'transporting', unit_ref: 'AMB-02' }]), /AMB-02 still has the patient/);
  });
});
