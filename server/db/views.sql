-- ═══════════════════════════════════════════════════════════════════════════════
--  ERSS Dubai — analytical views
--
--  THE SHARED DEFINITIONS. Every screen and every engine reads these; no screen
--  computes a KPI from raw tables. This is how "response time" stays ONE number —
--  disagreement between screens on what it means is the single most common failure in
--  systems like this.
--
--  Applied by `npm run db:views`. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Response: the seven measured stages, per incident ────────────────────────
-- Response time = reported_at → first on-scene. Defined once, here.

-- ── Target attainment, defined once ──────────────────────────────────────────
--
-- "Did this response meet its priority's target" is asked by v_incident_response, by every
-- KPI rollup, and by the universal chart filter (server/lib/filters.js) — which needs it
-- against the BASE table, where the view's own column is not available. A function keeps
-- one definition and lets the planner inline it in every one of those places; expressed as
-- a correlated EXISTS into the view instead, the same predicate was the most expensive
-- clause in the filter.
--
-- P1 8:00 · P2 12:00 · P3 20:00 · P4 40:00 (config/jurisdiction.js priorities).
CREATE OR REPLACE FUNCTION erss_within_target(
  p_priority  incident_prio,
  p_reported  timestamptz,
  p_onscene   timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_onscene IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM p_onscene - p_reported)
                   <= CASE p_priority WHEN 'P1' THEN 480 WHEN 'P2' THEN 720
                                      WHEN 'P3' THEN 1200 ELSE 2400 END
         END
$$;


CREATE OR REPLACE VIEW v_incident_response AS
SELECT
  i.id,
  i.ref,
  i.kind,
  i.priority,
  i.state,
  i.outcome,
  i.zone_id,
  z.ref                                   AS zone_ref,
  z.name                                  AS zone_name,
  z.class                                 AS zone_class,
  z.parent_id                             AS sector_id,
  i.floor,
  i.source,
  i.is_seed,
  i.run_id,
  i.reported_at,
  EXTRACT(HOUR FROM i.reported_at AT TIME ZONE 'Asia/Dubai')::int AS gst_hour,
  EXTRACT(DOW  FROM i.reported_at AT TIME ZONE 'Asia/Dubai')::int AS gst_dow,
  -- hour-of-week, 0..167 — the temporal key for demand and risk
  (EXTRACT(DOW FROM i.reported_at AT TIME ZONE 'Asia/Dubai')::int * 24
   + EXTRACT(HOUR FROM i.reported_at AT TIME ZONE 'Asia/Dubai')::int) AS hour_of_week,

  -- Stage 1 · call handling
  EXTRACT(EPOCH FROM i.triaged_at    - i.reported_at)::int    AS call_handling_sec,
  -- Stage 2 · dispatch decision
  EXTRACT(EPOCH FROM i.dispatched_at - i.triaged_at)::int     AS dispatch_sec,
  -- Stages 3–5 come from the assignment
  a.acknowledge_sec,
  a.turnout_sec,
  a.travel_sec,
  -- The vertical problem, measured separately. Conflating it with travel is exactly how
  -- the last-hundred-metres delay stays invisible.
  a.vrt_sec,

  -- THE headline number
  EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)::int  AS response_sec,
  -- Time to the PATIENT, which in a 163-floor tower is a different event
  EXTRACT(EPOCH FROM i.first_at_patient_at - i.reported_at)::int AS to_patient_sec,
  EXTRACT(EPOCH FROM i.closed_at - i.reported_at)::int          AS total_sec,

  a.unit_id,
  a.unit_ref,
  a.unit_kind,
  a.hospital_id,
  a.eta_error_sec,
  a.route_proposed_sec,
  a.route_taken_sec,
  (a.route_taken_sec - a.route_proposed_sec)                    AS route_delta_sec,

  -- Target attainment, using the priority's own target. The definition lives in
  -- erss_within_target() (above) so the analytical filter can apply the SAME rule to the
  -- base table without a correlated lookup back into this view.
  erss_within_target(i.priority, i.reported_at, i.first_onscene_at)  AS within_target
FROM incidents i
LEFT JOIN zones z ON z.id = i.zone_id
LEFT JOIN LATERAL (
  SELECT a.unit_id, u.ref AS unit_ref, u.kind AS unit_kind, a.hospital_id,
         a.vrt_sec, a.eta_error_sec, a.route_proposed_sec, a.route_taken_sec,
         EXTRACT(EPOCH FROM a.acknowledged_at - a.offered_at)::int      AS acknowledge_sec,
         EXTRACT(EPOCH FROM a.enroute_at      - a.acknowledged_at)::int AS turnout_sec,
         EXTRACT(EPOCH FROM a.onscene_at      - a.enroute_at)::int      AS travel_sec
    FROM assignments a
    JOIN units u ON u.id = a.unit_id
   WHERE a.incident_id = i.id AND a.is_primary
   ORDER BY a.offered_at
   LIMIT 1
) a ON TRUE;


