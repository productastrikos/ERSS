/**
 * Today's operational KPIs — the Operations KPI strip. docs/06 §2.4.
 *
 * Every figure comes from v_incident_response, the same view every other screen reads,
 * so the strip can never disagree with Analytics about what "response time" means.
 */

import { pool } from '../lib/db.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { pocFleet } from '../config/poc.js';
import { kpisBetween } from '../repos/incidents.js';
import { gstMidnightIso } from './eta.js';
import * as fanout from '../realtime/fanout.js';

const round = (v) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function kpisToday(actor) {
  const from = gstMidnightIso(nowMs());
  const to = nowIso();
  const [k, fleetRes] = await Promise.all([
    kpisBetween(pool, from, to, actor?.zoneScope),
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE u.status NOT IN ('off_duty'))::int                     AS on_duty,
             COUNT(*) FILTER (WHERE u.status IN ('available','standby'))::int               AS available,
             COUNT(*)::int                                                                  AS total
        FROM units u JOIN agencies a ON a.id = u.agency_id
       WHERE u.archived_at IS NULL AND a.code = 'DCAS'
         AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))`, [pocFleet()]),
  ]);
  const f = fleetRes.rows[0];
  return {
    window: { from, to },
    source: 'v_incident_response',
    calls: k.calls,
    responded: k.responded,
    responseP50Sec: round(k.response_p50),
    responseP90Sec: round(k.response_p90),
    withinTargetPct: k.within_target_pct === null ? null : Math.round(Number(k.within_target_pct) * 10) / 10,
    acknowledgeP50Sec: round(k.ack_p50),
    turnoutMeanSec: round(k.turnout_mean),
    vrtP50Sec: round(k.vrt_p50),
    vrtSamples: k.vrt_n,
    unitsOnDuty: f.on_duty,
    unitsAvailable: f.available,
    unitsTotal: f.total,
    targetSec: jurisdiction.targets.targetResponseSec,
  };
}

/**
 * Tell consoles the KPIs moved — debounced, because a single dispatch touches the
 * incident, the assignment and the fleet, and one refetch is enough.
 */
let tickTimer = null;
export function scheduleKpiTick() {
  if (tickTimer) return;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    fanout.kpiTick(nowIso());
  }, 3000);
  tickTimer.unref?.();
}
