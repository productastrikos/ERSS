/**
 * Reads for the Phase 6 raw engines (anomaly, equity, coverage, crowd, preempt, demand,
 * risk). SQL lives here; the engines stay pure. docs/08.
 */

import { pocFleet } from '../config/poc.js';

/** Hourly call-volume series per community zone, oldest → newest, for anomaly detection. */
export async function zoneHourlySeries(db, { hours = 168, zones = null, zoneClasses = null } = {}) {
  const { rows } = await db.query(
    `SELECT h.zone_id AS "zoneId", z.ref AS "zoneRef", z.name AS "zoneName",
            h.bucket, h.calls
       FROM v_zone_hourly h
       JOIN zones z ON z.id = h.zone_id
      WHERE h.bucket >= now() - ($1 || ' hours')::interval
        AND z.level = 'community'
        AND ($2::text[] IS NULL OR z.ref = ANY($2)
             OR z.parent_id IN (SELECT id FROM zones WHERE ref = ANY($2)))
        AND ($3::text[] IS NULL OR z.class = ANY($3))
      ORDER BY h.zone_id, h.bucket`,
    [hours, zones?.length ? zones : null, zoneClasses?.length ? zoneClasses : null],
  );
  const byZone = new Map();
  for (const r of rows) {
    if (!byZone.has(r.zoneId)) byZone.set(r.zoneId, { zoneRef: r.zoneRef, zoneName: r.zoneName, points: [] });
    byZone.get(r.zoneId).points.push({ bucket: r.bucket, value: r.calls });
  }
  return byZone;
}

/** Per-zone p90 response time and sample size over a window, plus the emirate-wide p90. */
export async function equityInputs(db, { from, to }) {
  const [zones, emirate, distances] = await Promise.all([
    db.query(
      `SELECT z.id AS "zoneId", z.ref AS "zoneRef", z.name AS "zoneName",
              COUNT(*)::int AS "sampleN",
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS "p90ResponseSec"
         FROM v_incident_response r
         JOIN zones z ON z.id = r.zone_id
        WHERE r.reported_at BETWEEN $1 AND $2 AND z.level = 'community'
        GROUP BY z.id, z.ref, z.name`,
      [from, to],
    ),
    db.query(
      `SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY response_sec) AS p90
         FROM v_incident_response WHERE reported_at BETWEEN $1 AND $2`,
      [from, to],
    ),
    db.query(
      `SELECT z.id AS "zoneId",
              MIN(ST_Distance(z.centroid::geography, s.geom::geography)) AS "distanceToStationM"
         FROM zones z
         CROSS JOIN stations s
        WHERE z.level = 'community' AND s.dispatchable
        GROUP BY z.id`,
    ),
  ]);
  const distByZone = new Map(distances.rows.map((d) => [d.zoneId, d.distanceToStationM]));
  return {
    emirateP90Sec: emirate.rows[0]?.p90 ?? null,
    zones: zones.rows.map((z) => ({ ...z, distanceToStationM: distByZone.get(z.zoneId) ?? null })),
  };
}

/** Idle/available fleet positions plus a rough busy probability from utilisation. */
export async function coverageUnits(db) {
  const { rows } = await db.query(
    `SELECT u.id AS "unitId", u.ref AS "unitRef", u.status,
            ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
            COALESCE(util.busy_minutes, 0)::numeric / 1440.0 AS "measuredBusyFrac"
       FROM units u
       JOIN agencies ag ON ag.id = u.agency_id
       LEFT JOIN LATERAL (
         SELECT SUM(busy_minutes) AS busy_minutes
           FROM v_unit_utilisation vu
          WHERE vu.unit_id = u.id AND vu.day >= now() - interval '7 days'
       ) util ON true
      WHERE u.archived_at IS NULL AND ag.code = 'DCAS' AND u.current_geom IS NOT NULL
        AND u.status NOT IN ('off_duty', 'out_of_service')
        AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))`,
    [pocFleet()],
  );
  return rows.map((r) => ({
    unitId: r.unitId, unitRef: r.unitRef, lng: r.lng, lat: r.lat,
    busyProbability: r.status === 'available' || r.status === 'standby'
      ? Math.min(0.6, Math.max(0.05, Number(r.measuredBusyFrac) || 0.15))
      : 0.9,
    relocatable: r.status === 'available' || r.status === 'standby',
  }));
}