-- ── Assignment stages, for the decomposition panel ───────────────────────────

CREATE OR REPLACE VIEW v_assignment_stages AS
SELECT
  a.id, a.ref, a.incident_id, a.unit_id, u.ref AS unit_ref, u.kind AS unit_kind,
  ag.code AS agency_code, i.zone_id, i.priority, i.kind AS incident_kind,
  a.offered_at,
  EXTRACT(HOUR FROM a.offered_at AT TIME ZONE 'Asia/Dubai')::int AS gst_hour,
  EXTRACT(EPOCH FROM a.acknowledged_at - a.offered_at)::int      AS acknowledge_sec,
  EXTRACT(EPOCH FROM a.enroute_at      - a.acknowledged_at)::int AS turnout_sec,
  EXTRACT(EPOCH FROM a.onscene_at      - a.enroute_at)::int      AS travel_sec,
  a.vrt_sec,
  EXTRACT(EPOCH FROM a.transporting_at - a.at_patient_at)::int   AS on_scene_sec,
  EXTRACT(EPOCH FROM a.at_hospital_at  - a.transporting_at)::int AS transport_sec,
  EXTRACT(EPOCH FROM a.cleared_at      - a.at_hospital_at)::int  AS handover_sec,
  a.state, a.decline_reason, a.eta_error_sec
FROM assignments a
JOIN units u     ON u.id = a.unit_id
JOIN agencies ag ON ag.id = u.agency_id
JOIN incidents i ON i.id = a.incident_id;


-- ── Zone rollups ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_zone_hourly AS
SELECT
  r.zone_id,
  date_trunc('hour', r.reported_at)                      AS bucket,
  r.hour_of_week,
  COUNT(*)::int                                          AS calls,
  COUNT(*) FILTER (WHERE r.priority = 'P1')::int         AS p1,
  COUNT(*) FILTER (WHERE r.priority = 'P2')::int         AS p2,
  AVG(r.response_sec)::numeric(10,1)                     AS mean_response_sec,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50_response_sec,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90_response_sec
FROM v_incident_response r
WHERE r.zone_id IS NOT NULL
GROUP BY r.zone_id, date_trunc('hour', r.reported_at), r.hour_of_week;

CREATE OR REPLACE VIEW v_zone_daily AS
SELECT
  r.zone_id,
  z.ref                                                  AS zone_ref,
  z.name                                                 AS zone_name,
  z.level,
  date_trunc('day', r.reported_at)                       AS day,
  COUNT(*)::int                                          AS calls,
  COUNT(*) FILTER (WHERE r.priority IN ('P1','P2'))::int AS urgent_calls,
  AVG(r.response_sec)::numeric(10,1)                     AS mean_response_sec,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50_response_sec,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90_response_sec,
  AVG(r.acknowledge_sec)::numeric(10,1)                  AS mean_acknowledge_sec,
  AVG(r.turnout_sec)::numeric(10,1)                      AS mean_turnout_sec,
  AVG(r.vrt_sec)::numeric(10,1)                          AS mean_vrt_sec,
  100.0 * COUNT(*) FILTER (WHERE r.within_target) / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0)
                                                         AS within_target_pct,
  100.0 * COUNT(*) FILTER (WHERE r.state = 'closed') / NULLIF(COUNT(*), 0) AS closure_pct
FROM v_incident_response r
JOIN zones z ON z.id = r.zone_id
GROUP BY r.zone_id, z.ref, z.name, z.level, date_trunc('day', r.reported_at);


-- ── Unit utilisation — the busy probability MEXCLP needs ─────────────────────

CREATE OR REPLACE VIEW v_unit_utilisation AS
SELECT
  u.id AS unit_id, u.ref AS unit_ref, u.kind, ag.code AS agency_code,
  date_trunc('day', a.offered_at) AS day,
  COUNT(*)::int                                                       AS jobs,
  SUM(EXTRACT(EPOCH FROM a.cleared_at - a.offered_at))::int / 60       AS busy_minutes,
  AVG(EXTRACT(EPOCH FROM a.enroute_at - a.acknowledged_at))::numeric(10,1) AS mean_turnout_sec,
  AVG(EXTRACT(EPOCH FROM a.cleared_at - a.offered_at))::numeric(10,1)  AS mean_job_sec
