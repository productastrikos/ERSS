# 01 · Vision & scope

---

## 1.1 The product in one paragraph

**ERSS Dubai** is an interoperability and decision layer that sits above the command,
dispatch and building systems that Dubai's emergency authorities already run. It does
not replace a CAD. It measures the response minute by minute at source, predicts where
minutes will be lost before a shift begins, and turns each finding into a routed,
tracked instruction to the responsible department with a service-level timer against it.
Its unit of value is the minute recovered between a call being made and a patient being
reached.

## 1.2 The problem, stated with numbers

| Fact | Source | What it implies |
|---|---|---|
| DCAS average response ≈ **7 minutes** (2025), target **4 minutes** by 2033 | DCAS / UAE media office | A 3-minute gap that more vehicles alone will not close |
| **235,000+** emergencies handled in 2023; **279,000+** calls via the smart reporting system | DCAS | Volume is rising faster than fleet |
| Out-of-hospital cardiac arrest survival to discharge in Dubai: **3%** | Peer-reviewed Dubai single-centre study | The clinical cost of the gap |
| Bystander CPR performed in only **10.5%** of Dubai OHCA cases | Same | The golden minute is being lost before anyone professional arrives |
| Ambulances documented held at a single signal for up to **10 minutes** near Rashid Hospital | Gulf News | Preventable, and addressable by preemption |
| A single incident draws in 999 / 998 / 997 / 996 plus RTA, municipality, utility, hospital and the emirate crisis centre within minutes — coordinating **by voice** | Astrikos Concept Note §01 | The common picture exists only in the minds of people on a bridge call |

The gap is not a technology gap. Each authority's data is already excellent. What is
missing is the layer that holds them together in real time with the rules of engagement
already configured.

## 1.3 What we are building, what we are not

**We are building** the layer: measurement, prediction, advisory, routed action, and one
shared operating picture — plus the two field surfaces that feed it (a responder app and
a citizen SOS app) so that a demo can show data entering the system the way it really
would.

