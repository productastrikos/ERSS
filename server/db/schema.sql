-- ═══════════════════════════════════════════════════════════════════════════════
--  ERSS Dubai — schema
--  Idempotent. Safe to re-run. Applied by `npm run db:schema`.
--  Reference: docs/03-DOMAIN-MODEL.md
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Enums ─────────────────────────────────────────────────────────────────────
-- DO blocks because CREATE TYPE has no IF NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE agency_code AS ENUM ('DCAS','POLICE','CIVIL_DEFENCE','COASTGUARD',
                                   'RTA','MUNICIPALITY','DEWA','DHA','NCEMA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE zone_level AS ENUM ('emirate','sector','community','beat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE unit_kind AS ENUM ('ALS','BLS','MICU','MRU','MCU','SUPERCAR',
                                 'PRV','FIRE','RESCUE','MARINE','SUPERVISOR','AIR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE unit_status AS ENUM ('off_duty','available','standby','relocating',
                                   'assigned','responding','on_scene','transporting',
                                   'at_hospital','out_of_service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incident_prio AS ENUM ('P1','P2','P3','P4');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incident_state AS ENUM ('reported','triaged','dispatched','responding',
                                      'on_scene','transporting','at_hospital',
                                      'resolved_on_scene','cancelled','non_emergency','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assign_state AS ENUM ('offered','acknowledged','declined','timed_out',
                                    'enroute','onscene','transporting','at_hospital',
                                    'resolved_on_scene','cleared','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE advisory_sev AS ENUM ('emergency','warning','alert','info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE advisory_state AS ENUM ('open','analysing','acted','verifying','closed','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_class AS ENUM ('open','shared_confidential','shared_sensitive','shared_secret');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
--  1 · Reference and organisation
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agencies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          agency_code UNIQUE NOT NULL,
  name          text NOT NULL,
  short_name    text NOT NULL,
  emergency_no  text,
  glyph         text NOT NULL,
  series_slot   int  NOT NULL,          -- categorical palette slot; see docs/05 §5.3
  is_responder  boolean NOT NULL DEFAULT true,
  sla_ack_sec   int NOT NULL DEFAULT 60,
  sla_scene_sec int
);

CREATE TABLE IF NOT EXISTS zones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text UNIQUE NOT NULL,
  name              text NOT NULL,
  name_ar           text,
  level             zone_level NOT NULL,
  parent_id         uuid REFERENCES zones(id),
  class             text NOT NULL DEFAULT 'urban',   -- urban|suburban|industrial|freezone|coastal|desert
  population        int,                             -- resident
  population_daytime int,                            -- the 1.8M daily influx makes this essential
  area_km2          numeric(10,3),
  highrise_ct       int NOT NULL DEFAULT 0,          -- buildings > 20 floors: a risk factor and a VRT driver
  geom              geometry(MultiPolygon, 4326) NOT NULL,
  centroid          geometry(Point, 4326) GENERATED ALWAYS AS (ST_PointOnSurface(geom)) STORED
);
CREATE INDEX IF NOT EXISTS zones_geom_idx     ON zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS zones_centroid_idx ON zones USING GIST (centroid);
CREATE INDEX IF NOT EXISTS zones_parent_idx   ON zones (parent_id, level);

CREATE TABLE IF NOT EXISTS stations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text UNIQUE NOT NULL,
  name         text NOT NULL,
  agency_id    uuid NOT NULL REFERENCES agencies(id),
  zone_id      uuid REFERENCES zones(id),
  kind         text NOT NULL DEFAULT 'station',   -- station|standby_point|kiosk|floating|smart
  -- Dubai's 33 Smart Police Stations are UNMANNED. Routing an incident to one yields
  -- no physical responder, so the dispatch engine must exclude them. This flag is the
  -- mechanism, and it is the reason this column exists at all.
  dispatchable boolean NOT NULL DEFAULT true,
  makani       char(10),
  bays         int NOT NULL DEFAULT 2,
  geom         geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS stations_geom_idx   ON stations USING GIST (geom);
CREATE INDEX IF NOT EXISTS stations_agency_idx ON stations (agency_id, dispatchable);

CREATE TABLE IF NOT EXISTS hospitals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text UNIQUE NOT NULL,
  name         text NOT NULL,
  area         text,
  operator_class text NOT NULL DEFAULT 'private',  -- public|private
  zone_id      uuid REFERENCES zones(id),
  makani       char(10),
  ed_beds      int NOT NULL DEFAULT 20,
  ed_occupied  int NOT NULL DEFAULT 0,
  on_diversion boolean NOT NULL DEFAULT false,
  -- trauma_l1 | stroke | cath_lab | burns | paeds | obstetric | hyperbaric |
  -- toxicology | neurosurgery | general
  capabilities text[] NOT NULL DEFAULT '{}',
  nabidh_id    text,
  geom         geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS hospitals_geom_idx ON hospitals USING GIST (geom);
CREATE INDEX IF NOT EXISTS hospitals_caps_idx ON hospitals USING GIN (capabilities);

-- Entrance-level addressing. Format and semantics match Makani; values are SEEDED,
-- not licensed. Note the real fill rates that shaped this table: building_name is
-- populated in <1% of the real Makani index and makani_address in ~64%, which is why
-- makani_number and entrance_points are the only reliable keys.
CREATE TABLE IF NOT EXISTS makani_points (
  makani        char(10) PRIMARY KEY,
  building_name text,                                  -- sparse by nature; never a search key
  makani_address text,
  entrance_no   int NOT NULL DEFAULT 1,
  entrance_count int NOT NULL DEFAULT 1,
  entrance_role text,                                  -- main|service|emergency|parking|lobby-b
  floors        int,
  parcel_id     text,
  community_no  int,
  zone_id       uuid REFERENCES zones(id),
  geom          geometry(Point, 4326) NOT NULL,
  building_geom geometry(Polygon, 4326)
);
CREATE INDEX IF NOT EXISTS makani_geom_idx ON makani_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS makani_zone_idx ON makani_points (zone_id);

-- Public access defibrillators. DCAS runs a TELEMETRY-ENABLED network (Lifepak CR2):
-- opening a cabinet transmits to the control room and auto-generates a high-acuity
-- incident. That behaviour is modelled here — an AED activation is a valid incident
-- source in this platform because it is one in the real system.
CREATE TABLE IF NOT EXISTS aeds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text UNIQUE NOT NULL,
  site_name     text NOT NULL,
  site_kind     text,                                  -- mall|metro|mosque|stadium|park|office|school
  zone_id       uuid REFERENCES zones(id),
  makani        char(10),
  telemetry     boolean NOT NULL DEFAULT true,
  last_check_at timestamptz,
  available     boolean NOT NULL DEFAULT true,
  geom          geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS aeds_geom_idx ON aeds USING GIST (geom);


-- ═══════════════════════════════════════════════════════════════════════════════
--  2 · Platform: users, sessions, audit
--  (declared before incidents/units because those reference users)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,
  name            text NOT NULL,
  email           text UNIQUE,
  phone           text,
  role            text NOT NULL,          -- see docs/01 §2
  agency_id       uuid REFERENCES agencies(id),
  zone_scope      uuid[] NOT NULL DEFAULT '{}',   -- empty = full scope for that role
  unit_id         uuid,                   -- responders only; FK added after units exists
  password_hash   text NOT NULL,
  -- Citizen-only. PDPL-sensitive, role-gated, audited on every read.
  medical_profile jsonb,
  locale          text NOT NULL DEFAULT 'en',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  archived_at     timestamptz             -- archive, never delete
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  token_hash text UNIQUE NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ua         text,
  ip         inet
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, expires_at DESC);