FROM units u
JOIN agencies ag ON ag.id = u.agency_id
LEFT JOIN assignments a ON a.unit_id = u.id AND a.cleared_at IS NOT NULL
GROUP BY u.id, u.ref, u.kind, ag.code, date_trunc('day', a.offered_at);


-- ── Multi-agency SLA — the sub-minute notification claim, measured ───────────

CREATE OR REPLACE VIEW v_agency_sla AS
SELECT
  n.incident_id,
  i.ref                                                   AS incident_ref,
  i.priority,
  i.zone_id,
  a.code                                                  AS agency_code,
  a.short_name                                            AS agency_name,
  n.notified_at,
  n.acknowledged_at,
  EXTRACT(EPOCH FROM n.notified_at - i.reported_at)::int   AS detect_to_notify_sec,
  EXTRACT(EPOCH FROM n.acknowledged_at - n.notified_at)::int AS ack_sec,
  n.sla_sec,
  (EXTRACT(EPOCH FROM n.acknowledged_at - n.notified_at) <= n.sla_sec) AS met
FROM agency_notifications n
JOIN agencies a  ON a.id = n.agency_id
JOIN incidents i ON i.id = n.incident_id;


-- ── ETA accuracy — the model held to account ─────────────────────────────────

CREATE OR REPLACE VIEW v_eta_accuracy AS
SELECT
  a.id, a.incident_id, i.zone_id, i.priority, u.kind AS unit_kind,
  EXTRACT(HOUR FROM a.enroute_at AT TIME ZONE 'Asia/Dubai')::int AS gst_hour,
  a.eta_predicted_at, a.onscene_at, a.eta_error_sec,
  ABS(a.eta_error_sec)                                   AS abs_error_sec,
  a.route_proposed_sec, a.route_taken_sec
FROM assignments a
JOIN incidents i ON i.id = a.incident_id
JOIN units u     ON u.id = a.unit_id
WHERE a.eta_error_sec IS NOT NULL;


-- ── Pre-empt impact — MEASURED seconds saved, never assumed ──────────────────
-- ⚠ EVP is not verified as deployed in Dubai. This measures what it WOULD recover.

CREATE OR REPLACE VIEW v_preempt_impact AS
SELECT
  p.signal_ref,
  s.corridor,
  date_trunc('day', p.requested_at)                       AS day,
  COUNT(*)::int                                           AS requests,
  COUNT(*) FILTER (WHERE p.outcome = 'granted')::int      AS granted,
  100.0 * COUNT(*) FILTER (WHERE p.outcome = 'granted') / NULLIF(COUNT(*), 0) AS grant_pct,
  AVG(p.saved_sec) FILTER (WHERE p.outcome = 'granted')::numeric(10,1) AS mean_saved_sec,
  SUM(p.saved_sec) FILTER (WHERE p.outcome = 'granted')::int           AS total_saved_sec
FROM preempt_events p
LEFT JOIN traffic_signals s ON s.ref = p.signal_ref
GROUP BY p.signal_ref, s.corridor, date_trunc('day', p.requested_at);


-- ── Hospital load ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_hospital_load AS
SELECT
  h.id, h.ref, h.name, h.capabilities, h.ed_beds, h.ed_occupied, h.on_diversion,
  100.0 * h.ed_occupied / NULLIF(h.ed_beds, 0)            AS occupancy_pct,
  COUNT(a.id) FILTER (WHERE a.state = 'transporting')::int AS inbound,
  AVG(EXTRACT(EPOCH FROM a.cleared_at - a.at_hospital_at))::numeric(10,1) AS mean_handover_sec
FROM hospitals h
LEFT JOIN assignments a ON a.hospital_id = h.id
GROUP BY h.id, h.ref, h.name, h.capabilities, h.ed_beds, h.ed_occupied, h.on_diversion;


-- ── Data quality rollup ──────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_data_quality AS
SELECT DISTINCT ON (source)
  source, ran_at, rows_in, score, results
FROM data_quality_runs
ORDER BY source, ran_at DESC;


-- ── Materialised: the 24-month aggregates the analytics pages read ───────────
-- Refreshed by `npm run seed:derived`; too expensive to compute per request.

DROP MATERIALIZED VIEW IF EXISTS mv_zone_hour_of_week CASCADE;
CREATE MATERIALIZED VIEW mv_zone_hour_of_week AS
SELECT
  zone_id,
  hour_of_week,
  COUNT(*)::int                                     AS calls,
  COUNT(DISTINCT date_trunc('week', reported_at))::int AS weeks,
  COUNT(*)::numeric / NULLIF(COUNT(DISTINCT date_trunc('week', reported_at)), 0) AS mean_per_week,
  AVG(response_sec)::numeric(10,1)                  AS mean_response_sec