**We are not building** a CAD, a telephony/call-taking platform, an ePCR product, a
hospital EMR, or a replacement for any authority's existing command system. Where the
demo needs one of those, it is a stubbed integration with a clearly labelled seam
(see [04-API](04-API-AND-SOCKET-CONTRACT.md#9-external-integration-seams)).

---

## 2 · Personas

### Console personas

| Role key | Who | What they open first | What they must be able to do |
|---|---|---|---|
| `dispatcher` | DCAS control-room operator | Operations | See the call, the caller's Makani location, the recommended unit with its reasoning, and commit the dispatch in one action |
| `duty_officer` | DCAS shift / fleet commander | Operations → Advisories | Watch fleet coverage degrade and accept or reject a repositioning advisory |
| `service_lead` | DCAS leadership | Executive | Response, dispatch, acknowledge and en-route times by unit, zone and hour; the events most damaging to the average |
| `crisis_centre` | NCEMA / Dubai SCCDM duty officer | Collaborate | See a common operating picture across participating authorities and follow NRF escalation |
| `police_command` | General Command of Police | Executive → Analytics | Incident load and emerging patterns by zone and corridor |
| `hospital_coord` | Receiving hospital / DHA | Operations (inbound view) | See inbound cases, acuity and ETA; acknowledge pre-arrival activation |
| `infra_operator` | Airport, port, metro, venue, utility | Agencies | Expose their own estate's status to responders at an agreed classification |
| `analyst` | DCAS / DHA analyst | Intelligence | Build a report over call and incident data without a vendor request |
| `admin` | Platform administrator | Admin | Users, roles, zone scoping, KPI thresholds, ranking weights, audit |

### Mobile personas (`/app`, role decided at login)

| Role key | Who | Surface |
|---|---|---|
| `responder` | Ambulance crew, police PRV, fire/rescue unit | Duty state, assignment offer, navigation, on-scene, patient, handover, clear |
| `citizen` | Member of the public | SOS, live ETA, first-aid guidance, personal medical profile |

**Deliberately absent:** `volunteer` (ESEFNI 2.0) — see [O-5](00-DECISIONS.md#open-items).

---

## 3 · The six pillars, requirement by requirement

Each pillar below maps BoQ specification lines to what will actually be built. The
"Evidence" column is what a bidder would point at in a compliance response.

### Pillar 1 — Collaborative Intelligence · `/collaborate`

| BoQ line | Built as | Evidence |
|---|---|---|
| F1 Response time from call receipt to on-scene arrival | `responseTime` engine, measured per assignment from real timestamps | Stage-decomposition panel |
| F2 Break total into constituent stages | Seven stages: receipt → triage → dispatch → acknowledge → roll-out → en-route → on-scene | Waterfall chart with per-stage p50/p90 |
| F3 Collaborative optimisation advisories | `advisory` engine emits stage-specific advisories (e.g. acknowledge-time drift) | Advisory card with Analyze / Act |
| F4 Continuous monitoring and iterative refinement | Advisory carries a baseline, a target and a re-measure date; tracked to closure | Advisory lifecycle timeline |
| F5 Multi-stakeholder data on shared views | Agency lanes on one incident: Police / Ambulance / Civil Defence / Transport / Utility | Shared incident view |
| F6 Shared collaborative workspace, annotation, comments | Incident thread with per-agency attribution and audit trail | Incident thread panel |
| F7 Configurable escalation on threshold breach | Threshold rules per agency and priority; breach raises an escalation to the configured authority | Escalation rules editor + escalation log |
| F8 Comparative views across departments on a common incident | Per-agency SLA timer strip, met / not-met | SLA strip |
| F9 Auto-correlate hazard with context and notify all stakeholders sub-minute | On incident creation: wind direction (Environment feed), population density, schools/hospitals within radius; simultaneous notification | Correlation card + notification ledger with elapsed-time stamp |
| F10 Single unified command interface across six stakeholder types | The shared incident view is the same object for every agency | Role-switch demonstration |
| F11 Automated public communication | Public alert composer with a targeted geographic audience; delivery is stubbed and labelled | Public alert panel |
| T2 API integration with CAD/RMS/telematics | Documented inbound seam with a mock CAD feeder | `/api/integrations/cad` + seam doc |
| T3 Multi-tenant RBAC | Zone-scoped, agency-scoped roles | Admin → roles |
| T5 Audit trail on all collaboration actions | Hash-chained `audit_log` | Admin → audit, with chain verification |
| T6 Multi-channel notification engine | In-app + socket + push (Capacitor) live; SMS/e-mail stubbed behind one adapter interface | Notification settings + ledger |
| T9 Post-incident data logging | After-action report per incident | AAR export |
| T10 Scenario replay / what-if | Replay engine over recorded scenario runs and seeded history | Replay control bar |

### Pillar 2 — Performance Ranking · `/ranking`

| BoQ line | Built as |
|---|---|
| F1 Rank zones on weighted parameters | Composite score over: average response, unit availability, pre-empt event count, closure rate, radio/ROIP activity proxy, acknowledge time |
| F2 Add / remove / re-weight without vendor dependency | Weights editor in the UI, persisted, versioned; re-ranks live |
| F3 Leaderboards at multiple administrative levels with drill-down | Emirate → Sector → Community → Beat |
| F4 Rank-movement trends over configurable periods | Week / month / quarter / year, with arrows and sparklines |
| F5 Side-by-side comparative benchmarking | Two-to-four zone compare view |
| F6 Publishable scorecards | Per-zone scorecard, PDF/PNG export |
| F7 Alerts for zones below threshold | Flag rule into the advisory engine |
| F8 Fleet-expansion re-baselining | Change fleet strength for a zone; availability and rank recompute against the new baseline, showing before/after |

### Pillar 3 — ML & Geospatial Analytics · `/analytics`

| BoQ line | Built as |
|---|---|
| F1 Incident anticipation via predictive analytics | `demand` engine — per-zone per-hour-of-week rate with covariate adjustment |
| F2 Risk Terrain Modelling | `risk` engine — 500 m grid, weighted risk factors, per-cell factor attribution |
| F3/F4 Trend analysis and forecasting | Trend explorer, forecast vs actual with error bands |
| F5 Event-based heat maps, type/sub-type views | Incident heat surface, top-10 / bottom-10 event types |
| F6 Drill-down to last mile | Emirate → Sector → Community → Beat → 500 m cell |
| F8 Urban / rural differentiation | Urban core vs desert/periphery zone class, separate baselines |
| F10 Behavioural prediction | `crowd` engine over footfall, event calendar, weather |
| F11 Real-time crowd density monitoring | Zone density surface from the seeded/scenario IoT feed |
| F12 Predictive stampede / congestion alerts with lead time | Threshold-crossing forecast with explicit lead-time figure |
| F13 Building/venue evacuation modelling | Egress model over the existing building digital twin floor plates |
| F14 Computer vision over CCTV | **Scoped down** — the existing CCTV feeds display, with a labelled detection overlay driven by scenario script, not a live CV model. Stated plainly as a seam. |
| F15 NLP sentiment/intent over text sources | **Scoped down** — keyword/intent classification over call notes, rules-based, labelled as such |
| F16 Digital twin capability | The existing building and city twin, re-framed |
| F17 Mega-event analytics, pre-event planning and post-event review | Scenario SC-03 plus its planning and after-action views |

> F14 and F15 are the two places where an honest PoC cannot deliver what the BoQ line
> literally says. They are built as clearly-labelled seams with working UI and
> scripted data, and the limitation is recorded here rather than hidden.

### Pillar 4 — Business & Data Intelligence · `/intelligence`

| BoQ line | Built as |
|---|---|
| F1 Aggregated data intelligence | Semantic layer over the warehouse views |
| F2 Data quality enhancement | Quality rules engine: completeness, validity, duplication, timeliness; per-source scorecard |
| F3 Single administrative control point | One Intelligence workspace over sources, models, reports |
| F4 Self-service pivot, drill-down, slice-and-dice | Interactive report builder |
| F5 KPI library with calculated metrics | KPI registry with formula, owner, threshold, lineage |
| F6 Ad-hoc drag-and-drop authoring + scheduled distribution | Report builder; scheduling stubbed behind the notification adapter |
| F7 Data lineage and metadata | Lineage graph from source → view → KPI → tile |
| T4 Low-code/no-code environment | Report builder + KPI editor + ranking weights editor together constitute it |
| T7 Export PDF / Excel / CSV / PPT / image | CSV, XLSX, PNG, PDF live; PPT out of scope, stated |

### Pillar 5 — Artificial Intelligence · `/advisories`

| BoQ line | Built as |
|---|---|
| F1 Predictive intelligence and forecasting for CXO | Forecast feed into the Executive dashboard |
| F2 Action engine linking insight to action | Every advisory carries **Analyze** and **Act**; Act creates a routed task with an owner and an SLA |
| F3 Smart policing / optimisation advisories | Patrol and standby-point advisories from the `coverage` engine |
| F4 Optimal resource deployment | `coverage` engine — expected-coverage maximisation over forecast demand |
| F6 Anomaly detection over incident/call/dispatch patterns | `anomaly` engine — seasonal-baseline EWMA with z-score |
| F7 Recommendation engine for deployment options | Ranked options with expected minute gain and coverage delta |
| F8 Severity-driven automatic workflow routing | Routine / elevated / critical response packages |
| F9 Smart resource deployment computing critical zones, backup availability, congestion, mobile team recommendation | The composite output of `coverage` + `dispatch` + Transport feed |
| F10 Predictive scenario simulation ahead of risk | What-if runner: change fleet, weather, event, then re-forecast |
| T5 Explainability — confidence and contributing factors | Mandatory on every engine output; enforced by a shared result envelope |
| T8 Bias / drift safeguards | `equity` engine — per-zone dispatch-equity check, flagged when a zone is systematically deprioritised |
| T9 Sub-minute multi-stakeholder notification | Measured and displayed on every multi-agency incident |

### Pillar 6 — Executive Dashboard · `/executive`

| BoQ line | Built as |
|---|---|
| F1 Centralised role-based CXO dashboard | Role-configured tile layout |
| F3 KPIs aligned to ISO 22320 | Named KPI set, each mapped to a clause reference |
| F4 Single pane integrating pillars 1–5 | Tiles sourced from each pillar's API |
| F6 Configurable role-based views by administrative level | Emirate / sector / community scoping per role |
| F7 Drill-down from summary into the underlying module | Every tile is a link into its pillar with the filter carried across |
| F8 Video-wall, desktop and tablet | Video-wall mode: larger type ramp, no hover-dependent affordance, auto-rotate |
| F9 Live "digital twin"-style situational layer | Live map tile + near-term risk flags |
| F10 Mega-event command without a parallel system | Event mode overlays staging, crowd and perimeter on the same dashboard |
| F11 Post-incident and post-event executive review | AAR library |
| T5 Widget framework — add tiles without vendor dependency | Tile registry + layout editor |
| T9 Multi-channel escalation from KPI breach | KPI threshold → advisory → notification |
| T10 Executive scenario replay | Shared replay engine |

---

## 4 · Explicitly out of scope

Recorded so that nobody discovers these at demo time.

| Out of scope | Why | What exists instead |
|---|---|---|
| Live Makani API integration | Requires a Dubai Municipality API key and agreement | A seeded Makani point set for the demo geography with the real 10-digit format and entrance semantics; one adapter module with the live call commented and documented |
| Live NABIDH integration | Requires DHA onboarding, certification and a production agreement | A FHIR R4-shaped mock service returning realistic Patient / AllergyIntolerance / Condition / MedicationStatement / Observation bundles |
| Live CAD / RMS ingestion | No access | Documented inbound seam with a mock feeder that can replay a CSV |
| Live RTA signal control | No access; and commanding real signals is not a PoC activity | The existing traffic signal simulation, driven by the `preempt` engine |
| Real telephony / call recording | Not our layer | Call metadata is created by scenario or by the citizen app |
| Live CCTV computer vision | See Pillar 3 F14 | Video plays; detections are scripted and labelled |
| iOS build | No Mac in the toolchain | Android APK only |
| Arabic / RTL | [D-09](00-DECISIONS.md#d-09--language-english-only-i18n-ready) | i18n plumbing in place, `en` pack only |
| Production authentication (SSO, MFA, IdP) | PoC | Local accounts, bcrypt, role claims; SSO is a documented seam (BoQ-6 T3) |
| High availability / DR | PoC | Single process; the architecture does not preclude it |

---

## 5 · What "done" means for this transformation

1. `npm run dev` from a clean clone, with Postgres reachable and seeded, brings up the
   console at `:3327` and the mobile app at `:3327/app` against a backend on `:4327`.
2. All six pillar routes load with real, populated data and no placeholder text.
3. The three Tier-1 scenarios and the three Tier-2 ambulance scenarios run end to end,
   from a citizen or scripted trigger through to incident closure and after-action
   review, driving both the console and a phone.
4. Every engine output visible in the UI shows its evidence, window and confidence.
5. An Android APK installs on a phone and completes a responder assignment over the LAN.
6. `npm run audit:theme` reports zero hard-coded colours and zero forbidden patterns.
7. `docs/` matches what was built; anything that changed during the build is corrected
   here, not left stale.