-- Tamper-evident: each row hashes the previous row's hash.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  actor_id   uuid REFERENCES users(id),
  actor_ref  text,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  payload    jsonb NOT NULL DEFAULT '{}',
  prev_hash  text,
  hash       text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log (entity, entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_actor_idx  ON audit_log (actor_id, ts DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
--  3 · Scenarios (referenced by incidents via run_id)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scenarios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text UNIQUE NOT NULL,
  name         text NOT NULL,
  summary      text NOT NULL,
  tier         int NOT NULL DEFAULT 1,
  duration_sec int NOT NULL,
  script_file  text NOT NULL,
  grounding    jsonb NOT NULL DEFAULT '{}',
  enabled      boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS scenario_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,
  scenario_id     uuid NOT NULL REFERENCES scenarios(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  state           text NOT NULL DEFAULT 'running',   -- running|paused|ended|aborted
  speed           numeric(4,2) NOT NULL DEFAULT 1,
  cursor_sec      int NOT NULL DEFAULT 0,
  epoch_ms        bigint NOT NULL,
  started_by      uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS runs_state_idx ON scenario_runs (state, started_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
--  4 · Fleet
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,
  callsign        text NOT NULL,
  kind            unit_kind NOT NULL,
  agency_id       uuid NOT NULL REFERENCES agencies(id),
  home_station_id uuid REFERENCES stations(id),
  -- als|bls|bariatric|neonatal|extrication|hazmat|defib|vent|marine|aerial
  capabilities    text[] NOT NULL DEFAULT '{}',
  crew_size       int NOT NULL DEFAULT 2,
  status          unit_status NOT NULL DEFAULT 'off_duty',
  shift_start     timestamptz,
  shift_end       timestamptz,
  current_geom    geometry(Point, 4326),
  current_heading numeric(5,2),
  current_speed   numeric(6,2),
  last_seen_at    timestamptz,
  standby_geom    geometry(Point, 4326),
  standby_reason  text,
  standby_advisory_id uuid,              -- FK added after advisories exists
  archived_at     timestamptz
);
CREATE INDEX IF NOT EXISTS units_geom_idx   ON units USING GIST (current_geom);
CREATE INDEX IF NOT EXISTS units_status_idx ON units (status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS units_agency_idx ON units (agency_id, kind);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_unit_fk FOREIGN KEY (unit_id) REFERENCES units(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS unit_positions (
  id       bigserial PRIMARY KEY,
  unit_id  uuid NOT NULL REFERENCES units(id),
  ts       timestamptz NOT NULL,
  geom     geometry(Point, 4326) NOT NULL,
  speed    numeric(6,2),
  heading  numeric(5,2),
  status   unit_status,
  run_id   uuid REFERENCES scenario_runs(id)
);
CREATE INDEX IF NOT EXISTS unit_pos_unit_ts_idx ON unit_positions (unit_id, ts DESC);
CREATE INDEX IF NOT EXISTS unit_pos_geom_idx    ON unit_positions USING GIST (geom);
CREATE INDEX IF NOT EXISTS unit_pos_run_idx     ON unit_positions (run_id) WHERE run_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════════
--  5 · Incidents
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,
  kind            text NOT NULL,
  subkind         text,
  priority        incident_prio NOT NULL,
  state           incident_state NOT NULL DEFAULT 'reported',
  outcome         text,

  -- Where
  geom            geometry(Point, 4326) NOT NULL,
  makani          char(10) REFERENCES makani_points(makani),
  zone_id         uuid REFERENCES zones(id),
  floor           int,                     -- the vertical-city problem, first class
  unit_no         text,
  access_note     text,

  -- Origin
  source          text NOT NULL,           -- call_998|call_999|call_997|call_996|app_sos|
                                           -- aed_activation|cad_feed|sensor|field_unit|transfer
  caller_name     text,
  caller_phone    text,
  caller_role     text,
  reported_by     uuid REFERENCES users(id),

  -- Triage
  chief_complaint text,
  triage_code     text,
  acuity          int,
  patients_count  int NOT NULL DEFAULT 1,

  -- Measured timestamps
  reported_at      timestamptz NOT NULL,
  triaged_at       timestamptz,
  dispatched_at    timestamptz,
  first_onscene_at timestamptz,            -- ambulance AT THE ENTRANCE
  first_at_patient_at timestamptz,         -- crew AT THE PATIENT — in a 163-floor tower
                                           -- these are not the same event, and the
                                           -- standard clock stops at the wrong one
  closed_at        timestamptz,

  -- Multi-agency
  lead_agency_id    uuid REFERENCES agencies(id),
  agencies_involved agency_code[] NOT NULL DEFAULT '{}',
  escalation_level  text NOT NULL DEFAULT 'LOCAL',   -- LOCAL|EMIRATE|NRF_L1|NRF_L2

  run_id      uuid REFERENCES scenario_runs(id),
  is_seed     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inc_geom_idx      ON incidents USING GIST (geom);
CREATE INDEX IF NOT EXISTS inc_reported_idx  ON incidents (reported_at DESC);
CREATE INDEX IF NOT EXISTS inc_zone_time_idx ON incidents (zone_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS inc_kind_idx      ON incidents (kind, priority);
CREATE INDEX IF NOT EXISTS inc_open_idx      ON incidents (state) WHERE state <> 'closed';
CREATE INDEX IF NOT EXISTS inc_run_idx       ON incidents (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inc_seed_idx      ON incidents (is_seed, reported_at DESC);

CREATE TABLE IF NOT EXISTS incident_timeline (
  id          bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  stage       text NOT NULL,
  label       text NOT NULL,
  actor_kind  text,
  actor_id    text,
  agency_id   uuid REFERENCES agencies(id),
  detail      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS timeline_inc_idx ON incident_timeline (incident_id, ts);
-- The dashboard's live feed reads the newest rows across every incident.
CREATE INDEX IF NOT EXISTS timeline_ts_idx ON incident_timeline (ts DESC);

CREATE TABLE IF NOT EXISTS incident_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  agency_id   uuid REFERENCES agencies(id),
  body        text NOT NULL,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS notes_inc_idx ON incident_notes (incident_id, created_at);

-- BoQ-1 F9 / T9: sub-minute multi-agency notification, MEASURED not asserted.
CREATE TABLE IF NOT EXISTS agency_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  agency_id       uuid NOT NULL REFERENCES agencies(id),
  notified_at     timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id),
  sla_sec         int NOT NULL,
  channel         text NOT NULL DEFAULT 'in_app',
  UNIQUE (incident_id, agency_id)
);
CREATE INDEX IF NOT EXISTS agency_notif_idx ON agency_notifications (agency_id, notified_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
--  6 · Assignments and routes
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text UNIQUE NOT NULL,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL REFERENCES units(id),
  state       assign_state NOT NULL DEFAULT 'offered',
  is_primary  boolean NOT NULL DEFAULT true,

  offered_at      timestamptz NOT NULL,
  acknowledged_at timestamptz,
  declined_at     timestamptz,
  decline_reason  text,
  enroute_at      timestamptz,
  onscene_at      timestamptz,             -- at the entrance
  at_patient_at   timestamptz,             -- at the patient — VRT is the gap
  transporting_at timestamptz,
  at_hospital_at  timestamptz,
  cleared_at      timestamptz,

  hospital_id     uuid REFERENCES hospitals(id),

  -- Vertical Response Time: 4–8 min in Dubai's high-rise clusters, comparable to the
  -- drive. Stored so it can be reported as its own stage rather than buried in travel.
  vrt_sec         int,
  vrt_breakdown   jsonb,

  -- Route taken vs route proposed — the Concept Note's headline comparison
  route_proposed     geometry(LineString, 4326),
  route_proposed_sec int,
  route_proposed_m   int,
  route_taken        geometry(LineString, 4326),
  route_taken_sec    int,
  route_taken_m      int,

  -- "Actual against predicted arrival, so the model is held to account"
  eta_predicted_at timestamptz,
  eta_method       text,
  eta_error_sec    int GENERATED ALWAYS AS (
                     CASE WHEN onscene_at IS NOT NULL AND eta_predicted_at IS NOT NULL
                          THEN EXTRACT(EPOCH FROM onscene_at - eta_predicted_at)::int END) STORED,

  -- Why this unit. Kept forever: six months later "why was that unit sent" has an answer.
  dispatch_rationale jsonb,

  run_id  uuid REFERENCES scenario_runs(id)
);
CREATE INDEX IF NOT EXISTS asg_inc_idx  ON assignments (incident_id);
CREATE INDEX IF NOT EXISTS asg_unit_idx ON assignments (unit_id, offered_at DESC);
CREATE INDEX IF NOT EXISTS asg_state_idx ON assignments (state) WHERE state NOT IN ('cleared','cancelled','declined');
CREATE INDEX IF NOT EXISTS asg_run_idx  ON assignments (run_id) WHERE run_id IS NOT NULL;

-- Green wave / EVP. NOTE: EVP is not verified as deployed in Dubai — this models a
-- proposed capability and measures what it would recover. See docs/10 SC-05.
CREATE TABLE IF NOT EXISTS preempt_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  signal_ref    text NOT NULL,
  requested_at  timestamptz NOT NULL,
  granted_at    timestamptz,
  released_at   timestamptz,
  hold_sec      int,
  outcome       text NOT NULL DEFAULT 'requested',  -- granted|denied|conflict|late|not_equipped
  saved_sec     int,
  geom          geometry(Point, 4326),
  run_id        uuid REFERENCES scenario_runs(id)
);
CREATE INDEX IF NOT EXISTS preempt_asg_idx ON preempt_events (assignment_id);
CREATE INDEX IF NOT EXISTS preempt_sig_idx ON preempt_events (signal_ref, requested_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
--  7 · Clinical
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS patients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id      uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  assignment_id    uuid REFERENCES assignments(id),
  seq              int NOT NULL DEFAULT 1,

  -- PDPL: the raw Emirates ID is NEVER stored. Salted hash + last 3 for display only.
  eid_hash         text,
  eid_last3        char(3),
  age_band         text,
  sex              text,

  chief_complaint  text,
  triage_tag       text,                   -- START/SALT: red|yellow|green|black
  gcs              int,
  nabidh_pulled_at timestamptz,
  nabidh_summary   jsonb,
  interventions    text[] NOT NULL DEFAULT '{}',
  destination_id   uuid REFERENCES hospitals(id),
  prealert_sent_at timestamptz,
  prealert_ack_at  timestamptz,
  outcome          text,
  run_id           uuid REFERENCES scenario_runs(id)
);
CREATE INDEX IF NOT EXISTS pat_inc_idx ON patients (incident_id);
-- Backs the assignment_id foreign key. Without it every assignment delete seq-scans
-- patients for the FK check, and re-seeding history (~409k deletes) never finishes.
CREATE INDEX IF NOT EXISTS pat_asg_idx ON patients (assignment_id);
CREATE INDEX IF NOT EXISTS pat_run_idx ON patients (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telemetry (
  id           bigserial PRIMARY KEY,
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ts           timestamptz NOT NULL,
  hr           int,
  spo2         int,
  bp_sys       int,
  bp_dia       int,
  resp_rate    int,
  temp_c       numeric(4,1),
  etco2        int,
  rhythm       text,
  ecg_waveform real[],
  source       text NOT NULL DEFAULT 'monitor',
  run_id       uuid REFERENCES scenario_runs(id)
);
CREATE INDEX IF NOT EXISTS tel_pat_idx ON telemetry (patient_id, ts);


-- ═══════════════════════════════════════════════════════════════════════════════
--  8 · Intelligence outputs
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS advisories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text UNIQUE NOT NULL,
  severity      advisory_sev NOT NULL,
  category      text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  state         advisory_state NOT NULL DEFAULT 'open',

  -- The explainability payload. Rendered verbatim by the drill-down.
  -- { method, window:{from,to}, inputs:[{source,rows,asOf}],
  --   factors:[{name,contribution,direction,detail}], confidence, sampleSize,
  --   baseline, target }
  evidence      jsonb NOT NULL,
  zone_ids      uuid[] NOT NULL DEFAULT '{}',
  geom          geometry(Geometry, 4326),
  incident_id   uuid REFERENCES incidents(id),

  recommended_action text,
  assigned_agency_id uuid REFERENCES agencies(id),
  owner_user_id      uuid REFERENCES users(id),
  acted_at           timestamptz,
  sla_due_at         timestamptz,
  baseline_value     numeric,
  target_value       numeric,
  measured_value     numeric,
  closed_at          timestamptz,
  dismiss_reason     text,

  detector       text NOT NULL,
  engine         text NOT NULL,
  engine_version text NOT NULL,
  dedupe_key     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  run_id         uuid REFERENCES scenario_runs(id)
);
CREATE INDEX IF NOT EXISTS adv_state_idx  ON advisories (state, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS adv_dedupe_idx ON advisories (dedupe_key) WHERE state NOT IN ('closed','dismissed');
CREATE INDEX IF NOT EXISTS adv_geom_idx   ON advisories USING GIST (geom);
CREATE INDEX IF NOT EXISTS adv_inc_idx    ON advisories (incident_id);   -- backs the FK on incident delete

DO $$ BEGIN
  ALTER TABLE units ADD CONSTRAINT units_standby_adv_fk
    FOREIGN KEY (standby_advisory_id) REFERENCES advisories(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS advisory_actions (
  id          bigserial PRIMARY KEY,
  advisory_id uuid NOT NULL REFERENCES advisories(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  note        text,
  payload     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS adv_act_idx ON advisory_actions (advisory_id, ts);

CREATE TABLE IF NOT EXISTS demand_forecast (
  id           bigserial PRIMARY KEY,
  zone_id      uuid NOT NULL REFERENCES zones(id),
  bucket_start timestamptz NOT NULL,
  bucket_hours int NOT NULL DEFAULT 1,
  predicted    numeric(8,3) NOT NULL,
  lower_80     numeric(8,3),
  upper_80     numeric(8,3),
  actual       int,                        -- backfilled; drives the accuracy panel
  model        text NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone_id, bucket_start, model)
);
CREATE INDEX IF NOT EXISTS fc_zone_time_idx ON demand_forecast (zone_id, bucket_start);

CREATE TABLE IF NOT EXISTS risk_cells (
  id           bigserial PRIMARY KEY,
  cell_ref     text NOT NULL,
  geom         geometry(Polygon, 4326) NOT NULL,
  zone_id      uuid REFERENCES zones(id),
  hour_band    int NOT NULL,               -- 0..5, see docs/08 §2.2
  score        numeric(6,3) NOT NULL,
  factors      jsonb NOT NULL,
  model        text NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cell_ref, hour_band, model)
);
CREATE INDEX IF NOT EXISTS risk_geom_idx ON risk_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS risk_band_idx ON risk_cells (hour_band, score DESC);

CREATE TABLE IF NOT EXISTS rank_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_from date NOT NULL,
  period_to   date NOT NULL,
  level       zone_level NOT NULL,
  weights     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rank_scores (
  run_id     uuid NOT NULL REFERENCES rank_runs(id) ON DELETE CASCADE,
  zone_id    uuid NOT NULL REFERENCES zones(id),
  composite  numeric(7,3) NOT NULL,
  components jsonb NOT NULL,
  rank       int NOT NULL,
  prev_rank  int,
  sample_n   int,
  PRIMARY KEY (run_id, zone_id)
);

CREATE TABLE IF NOT EXISTS kpi_registry (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  definition   text NOT NULL,
  formula      text NOT NULL,              -- shown in the UI; lineage starts here
  unit         text NOT NULL,
  direction    text NOT NULL,              -- lower_better|higher_better
  target       numeric,
  warn_at      numeric,
  breach_at    numeric,
  iso22320_ref text,
  owner_role   text,
  source_view  text NOT NULL
);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id          bigserial PRIMARY KEY,
  kpi_key     text NOT NULL REFERENCES kpi_registry(key),
  zone_id     uuid REFERENCES zones(id),
  agency_id   uuid REFERENCES agencies(id),
  period_from timestamptz NOT NULL,
  period_to   timestamptz NOT NULL,
  value       numeric NOT NULL,
  sample_n    int,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kpi_snap_idx ON kpi_snapshots (kpi_key, zone_id, period_from DESC);

CREATE TABLE IF NOT EXISTS report_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  owner_id    uuid REFERENCES users(id),
  definition  jsonb NOT NULL,
  shared_with text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS data_quality_runs (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source  text NOT NULL,
  ran_at  timestamptz NOT NULL DEFAULT now(),
  rows_in int NOT NULL,
  score   numeric(5,2),
  results jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS dq_src_idx ON data_quality_runs (source, ran_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
--  9 · Agency feeds, environment, events
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agency_feeds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text UNIQUE NOT NULL,     -- traffic|bms|water|waste|environment
  agency_id      uuid NOT NULL REFERENCES agencies(id),
  name           text NOT NULL,
  kind           text NOT NULL,
  classification data_class NOT NULL DEFAULT 'shared_confidential',
  is_simulated   boolean NOT NULL DEFAULT true,   -- drives the "simulated source" chip
  last_update    timestamptz
);

CREATE TABLE IF NOT EXISTS traffic_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text UNIQUE NOT NULL,
  name          text,
  zone_id       uuid REFERENCES zones(id),
  corridor      text,
  evp_capable   boolean NOT NULL DEFAULT false,
  state         text NOT NULL DEFAULT 'auto',
  geom          geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS sig_geom_idx ON traffic_signals USING GIST (geom);

CREATE TABLE IF NOT EXISTS weather_hourly (
  ts          timestamptz PRIMARY KEY,
  temp_c      numeric(4,1) NOT NULL,
  humidity    int,
  wind_kph    numeric(5,1),
  wind_dir    int,
  visibility_m int,
  rain_mm     numeric(6,2) NOT NULL DEFAULT 0,
  condition   text
);

CREATE TABLE IF NOT EXISTS events_calendar (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text UNIQUE NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL,             -- national|sport|concert|exhibition|religious|retail
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  zone_id      uuid REFERENCES zones(id),
  expected_footfall int,
  demand_multiplier numeric(5,2) NOT NULL DEFAULT 1.0,
  geom         geometry(Point, 4326)
);
CREATE INDEX IF NOT EXISTS events_time_idx ON events_calendar (starts_at, ends_at);


-- ═══════════════════════════════════════════════════════════════════════════════
--  10 · Operations support (Phase 5)
-- ═══════════════════════════════════════════════════════════════════════════════

-- The resting state: the handful of mid-flight incidents the Operations screen opens on
-- (docs/06 §2.5). Tagged so `seed:reset` can restore them relative to now. They are
-- NOT seeded history (is_seed = false), so no analytic view mistakes them for it.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS is_resting boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS inc_resting_idx ON incidents (is_resting) WHERE is_resting;

-- "Is this unit committed?" is asked for every unit on every fleet read. Each unit has
-- thousands of cleared historical assignments; this index holds only the live ones. The
-- predicate is repeated VERBATIM in repos/fleet.js — Postgres uses a partial index only
-- when it can prove the query's clause implies it.
CREATE INDEX IF NOT EXISTS asg_active_idx ON assignments (unit_id, incident_id)
  WHERE state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene');
CREATE INDEX IF NOT EXISTS asg_offered_idx ON assignments (offered_at) WHERE state = 'offered';

-- The next INC-YYMMDD-NNNN is found by prefix; without pattern ops a LIKE prefix scans
-- every incident ever recorded.
CREATE INDEX IF NOT EXISTS inc_ref_pattern_idx ON incidents (ref text_pattern_ops);

-- The universal chart filter (lib/filters.js) slices by the PRIMARY responding unit — its
-- kind, its agency, its home station — on every analytical read. That resolves to
-- "which incidents did any of these units primarily respond to", which is this index.
-- unit_id leads because the unit set is known first; incident_id follows so the lookup
-- stays index-only.
CREATE INDEX IF NOT EXISTS asg_primary_unit_idx ON assignments (unit_id, incident_id)
  WHERE is_primary;

-- Road routes, cached. The public OSRM server is rate-limited and unsuitable for a demo
-- over a hotel network (docs/00 O-6): a route fetched once is served from here after.
CREATE TABLE IF NOT EXISTS route_cache (
  key          text PRIMARY KEY,            -- provider:profile:lng,lat;lng,lat at ~1 m
  provider     text NOT NULL,
  distance_m   int NOT NULL,
  duration_sec int NOT NULL,                -- the provider's FREE-FLOW figure, not an ETA
  geom         geometry(LineString, 4326),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  hits         int NOT NULL DEFAULT 0
);

-- Idempotency-Key replay for retryable writes (docs/04 §1). A dispatcher double-clicking
-- DISPATCH on a slow network must not send two ambulances.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id    uuid NOT NULL REFERENCES users(id),
  key        text NOT NULL,
  method     text NOT NULL,
  path       text NOT NULL,
  status     int NOT NULL,
  body       jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idem_created_idx ON idempotency_keys (created_at);


-- The road driven on the TRANSPORT leg, recorded the same way the road to the scene is.
-- A replay of a job is the whole job — scene, then hospital — and without this the second
-- half of every trip could only be drawn as straight lines between breadcrumbs.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS route_hospital     geometry(LineString, 4326);
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS route_hospital_sec int;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS route_hospital_m   int;


-- The automatic-dispatch policy — ONE row. `mode = 'ai'` means the engine sets the values
-- itself (services/dispatchRules.js, adapting to how much of the fleet is free); `custom`
-- means a duty officer fixed them, and `custom` holds exactly what they chose. Kept in the
-- database rather than in memory so a restart cannot quietly undo somebody's decision.
CREATE TABLE IF NOT EXISTS dispatch_rules (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode        text NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'custom')),
  custom      jsonb NOT NULL DEFAULT '{}',
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- A short SIGN-IN NAME, separate from the operational ref. A ref is `<rolecode>-<4 hex>`
-- (docs/03 §1) and identifies a person in the audit trail; `admin` is not a ref, an email
-- or a phone number, and forcing it to be one of them would either break that convention
-- or put a non-address in the email column. One nullable column instead, matched by the
-- login route (routes/auth.js) alongside ref/email/phone. Unique case-insensitively:
-- `Admin` and `admin` are the same account, and typing either signs the same person in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username))
  WHERE username IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════════
--  11 · Schema bookkeeping
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS _schema_meta (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO _schema_meta (key, value) VALUES ('version', '1.0.0')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