FROM v_incident_response
WHERE zone_id IS NOT NULL AND is_seed
GROUP BY zone_id, hour_of_week;

CREATE UNIQUE INDEX IF NOT EXISTS mv_zhow_idx ON mv_zone_hour_of_week (zone_id, hour_of_week);


-- ── ETA calibration — what engines/eta.js is calibrated against ──────────────
-- One long table, four kinds of row:
--   pace   key = '<hour band>|<zone class>'  seconds per road metre, trips ≥ 1.5 km
--   short  key = '<hour band>|<zone class>'  travel seconds for trips under 1 km — the
--                floor a pure pace model would underestimate
--   vrt    key = '<floor band>'               vertical response seconds (docs/08 §3.2)
--   stage  key = 'acknowledge' | 'turnout'    seconds, for the arrival prediction
-- Quantiles, not means: travel is log-normal, and the IQR is what the engine's
-- confidence is defined from. The hour bands must match engines/eta.js hourBand().
-- Refreshed by `npm run seed:derived`.

DROP MATERIALIZED VIEW IF EXISTS mv_eta_calibration CASCADE;
CREATE MATERIALIZED VIEW mv_eta_calibration AS
WITH trips AS (
  SELECT z.class AS zone_class,
         CASE WHEN x.h BETWEEN 6 AND 9   THEN 'am_peak'
              WHEN x.h BETWEEN 10 AND 16 THEN 'midday'
              WHEN x.h BETWEEN 17 AND 20 THEN 'pm_peak'
              WHEN x.h IN (21, 22)       THEN 'evening'
              ELSE 'night' END AS band,
         x.travel_sec, x.m
    FROM (
      SELECT i.zone_id,
             EXTRACT(HOUR FROM a.enroute_at AT TIME ZONE 'Asia/Dubai')::int AS h,
             EXTRACT(EPOCH FROM a.onscene_at - a.enroute_at)::float8    AS travel_sec,
             a.route_proposed_m::float8                                  AS m
        FROM assignments a
        JOIN incidents i ON i.id = a.incident_id
       WHERE a.enroute_at IS NOT NULL AND a.onscene_at IS NOT NULL
         AND a.route_proposed_m > 0 AND a.onscene_at > a.enroute_at
    ) x
    JOIN zones z ON z.id = x.zone_id
),
vertical AS (
  SELECT CASE WHEN i.floor < 10 THEN 'f00-09'
              WHEN i.floor < 20 THEN 'f10-19'
              WHEN i.floor < 40 THEN 'f20-39'
              WHEN i.floor < 60 THEN 'f40-59'
              ELSE 'f60+' END AS band,
         a.vrt_sec::float8 AS vrt_sec
    FROM assignments a JOIN incidents i ON i.id = a.incident_id
   WHERE a.vrt_sec IS NOT NULL AND i.floor IS NOT NULL
),
stages AS (
  SELECT EXTRACT(EPOCH FROM acknowledged_at - offered_at)::float8 AS ack_sec,
         EXTRACT(EPOCH FROM enroute_at - acknowledged_at)::float8 AS turnout_sec
    FROM assignments
   WHERE acknowledged_at IS NOT NULL AND enroute_at IS NOT NULL
)
SELECT kind, key, n, q[1] AS p10, q[2] AS p25, q[3] AS p50, q[4] AS p75, q[5] AS p90
  FROM (
    SELECT 'pace'::text AS kind, band || '|' || zone_class AS key, COUNT(*)::int AS n,
           percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY travel_sec / m) AS q
      FROM trips WHERE m >= 1500 GROUP BY band, zone_class
    UNION ALL
    SELECT 'short', band || '|' || zone_class, COUNT(*)::int,
           percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY travel_sec)
      FROM trips WHERE m < 1000 GROUP BY band, zone_class
    UNION ALL
    SELECT 'vrt', band, COUNT(*)::int,
           percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY vrt_sec)
      FROM vertical GROUP BY band
    UNION ALL
    SELECT 'stage', 'acknowledge', COUNT(*)::int,
           percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY ack_sec)
      FROM stages
    UNION ALL
    SELECT 'stage', 'turnout', COUNT(*)::int,
           percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9]) WITHIN GROUP (ORDER BY turnout_sec)
      FROM stages
  ) s;

CREATE UNIQUE INDEX IF NOT EXISTS mv_eta_cal_idx ON mv_eta_calibration (kind, key);