/** The most recent (nearest-past) demand forecast bucket per zone, as coverage demand weights. */
export async function coverageDemandPoints(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (f.zone_id) f.zone_id AS "zoneId", z.ref AS "zoneRef",
            ST_X(z.centroid) AS lng, ST_Y(z.centroid) AS lat, f.predicted AS "demandWeight"
       FROM demand_forecast f
       JOIN zones z ON z.id = f.zone_id
      WHERE f.bucket_start <= now() AND z.level = 'community'
      ORDER BY f.zone_id, f.bucket_start DESC`,
  );
  return rows;
}

/** Pre-empt requests aggregated over a window, plus the assignment count to frame "% of total". */
export async function preemptImpactRows(db, { from, to }) {
  const [impact, total] = await Promise.all([
    db.query(
      `SELECT signal_ref AS "signalRef", corridor,
              SUM(requests)::int AS requests, SUM(granted)::int AS granted,
              AVG(mean_saved_sec) FILTER (WHERE granted > 0) AS "meanSavedSec",
              SUM(total_saved_sec)::int AS "totalSavedSec"
         FROM v_preempt_impact WHERE day BETWEEN $1 AND $2
         GROUP BY signal_ref, corridor`,
      [from, to],
    ),
    db.query(`SELECT COUNT(*)::int n FROM assignments WHERE offered_at BETWEEN $1 AND $2`, [from, to]),
  ]);
  return { rows: impact.rows, totalAssignments: total.rows[0]?.n ?? 0 };
}

/** Risk cells for the CURRENT hour-of-week band — already computed by `npm run seed:derived`. */
export async function riskCellsForNow(db, { limit = 20, zones = null, zoneClasses = null, hourBand = null } = {}) {
  const { rows } = await db.query(
    `SELECT rc.cell_ref AS "cellRef", z.ref AS "zoneRef", z.name AS "zoneName",
            rc.hour_band AS "hourBand", rc.score, rc.factors, rc.model, rc.computed_at AS "computedAt"
       FROM risk_cells rc
       LEFT JOIN zones z ON z.id = rc.zone_id
      WHERE ($2::text[] IS NULL OR z.ref = ANY($2)
             OR z.parent_id IN (SELECT id FROM zones WHERE ref = ANY($2)))
        AND ($3::text[] IS NULL OR z.class = ANY($3))
        AND rc.hour_band = COALESCE($4::int, (
        -- Same six-band split derived.js seeds with: weekday/weekend × night/morning/day/evening.
        SELECT CASE
          WHEN gd BETWEEN 0 AND 4 AND (gh < 6 OR gh >= 22) THEN 0
          WHEN gd BETWEEN 0 AND 4 AND gh >= 6  AND gh < 11 THEN 1
          WHEN gd BETWEEN 0 AND 4 AND gh >= 11 AND gh < 16 THEN 2
          WHEN gd BETWEEN 0 AND 4 AND gh >= 16 AND gh < 22 THEN 3
          WHEN gd IN (5,6) AND gh >= 6 AND gh < 20 THEN 4
          ELSE 5 END
        FROM (SELECT EXTRACT(DOW FROM now() AT TIME ZONE 'Asia/Dubai')::int AS gd,
                     EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Dubai')::int AS gh) t
      ))
      ORDER BY rc.score DESC
      LIMIT $1`,
    [limit, zones?.length ? zones : null, zoneClasses?.length ? zoneClasses : null, hourBand],
  );
  return rows;
}

/** Active or upcoming events, used as the crowd engine's footfall input. */
export async function activeEvents(db) {
  const { rows } = await db.query(
    `SELECT e.id, e.ref, e.name, e.kind, e.starts_at AS "startsAt", e.ends_at AS "endsAt",
            e.expected_footfall AS "expectedFootfall", e.demand_multiplier AS "demandMultiplier",
            z.id AS "zoneId", z.ref AS "zoneRef", z.name AS "zoneName", z.area_km2 AS "areaKm2"
       FROM events_calendar e
       LEFT JOIN zones z ON z.id = e.zone_id
      WHERE e.starts_at <= now() + interval '24 hours' AND e.ends_at >= now() - interval '2 hours'
      ORDER BY e.expected_footfall DESC NULLS LAST
      LIMIT 10`,
  );
  return rows;
}

/** Trailing demand-forecast accuracy — predicted vs backfilled actual. docs/08 §3.1 "held to account". */
export async function demandAccuracyRows(db, { days = 30 } = {}) {
  const { rows } = await db.query(
    `SELECT predicted, actual, lower_80 AS lower, upper_80 AS upper
       FROM demand_forecast
      WHERE actual IS NOT NULL AND bucket_start >= now() - ($1 || ' days')::interval`,
    [days],
  );
  return rows;
}

/** The KPI registry, with the latest recorded value averaged across whatever it was
 *  snapshotted for — Intelligence → KPI library. */
export async function kpiRegistryWithLatest(db) {
  const { rows } = await db.query(
    `SELECT r.key, r.name, r.definition, r.formula, r.unit, r.direction, r.target,
            r.warn_at AS "warnAt", r.breach_at AS "breachAt", r.iso22320_ref AS "iso22320Ref",
            r.owner_role AS "ownerRole", r.source_view AS "sourceView",
            latest.value, latest."periodTo"
       FROM kpi_registry r
       LEFT JOIN LATERAL (
         SELECT AVG(s.value)::numeric(10,2) AS value, MAX(s.period_to) AS "periodTo"
           FROM kpi_snapshots s
          WHERE s.kpi_key = r.key
            AND s.period_to = (SELECT MAX(period_to) FROM kpi_snapshots WHERE kpi_key = r.key)
       ) latest ON true
      ORDER BY r.name`,
  );
  return rows;
}

/** Data quality per source — Intelligence → Data quality. */
export async function dataQualityRows(db) {
  const { rows } = await db.query(
    `SELECT source, ran_at AS "ranAt", rows_in AS "rowsIn", score, results
       FROM v_data_quality ORDER BY score ASC NULLS LAST`,
  );
  return rows;
}

/** Upcoming forecast, next N hours, one row per zone × bucket — the Analytics → Forecast table. */
export async function demandForecastRows(db, { hours = 24, zones = null, zoneClasses = null } = {}) {
  const { rows } = await db.query(
    `SELECT f.zone_id AS "zoneId", z.ref AS "zoneRef", z.name AS "zoneName", z.class AS "zoneClass",
            f.bucket_start AS "bucketStart", f.predicted, f.lower_80 AS "lower80", f.upper_80 AS "upper80"
       FROM demand_forecast f
       JOIN zones z ON z.id = f.zone_id
      WHERE f.bucket_start BETWEEN now() AND now() + ($1 || ' hours')::interval
        AND z.level = 'community'
        AND ($2::text[] IS NULL OR z.ref = ANY($2)
             OR z.parent_id IN (SELECT id FROM zones WHERE ref = ANY($2)))
        AND ($3::text[] IS NULL OR z.class = ANY($3))
      ORDER BY f.bucket_start, f.predicted DESC`,
    [hours, zones?.length ? zones : null, zoneClasses?.length ? zoneClasses : null],
  );
  return rows;
}
