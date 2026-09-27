/**
 * The universal analytical filter (lib/filters.js) and the GST grid (lib/timegrid.js).
 *
 * These are pure: they turn a query string into SQL text plus a parameter array. What is
 * worth pinning is the part that silently goes wrong — parameter numbering, enum casting,
 * the predicates that were rewritten for the planner, the midnight-wrapping hour band, and
 * the fact that every builder owns its own params (Postgres rejects a bind carrying more
 * parameters than the statement uses).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseFilters, buildFilter, windowDays, summarise, DOW_SHORT } from '../lib/filters.js';
import { gstDayOf, shiftDayLabel, dayLabelsBetween, windowDayLabels, fillDays, fillDayHours } from '../lib/timegrid.js';

/** Every $n in the text must exist in params, and every param must be referenced. */
function assertParamsBalanced(where, params, label = '') {
  const used = new Set([...where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  for (const n of used) {
    assert.ok(n >= 1 && n <= params.length, `${label}: $${n} referenced but only ${params.length} params supplied`);
  }
  for (let n = 1; n <= params.length; n++) {
    assert.ok(used.has(n), `${label}: param $${n} supplied but never referenced — Postgres rejects that bind`);
  }
}

describe('parseFilters', () => {
  test('only filter keys are taken; an endpoint own knobs are left alone', () => {
    const f = parseFilters({ kind: 'fall', days: '30', limit: '10', ahead: '7' });
    assert.deepEqual(Object.keys(f), ['kind']);
  });

  test('comma lists become arrays, trimmed and de-duplicated', () => {
    assert.deepEqual(parseFilters({ kind: ' fall , rta , fall ' }).kind, ['fall', 'rta']);
  });

  test('an empty value is absent, not an empty filter', () => {
    assert.equal(parseFilters({ kind: '' }).kind, undefined);
  });

  test('a tri-state boolean distinguishes false from absent', () => {
    assert.equal(parseFilters({ withinTarget: 'false' }).withinTarget, false);
    assert.equal(parseFilters({ withinTarget: 'true' }).withinTarget, true);
    assert.equal(parseFilters({ withinTarget: 'any' }).withinTarget, undefined);
    assert.equal(parseFilters({}).withinTarget, undefined);
  });

  test('weekday numbers survive as numbers', () => {
    assert.deepEqual(parseFilters({ dow: '0,6' }).dow, [0, 6]);
  });

  test('an out-of-range value is rejected rather than clamped silently', () => {
    assert.throws(() => parseFilters({ hourFrom: '99' }), /Invalid filter/);
    assert.throws(() => parseFilters({ from: 'not-a-date' }), /Invalid filter/);
  });
});

describe('buildFilter — shape', () => {
  test('an empty filter still excludes the demo resting state', () => {
    const f = buildFilter({}, { source: 'incidents' });
    assert.match(f.where, /NOT i\.is_resting/);
    assert.equal(f.active, false);
  });

  test('includeResting lets the resting state back in', () => {
    const f = buildFilter(parseFilters({ includeResting: 'true' }), { source: 'incidents' });
    assert.doesNotMatch(f.where, /is_resting/);
  });

  test('on the view, the resting state is excluded through the incident, not a column', () => {
    const f = buildFilter({}, { source: 'response' });
    assert.match(f.where, /NOT EXISTS \(SELECT 1 FROM incidents ri/);
  });

  test('parameters are balanced on a heavily filtered build', () => {
    const q = parseFilters({
      kind: 'fall,rta', priority: 'P1,P2', source: 'call_998', outcome: 'transported',
      zone: 'Z-1,Z-2', zoneClass: 'urban', unitKind: 'ALS', agency: 'DCAS', station: 'STN-1',
      dow: '1,2', hourFrom: '6', hourTo: '21', floorMin: '0', floorMax: '50',
      acuityMin: '1', acuityMax: '3', responseMinSec: '60', responseMaxSec: '900',
      withinTarget: 'false', highrise: 'false', transported: 'true', multiAgency: 'false', seeded: 'true',
    });
    for (const source of ['incidents', 'response']) {
      const f = buildFilter(q, { source, window: { days: 30 } });
      assertParamsBalanced(f.where, f.params, source);
    }
  });

  test('every builder owns its own parameter array', () => {
    const q = parseFilters({ kind: 'fall' });
    const a = buildFilter(q, { source: 'incidents', window: { days: 30 } });
    const b = buildFilter(q, { source: 'incidents', window: { days: 30 } });
    assert.notEqual(a.params, b.params);
    assert.deepEqual(a.params, b.params);
  });
});

describe('buildFilter — the predicates that were easy to get wrong', () => {
  test('enum columns are compared as text', () => {
    // `priority = ANY($1)` against an enum cannot resolve an operator.
    const f = buildFilter(parseFilters({ priority: 'P1' }), { source: 'response' });
    assert.match(f.where, /r\.priority::text = ANY/);
  });

  test('an hour band that wraps midnight becomes an OR, not an impossible BETWEEN', () => {
    const f = buildFilter(parseFilters({ hourFrom: '22', hourTo: '4' }), { source: 'response' });
    assert.match(f.where, />= \$\d+ OR .*<= \$\d+/s);
    assert.doesNotMatch(f.where, /BETWEEN/);
  });

  test('a band that does not wrap uses BETWEEN', () => {
    const f = buildFilter(parseFilters({ hourFrom: '6', hourTo: '9' }), { source: 'response' });
    assert.match(f.where, /BETWEEN/);
  });

  test('a zone ref matches the whole subtree beneath it', () => {
    const f = buildFilter(parseFilters({ zone: 'Z-SEC-1' }), { source: 'incidents' });
    assert.match(f.where, /WITH RECURSIVE picked/);
  });

  test('responder predicates resolve a unit set first, as ANY(ARRAY(...))', () => {
    // `IN (subquery)` lets the planner flatten this into a semi-join driven from the
    // assignment side — 2.3s instead of 50ms. The ARRAY form keeps it correlated.
    const f = buildFilter(parseFilters({ agency: 'DCAS' }), { source: 'incidents' });
    assert.match(f.where, /ANY\(ARRAY\(SELECT fu\.id FROM units fu/);
    assert.doesNotMatch(f.where, /fa\.unit_id IN \(SELECT/);
  });

  test('the view uses its own projected unit column instead of a lookup', () => {
    const f = buildFilter(parseFilters({ agency: 'DCAS' }), { source: 'response' });
    assert.match(f.where, /r\.unit_id = ANY\(ARRAY/);
    assert.doesNotMatch(f.where, /EXISTS \(SELECT 1 FROM assignments/);
  });

  test('target attainment uses the shared function on the base table, not a view lookup', () => {
    const f = buildFilter(parseFilters({ withinTarget: 'false' }), { source: 'incidents' });
    assert.match(f.where, /erss_within_target\(i\.priority, i\.reported_at, i\.first_onscene_at\) IS FALSE/);
    assert.doesNotMatch(f.where, /v_incident_response/);
  });

  test('the same filter on the view reads the projected column', () => {
    const f = buildFilter(parseFilters({ withinTarget: 'true' }), { source: 'response' });
    assert.match(f.where, /r\.within_target IS TRUE/);
  });

  test('high-rise false includes calls with no floor recorded', () => {
    const f = buildFilter(parseFilters({ highrise: 'false' }), { source: 'response' });
    assert.match(f.where, /IS NULL OR/);
  });
});

describe('buildFilter — windows', () => {
  test('an explicit range wins over the endpoint default', () => {
    const f = buildFilter(parseFilters({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }),
      { source: 'incidents', window: { days: 30 } });
    assert.equal(f.params.filter((p) => typeof p === 'string' && p.includes('2026-')).length, 2);
    assert.doesNotMatch(f.where, /interval/);
  });

  test('shift moves a relative window back by whole windows', () => {
    const now = buildFilter({}, { source: 'response', window: { days: 30 }, shift: 0 });
    const prior = buildFilter({}, { source: 'response', window: { days: 30 }, shift: 1 });
    assert.deepEqual(now.params, ['30']);
    assert.deepEqual(prior.params, ['60', '30']);   // >= 60 days ago AND < 30 days ago
  });

  test('shift moves an explicit range back by its own length', () => {
    const prior = buildFilter(parseFilters({ from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' }),
      { source: 'response', window: { days: 30 }, shift: 1 });
    assert.ok(prior.params[0].startsWith('2026-01-30'), `prior window started at ${prior.params[0]}`);
  });

  test('skipWindow writes no time predicate at all', () => {
    const f = buildFilter({}, { source: 'incidents', window: { days: 30 }, skipWindow: true });
    assert.doesNotMatch(f.where, /reported_at/);
  });

  test('windowDays measures an explicit range and falls back otherwise', () => {
    assert.equal(windowDays({ from: '2026-01-01T00:00:00Z', to: '2026-01-31T00:00:00Z' }, 99), 30);
    assert.equal(windowDays({}, 45), 45);
  });
});

describe('buildFilter — what the panel prints', () => {
  test('describe names each applied dimension in words', () => {
    const f = buildFilter(parseFilters({ priority: 'P1,P2', dow: '1', hourFrom: '22', hourTo: '4' }), { source: 'response' });
    const text = summarise(f.describe);
    assert.match(text, /Priority: P1, P2/);
    assert.match(text, new RegExp(`Weekday: ${DOW_SHORT[1]}`));
    assert.match(text, /22:00–04:59 GST/);
    assert.equal(f.active, true);
  });

  test('an unfiltered build says so rather than printing nothing', () => {
    assert.match(summarise([]), /No filter/);
  });
});

describe('timegrid', () => {
  test('a GST day is the UTC day shifted four hours', () => {
    // 2026-03-01T21:00Z is already 01:00 on the 2nd in Dubai.
    assert.equal(gstDayOf(Date.parse('2026-03-01T21:00:00Z')), '2026-03-02');
    assert.equal(gstDayOf(Date.parse('2026-03-01T19:59:00Z')), '2026-03-01');
  });

  test('day labels step across a month and a year boundary', () => {
    assert.equal(shiftDayLabel('2026-01-31', 1), '2026-02-01');
    assert.equal(shiftDayLabel('2026-01-01', -1), '2025-12-31');
    assert.equal(dayLabelsBetween('2026-02-26', '2026-03-02').length, 5);
  });

  test('a relative window yields days+1 labels, ending today', () => {
    const labels = windowDayLabels({}, 30, '2026-09-19');
    assert.equal(labels.length, 31);
    assert.equal(labels.at(-1), '2026-09-19');
    assert.equal(labels[0], '2026-08-20');
  });

  test('fillDays turns a sparse group-by into a hole-free series', () => {
    const rows = [{ day: '2026-09-02', n: 5 }];
    const out = fillDays(rows, dayLabelsBetween('2026-09-01', '2026-09-03'), 'day', (r, day) => ({ day, n: r?.n ?? 0 }));
    assert.deepEqual(out, [
      { day: '2026-09-01', n: 0 },
      { day: '2026-09-02', n: 5 },
      { day: '2026-09-03', n: 0 },
    ]);
  });

  test('fillDayHours yields 24 ordered buckets per day', () => {
    const out = fillDayHours([{ day: '2026-09-01', hour: 3, n: 7 }], ['2026-09-01', '2026-09-02'],
      (r, day, hour) => ({ day, hour, n: r?.n ?? 0 }));
    assert.equal(out.length, 48);
    assert.equal(out[3].n, 7);
    assert.equal(out[4].n, 0);
    assert.deepEqual(out.slice(0, 3).map((x) => x.hour), [0, 1, 2]);
  });
});
