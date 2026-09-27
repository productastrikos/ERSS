# 04 · API & socket contract

Both surfaces talk to one origin on port **4327**. REST for state, Socket.IO for
fan-out. The rules from [02-ARCHITECTURE §6](02-ARCHITECTURE.md#6--data-flow-rules)
govern which is used when — in one line: **writes over REST, fan-out over socket, and
every screen must render from REST alone.**

---

## 1 · Conventions

| Concern | Rule |
|---|---|
| Base path | `/api` for REST, `/socket.io` for the socket, `/health` and `/version` bare |
| Auth | Signed HTTP-only cookie `erss_sid`. The socket authenticates from the same cookie during the handshake — no separate token. |
| Errors | `{ error: { code, message, detail? } }` with a real HTTP status. Codes are machine keys (`unauthorised`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `db_unavailable`, `engine_failed`). |
| Validation | `zod` on every body and query. `422` with per-field detail. |
| Pagination | `?limit=&cursor=`; responses carry `{ items, nextCursor }`. Never offset paging on incident lists. |
| Geometry | GeoJSON in and out, WGS84 lon/lat. Never WKT across the wire. |
| Time | ISO 8601 with offset, always. Durations in **seconds**, integers, never "4m 12s" strings — formatting is the client's job. |
| Scoping | Every list route is filtered server-side by the caller's role and `zone_scope`. There is no client-side filtering of data the user may not see. |
| Idempotency | Mutating routes that can be retried (dispatch, acknowledge, act) accept `Idempotency-Key`. |

---

## 2 · Reference & bootstrap

| Method | Path | Returns |
|---|---|---|
| `GET` | `/health` | `{ status, api, db, uptime, version }`. `503` when the DB is down, with the target host so a misconfiguration is obvious. |
| `GET` | `/version` | Build sha, built-at, schema version |
| `GET` | `/api/bootstrap` | Everything a surface needs on load in one round trip: session user, role, permissions, jurisdiction pack (agencies, emergency numbers, SLA defaults, hierarchy labels), enabled feeds, active scenario run if any. **One call, so a cold load is one request, not eleven.** |
| `GET` | `/api/zones?level=&parent=` | Zone tree or one level, with geometry |
| `GET` | `/api/agencies` | |
| `GET` | `/api/stations` · `/api/hospitals` | With capabilities and live ED load |
| `GET` | `/api/makani/:code` | Resolve a 10-digit code → point, entrance, building, floors |
| `GET` | `/api/makani/reverse?lng=&lat=` | Nearest entrance points, ranked |
| `GET` | `/api/kpi/registry` | The KPI library with formulas and thresholds |

### Map layers — the ported FastAPI routes

Shapes preserved from `dso_api` so existing map code keeps working during migration.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/layers/roads` · `/buildings` · `/pois` · `/parks` · `/water` · `/railways` · `/infrastructure` | GeoJSON `FeatureCollection`; `?bbox=` required above a size threshold |
| `GET` | `/api/layers/all` | Everything for a bbox, one call — the DSO close-up scenes |

---

## 3 · Incidents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/incidents?state=&priority=&kind=&zone=&from=&to=&bbox=&limit=&cursor=` | The queue and the map both use this |
| `GET` | `/api/incidents/:ref` | Full record: timeline, assignments, agency notifications, notes, patients, correlated context |
| `POST` | `/api/incidents` | Create. Body: kind, priority (or omit for auto-triage), location (geom **or** makani), source, caller, complaint. Returns the incident with `dispatch_recommendation` already attached. |
| `PATCH` | `/api/incidents/:ref` | Priority, kind, location correction, access note |
| `POST` | `/api/incidents/:ref/triage` | Sets `triaged_at`, triage code, acuity |
| `POST` | `/api/incidents/:ref/close` | Requires an `outcome` |
| `POST` | `/api/incidents/:ref/notes` | Collaborative workspace (BoQ-1 F6) |
| `GET` | `/api/incidents/:ref/recommendation` | Re-run `dispatch` without committing. Returns ranked units **with `dispatch_rationale`** — the factor breakdown the dispatcher sees before approving. |
| `POST` | `/api/incidents/:ref/assignments` | **Commit the dispatch.** Body `{ unitId, rationale }`. Creates the assignment, sets `dispatched_at`, offers to the unit, opens the preempt corridor if eligible, notifies the agencies the correlation engine selected. One call does the whole dispatch. |
| `GET` | `/api/incidents/:ref/correlation` | BoQ-1 F9: wind and plume direction, population within radius, schools/hospitals/sensitive sites nearby, agency feeds relevant to this incident, recommended agency set |
| `POST` | `/api/incidents/:ref/notify` | Notify an agency set; records `agency_notifications` with the SLA clock |
| `GET` | `/api/incidents/:ref/aar` | After-action report: full reconstruction, per-stage timings, per-agency SLA, route comparison, ETA accuracy, decisions and who made them |

---

## 4 · Units & assignments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/units?status=&agency=&kind=&bbox=` | |
| `GET` | `/api/units/:ref` | Including current assignment and shift |
| `PATCH` | `/api/units/:ref/status` | Duty state changes from the console |
| `POST` | `/api/units/:ref/standby` | Place at a staging point (from a coverage advisory) |
| `GET` | `/api/units/:ref/track?from=&to=` | Position history as a LineString — route replay |
| `GET` | `/api/assignments/:ref` | |
| `POST` | `/api/assignments/:ref/acknowledge` | Responder app |
| `POST` | `/api/assignments/:ref/decline` | Requires a reason; triggers automatic re-dispatch |
| `POST` | `/api/assignments/:ref/enroute` | |
| `POST` | `/api/assignments/:ref/onscene` | Server stamps from its own clock, not the client's |
| `POST` | `/api/assignments/:ref/transporting` | Body `{ hospitalId }` |
| `POST` | `/api/assignments/:ref/at-hospital` | |
| `POST` | `/api/assignments/:ref/clear` | |
| `GET` | `/api/assignments/:ref/route` | Proposed vs taken, with the delta and the seconds difference |

> **On-scene timestamps are server-stamped.** The client says "I have arrived"; the
> server decides when that was, using its own clock and the last known position. This
> prevents a responder's device clock from corrupting the one metric the whole product
> is judged on.

### As built (Phase 5) — incidents, units, assignments

What changed against the tables above, and what was added. Routes live in
`server/routes/{incidents,assignments,units,operations}.js`; the logic in
`server/services/`.

| Method | Path | As built |
|---|---|---|
| `GET` | `/api/incidents?status=active\|all&priority=P1,P2&kind=&zone=&from=&to=&bbox=&limit=&cursor=` | `status` replaces `state`. `active` = not closed, sorted priority then longest waiting, unpaged. `all` defaults `from` to GST midnight and is keyset-paged on `(reported_at, ref)`. Readable with `operations.view` **or** `collaborate.view`. |
| `GET` | `/api/incidents/:ref` | `{ incident, timeline, assignments, notifications, notes, patients, acknowledgeTimeoutSec, serverTime }`. Each assignment carries `allowedActions` and `canTransport`. |
| `POST` | `/api/incidents` | Returns `{ incident, recommendation, recommendationError, triage }`. The incident is created **triaged** (the console form is the call-taker's triage). A Makani number wins; otherwise the point attaches to the nearest existing entrance within 60 m. A floor above the building's floor count is refused (422). `Idempotency-Key` honoured. |
| `GET` | `/api/incidents/:ref/recommendation?exclude=AMB-01,AMB-02` | An `EngineResult` whose value is `{ recommendations, excluded, requirement, weights, transport, vrt }`. |
| `POST` | `/api/incidents/:ref/assignments` | Body `{ unitRef, overrideReason? }` — the reason is **required** unless the unit is the top recommendation (422). The rationale is recomputed server-side. 409 if the unit is not available/standby or already assigned. Correlated agencies are notified; the pre-empt corridor is **not** opened (Phase 6.7). Returns `{ assignment, incident }`. |
| `POST` | `/api/incidents/:ref/close` | 409 while any crew is on scene, transporting or at hospital; units not yet on scene are stood down by the close. |
| `POST` | `/api/incidents/:ref/notifications/:agency/acknowledge` | **New.** Stops an agency's SLA clock. A user may acknowledge for their own agency; a dispatch role may log it for any. |
| `GET` | `/api/kpi/today` | **New.** Today's KPI strip from `v_incident_response` (resting-state incidents excluded), zone-scoped. |
| `GET` | `/api/hospitals/recommend?incident=` | An `EngineResult` whose value is `{ hospitals, excluded, requirement }`. |
| `POST` | `/api/assignments/:ref/:action` | `action` ∈ `acknowledge, decline, enroute, onscene, at-patient, transporting, resolve, at-hospital, clear, cancel`. **New:** `at-patient` (stamps `at_patient_at` and `vrt_sec`, keeps state `onscene`), `resolve` (treated on scene), `cancel` (stand down, dispatcher only, reason required). A responder may act only on its own unit's assignment; a dispatch role may log any step on the crew's behalf and the timeline says so. `transporting` is refused for a unit that cannot carry a patient. 409 with a readable reason for any illegal transition. `Idempotency-Key` honoured. |
| `PATCH` | `/api/units/:ref/status` | Only `available`, `off_duty`, `out_of_service`, `standby` (the last needs a standby point); 409 while the unit is on an assignment. |

**Acknowledge timeout.** A server loop checks every 2 s, on the domain clock (so a paused
scenario pauses it). A timed-out or declined offer is re-offered automatically to the best
unit not yet tried, at most `maxAutoRedispatch` (2) times; then the incident returns to
`triaged`, the timeline records `redispatch_exhausted`, and consoles get a `notify`.

**References.** Assignments are `ASG-YYMMDD-NNNN-n` (the incident's reference plus the
offer number) — the planned `ASG-NNNN-n` would repeat every day.

---

## 5 · Clinical

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/incidents/:ref/patients` | Create a patient record; supports multiple for mass casualty |
| `POST` | `/api/patients/:id/identify` | Body `{ emiratesId }`. Hashes it, stores last 3, calls the NABIDH seam, returns allergies / conditions / medications / recent encounters. **Audited as a clinical-data access.** |
| `POST` | `/api/patients/:id/vitals` | A telemetry sample |
| `POST` | `/api/patients/:id/triage-tag` | START/SALT tag for mass casualty |
| `POST` | `/api/patients/:id/prealert` | Send pre-arrival activation to the receiving hospital; starts the acknowledgement clock |
| `GET` | `/api/hospitals/recommend?incident=` | Ranked destinations by capability match, ED load and drive time, with the reasoning |
| `GET` | `/api/hospitals/:ref/inbound` | The hospital coordinator's view |

---

## 6 · Intelligence

Every response below is an `EngineResult` or an array of them — value plus method,
window, inputs, factors and confidence.

| Method | Path | Engine |
|---|---|---|
| `GET` | `/api/analytics/response-time?zone=&from=&to=&split=` | `responseTime` — stage decomposition, p50/p90, biggest contributor |
| `GET` | `/api/analytics/hotspots?from=&to=&kind=&cell=` | `hotspot` — KDE surface + significant clusters |
| `GET` | `/api/analytics/radial?lng=&lat=&radius=&from=&to=` | `radial` — the Concept Note's 500–1000 m radial search, trended |
| `GET` | `/api/analytics/compare?a=&b=&metric=` | Period-over-period classification comparison |
| `GET` | `/api/analytics/risk?hourOfWeek=&bbox=` | `risk` — RTM cells with per-factor contribution |
| `GET` | `/api/analytics/demand?zone=&horizon=` | `demand` — forecast with 80% interval |
| `GET` | `/api/analytics/demand/accuracy?from=&to=` | Forecast vs actual, held to account |
| `GET` | `/api/analytics/crowd?event=&at=` | `crowd` — density, choke points, lead-time alerts |
| `GET` | `/api/analytics/evacuation?building=&scenario=` | Egress model over the building twin |
| `GET` | `/api/analytics/coverage?at=` | `coverage` — current expected coverage and the optimal alternative |
| `GET` | `/api/analytics/equity?from=&to=` | `equity` — per-zone dispatch fairness check |
| `GET` | `/api/analytics/anomaly?from=&to=` | `anomaly` — flagged deviations from seasonal baseline |
| `GET` | `/api/analytics/preempt-impact?from=&to=` | Pre-empt events, grant rate, measured seconds saved |

### Ranking (Pillar 2)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/ranking?level=&period=&weights=` | League table; passing `weights` recomputes live without persisting |
| `POST` | `/api/ranking/weights` | Persist a weight set (versioned, audited) |
| `GET` | `/api/ranking/weights` | Current and historical weight sets |
| `GET` | `/api/ranking/:zoneRef/scorecard?period=` | Publishable scorecard payload |
| `GET` | `/api/ranking/compare?zones=a,b,c&period=` | Side-by-side |
| `POST` | `/api/ranking/rebaseline` | BoQ-2 F8: change a zone's fleet strength, recompute, return before/after |

### Advisories & action engine (Pillar 5)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/advisories?severity=&state=&category=&zone=` | The advisory hub |
| `GET` | `/api/advisories/:ref` | Drill-down: impacted zones, geo representation, window analysed, sources cited |
| `POST` | `/api/advisories/:ref/analyse` | The **Analyze** button. Runs the deeper query behind the advisory and attaches the result. |
| `POST` | `/api/advisories/:ref/act` | The **Act** button. Body `{ agencyId, ownerId, action, slaHours }`. Creates the routed task and starts the SLA clock. |
| `POST` | `/api/advisories/:ref/measure` | Record the measured value in the verify window |
| `POST` | `/api/advisories/:ref/close` · `/dismiss` | Dismiss requires a reason |
| `POST` | `/api/advisories/generate` | Force an advisory sweep (normally scheduled) |
| `POST` | `/api/whatif` | Scenario simulation: change fleet size, weather, event, staging; returns the re-forecast and the delta. No persistence. |

### BI / Data Intelligence (Pillar 4)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/bi/sources` | Registered sources with their quality score |
| `GET` | `/api/bi/fields?source=` | The semantic layer's dimensions and measures |
| `POST` | `/api/bi/query` | The report builder's engine. Body is a structured query (dimensions, measures, filters, sort, limit) — **not** raw SQL from the client. Server compiles it against the semantic layer. |
| `GET` `POST` `PATCH` `DELETE` | `/api/bi/reports` | Saved report definitions |
| `GET` | `/api/bi/reports/:id/export?format=csv\|xlsx\|png\|pdf` | |
| `GET` | `/api/bi/lineage?kpi=` | Source → view → KPI → tile graph |
| `GET` | `/api/bi/quality?source=` | Latest data quality run |

> `/api/bi/query` taking a structured query rather than SQL is a security decision, not
> a convenience one. A low-code builder that posts SQL is an injection surface with a
> friendly face.

### Executive (Pillar 6)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/executive/tiles?role=&zone=` | The configured tile set with each tile's current value, trend and drill-down target |
| `GET` `PUT` | `/api/executive/layout` | Per-role tile layout (widget framework, BoQ-6 T5) |
| `GET` | `/api/executive/iso22320` | The KPI set mapped to clause references |

---

## 7 · Scenarios

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/scenarios` | The catalogue with tier, duration and grounding |
| `POST` | `/api/scenarios/:ref/start` | Returns the run. Only one run active at a time; starting another requires `?force=true` and is audited. |
| `POST` | `/api/runs/:ref/pause` · `/resume` · `/stop` | |
| `POST` | `/api/runs/:ref/seek` | Body `{ toSec }` |
| `POST` | `/api/runs/:ref/speed` | Body `{ speed }` — 0.5 / 1 / 2 / 4 / 8 |
| `GET` | `/api/runs/:ref` | Cursor, state, the incidents and assignments it created |
| `GET` | `/api/runs/:ref/replay` | Full event stream for after-action replay |
| `POST` | `/api/runs/:ref/reset` | Remove everything the run created, restore fleet to resting state |

> **Scenario data is tagged.** Every incident, assignment and position row a run creates
> carries its `run_id`. Reset deletes by `run_id`. Seeded history (`is_seed = true`) is
> never touched by a reset. A demo can therefore be run, reset and re-run indefinitely
> without the analytics drifting.

---

## 8 · Admin, assistant, citizen

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` · `/logout` · `/api/auth/me` | Body `{ identifier, password }`. ONE identifier field, matched case-insensitively against `username`, `ref` and `email`, and exactly against `phone` — a responder in a vehicle should not have to remember which kind of identifier they hold. Returns the session token as well as setting the cookie: the browser surfaces keep it per tab so several roles can be signed in side by side. |
| `GET` `POST` `PATCH` | `/api/admin/users` | Archive, never delete |
| `GET` `PUT` | `/api/admin/thresholds` | KPI thresholds, SLA defaults, escalation rules |
| `GET` | `/api/admin/audit?entity=&actor=&from=` | Plus `GET /api/admin/audit/verify` which walks the hash chain and reports the first break |
| `GET` `PATCH` | `/api/admin/feeds` | Agency feed registry and classification |
| `POST` | `/api/assistant/ask` | Body `{ question, context }`. Tries rules first, then the LLM seam if configured. Always returns an answer and always says which path produced it. |
| `POST` | `/api/sos` | **Citizen app.** Body `{ kind?, geom, accuracy, silent?, note? }`. Creates a `P1`/`P2` incident from `source='app_sos'`, resolves the nearest Makani entrance, attaches the caller's medical profile, returns the incident ref so the app can track it. |
| `POST` | `/api/sos/:ref/cancel` | Requires confirmation; recorded as an outcome, not a delete |
| `GET` | `/api/sos/:ref/status` | Public-safe projection: state, assigned unit kind, live ETA, distance. **Never** exposes the unit's exact position history or other incidents. |
| `GET` `PUT` | `/api/me/medical-profile` | Citizen's own record only, always |

---

## 9 · External integration seams

Each is one module with a live implementation path and a mock. Which one is used is
decided by the presence of an env var, never by a code branch scattered around the app.

| Seam | Module | Live path | Mock behaviour |
|---|---|---|---|
| Makani | `integrations/makani.js` | Makani Search API v2 — geocode, reverse geocode, entrance geometry | Seeded `makani_points` table with real format and entrance semantics |
| NABIDH | `integrations/nabidh.js` | HL7 FHIR R4 over the DHA HIE; Emirates ID as identifier | Local FHIR-shaped service returning `Patient`, `AllergyIntolerance`, `Condition`, `MedicationStatement`, `Observation` bundles |
| CAD | `integrations/cad.js` | Inbound webhook / poll from an existing CAD | CSV replay feeder for shadow-mode demonstration |
| RTA signals | `integrations/rta.js` | Preemption request to the signal controller | The existing traffic signal simulation |
| Push | `lib/notify.js` | FCM via Capacitor | In-app + socket only |
| SMS / e-mail | `lib/notify.js` | Provider adapter | Logged to the notification ledger and shown in the UI as "would have been sent" |

**Seam honesty rule.** Wherever a mock is in use, the UI says so — a small, permanent
"simulated source" chip on the panel that consumes it. Not buried in a tooltip. In a
tender demo, being visibly honest about which integrations are live is worth more than
appearing to have them all.

---

## 10 · Socket protocol

Namespace `/`. Rooms decide who receives what.

### Rooms

| Room | Joined by | Carries |
|---|---|---|
| `console:<role>` | Console users | Role-scoped fan-out |
| `zone:<zoneRef>` | Anyone scoped to that zone | Zone-filtered incidents and advisories |
| `incident:<ref>` | Anyone viewing that incident | Timeline, assignments, notes, telemetry |
| `unit:<ref>` | The responder's device, and consoles tracking it | Assignment offers, position |
| `agency:<code>` | Users of that agency | Notifications, SLA clocks |
| `hospital:<ref>` | Hospital coordinators | Inbound and pre-alerts |
| `sos:<ref>` | The citizen who raised it | Their own incident only |
| `run:<ref>` | Everyone during a scenario | Clock ticks and run state |

### Client → server

| Event | Payload | Notes |
|---|---|---|
| `unit:position` | `{ unitRef, lng, lat, speed, heading, ts }` | The one socket-only write. Throttled client-side to 1/3 s; server persists at most 1/5 s per unit. |
| `presence:ping` | `{}` | Every 20 s; drives the "who is online" view |
| `incident:watch` / `unwatch` | `{ ref }` | Room management |
| `run:watch` | `{ ref }` | |

Everything else is REST. A client cannot create an incident, acknowledge an assignment
or act on an advisory by emitting an event.

### Server → client

| Event | Payload | Room |
|---|---|---|
| `incident:new` | Incident summary | `zone:*`, `console:*` |
| `incident:update` | `{ ref, patch }` | `incident:<ref>`, `zone:*` |
| `incident:timeline` | A timeline row | `incident:<ref>` |
| `incident:closed` | `{ ref, outcome }` | |
| `assignment:offer` | Full assignment + incident + route + Makani entrance | `unit:<ref>` |
| `assignment:update` | `{ ref, state, at }` | `incident:<ref>`, `unit:<ref>` |
| `unit:position` | `{ unitRef, lng, lat, heading, speed, status }` | `console:*`, `incident:<ref>` |
| `units:snapshot` | Full fleet state | On join, and every 30 s as a correctness backstop |
| `advisory:new` / `advisory:update` | Advisory | `console:*`, `agency:*` |
| `agency:notified` | `{ incidentRef, agency, at, slaSec }` | `agency:<code>` |
| `preempt:corridor` | `{ assignmentRef, signals[], grantedAt }` | `console:*` |
| `telemetry:sample` | A vitals sample | `incident:<ref>`, `hospital:<ref>` |
| `hospital:prealert` | Pre-arrival activation | `hospital:<ref>` |
| `sos:status` | Public-safe status projection | `sos:<ref>` |
| `kpi:tick` | Changed KPI values | `console:*` |
| `run:clock` | `{ runRef, cursorSec, speed, state }` | `run:<ref>` |
| `notify` | `{ level, title, body, link }` | Targeted |

### Reconnection

On reconnect the client **refetches** the screens it has open and rejoins its rooms. It
does not replay missed events. This is deliberate: an event replay buffer is a source of
subtle inconsistency, and the REST-is-the-floor rule makes it unnecessary. `units:snapshot`
every 30 s is the same principle applied to drift.

### As built (Phase 5) — socket

`server/realtime/index.js` (rooms, presence, the position stream) and
`server/realtime/fanout.js` (every server → client emit; called only after the write it
announces has committed). Client: `web/src/lib/socket.ts`.

- **Room membership is by surface.** Only console roles join `console:<role>` and the new
  **`console:fleet`** (fleet positions, snapshots, KPI ticks — every console user). Unscoped
  console users join `console:all` for incidents; zone-scoped users instead join
  `zone:<ref>` for each zone in their scope, and incident events go to the community's and
  its sector's rooms. A responder joins `unit:<its unit>` and its agency room; a citizen
  joins nothing yet (Phase 8). *Before Phase 5 every socket, phones included, joined
  `console:all`.*
- **`incident:watch` is access-checked:** a console user within scope, or a responder whose
  unit has an assignment on the incident. Citizens cannot watch incidents.
- **`incident:update`** carries the full incident summary as `patch`, so no client merges
  partial state.
- **`unit:position`** frames include `status`; a status change is sent at once as a
  one-unit frame, the GPS stream in 1 s batches.
- **`units:snapshot`** is `{ at, units }`, sent to a console on connect and every 30 s.
- **`kpi:tick`** is `{ at }` with **no values** — KPIs are zone-scoped and a broadcast
  cannot be; clients refetch `/api/kpi/today`.
- **`assignment:offer`** is `{ assignment, incident, route, entrance, acknowledgeBy }`.
  `route` is `null` at commit; the geometry follows as an `assignment:update` once fetched.
- The console shows liveness in the status bar (Live / Reconnecting / Offline) and, on
  reconnect, refetches the queue, the open incident, the fleet and the KPIs.

---

## 11 · Rate and volume expectations

Sized for a PoC, stated so that a reviewer can check the assumptions.

| Flow | Rate | Note |
|---|---|---|
| `unit:position` | ≤ 60 units × 1/3 s ≈ 20 msg/s during a scenario | Batched into 1 s frames server-side before fan-out |
| `telemetry:sample` | 1/s per active patient, ≤ 5 patients | ECG waveform windows are short arrays, not continuous streams |
| Incident list refresh | On event, debounced 500 ms | |
| Analytics queries | Seconds, not milliseconds; cached 60 s | The 24-month aggregates come from materialised views refreshed on a schedule |
| Concurrent console users in a demo | ≤ 10 | |
| Concurrent phones | ≤ 6 | |
