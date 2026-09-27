# 08 · Intelligence engines

Thirteen engines in `server/engines/`. Each is a pure function over data fetched by a
repository. Each returns an `EngineResult` envelope. None of them calls a model API.

> **Honest labelling.** These are statistics and operations research. Where the source
> research proposes a deep reinforcement learning approach, this document names what is
> built instead and why. A tender response should describe these as what they are: a
> working, explainable analytical layer. Claiming a trained D3QN that cannot be
> demonstrated is a liability; a coverage optimiser whose arithmetic you can show on a
> whiteboard is not.

---

## 1 · The result envelope

`server/lib/result.js`. Every engine returns this. The advisory and analytics UI take
this type and cannot render without `factors` and `window` — which is how
explainability is made structural rather than aspirational.

```js
{
  value,                         // number | array | object
  unit,                          // 'seconds' | 'calls/hour' | 'score' | …
  confidence,                    // 0..1, and each engine documents what it means
  window:  { from, to },         // the period actually analysed
  inputs:  [ { source, rows, asOf } ],
  factors: [ { name, contribution, direction, detail } ],
  method:  'poisson-rate-hourly-v1',
  computedAt,
  caveats: []                    // e.g. 'sample below 30 — interval widened'
}
```

`confidence` is never invented. Each engine below states exactly what its confidence
number is derived from. An engine that cannot justify a confidence returns `null` and
the UI shows "not enough data", which is more useful than a fabricated 0.7.

---

## 2 · Descriptive engines

### 2.1 `responseTime` — stage decomposition · Pillar 1

**Method.** Order statistics over `v_assignment_stages` and `v_incident_response`.
No modelling; this is measurement.

For a filter (zone, agency, unit kind, priority, hour-of-week, period), returns per
stage: p50, p90, p95, mean, n. Plus the **contribution share** of each stage to total
response at p50, which is what makes the output actionable — "en-route travel is 58%
of response here" tells you to look at positioning, "acknowledge is 22%" tells you to
look at crew process.

**Biggest-contributor analysis.** Compares each stage against the same stage in the
baseline population (the emirate median for that hour band), reports the stages whose
excess is statistically distinguishable (Mann–Whitney U, α = 0.05), and ranks them by
absolute seconds of excess — not by ratio, because a 300% excess on a 4-second stage
is noise and a 15% excess on a 240-second stage is the whole problem.

**Confidence** = a function of n, via the width of the bootstrap CI on the p50
relative to the estimate.

**Feeds:** Collaborate → Response time; the Executive stage tile; advisory categories
`response_time` and `acknowledge_drift`.

### 2.2 `risk` — Risk Terrain Modelling + hotspots · Pillar 3

**Method.** RTM as Caplan & Kennedy formulate it, plus kernel density for the
historical intensity term.

1. Grid the served geography into 500 m cells (`risk_cells`).
2. For each risk factor, compute a per-cell exposure — either proximity
   (`ST_Distance` to the nearest feature, decayed) or density (count within a
   bandwidth):

   | Factor | Operationalised as |
   |---|---|
   | Historical incident intensity | Gaussian KDE over incidents in the window, bandwidth 400 m, weighted by priority |
   | Road class density | Weighted length of motorway/trunk/primary per cell |
   | Junction density | Signalised intersections per cell |
   | Population | Residential population per cell from zone population apportioned by built area |
   | High-rise count | Buildings > 20 floors per cell — the vertical-city factor |
   | Crowd venue proximity | Malls, stadia, transport hubs, event grounds, decayed |
   | Industrial / hazmat proximity | Decayed |
   | Coastal / water proximity | For 996-relevant risk |

3. Standardise each factor to a z-score across cells, clip at ±3.
4. Weighted sum. Weights are **fitted**, not guessed: a Poisson regression of observed
   incident counts per cell on the standardised factors over the training window, with
   the coefficients as weights. This is a real fit, on real (seeded) data, and it is
   reproducible.
5. **Temporal dimension.** Repeat per hour-of-week band (6 bands: weekday-night,
   weekday-morning, weekday-day, weekday-evening, weekend-day, weekend-night). Risk
   is not static, and a single risk map is a misleading artefact.

**Factor attribution** — each cell carries its per-factor contribution, so the UI can
say *why* a cell is high risk, which is the entire point of RTM over a heat map.

**Hotspot significance.** Getis–Ord Gi\* over the cell counts, so a cluster is reported
as significant rather than merely dark.

**Confidence** = McFadden pseudo-R² of the Poisson fit, reported honestly (it will be
modest, as it is in the literature).

**Feeds:** Analytics → Risk terrain and Incidents; `coverage`; advisory category `risk`.

### 2.3 `ranking` — composite scoring · Pillar 2

**Method.** Weighted sum of min-max normalised components, direction-corrected.

```
component_norm = (value − min) / (max − min)        if higher_better
                 1 − (value − min) / (max − min)    if lower_better
composite      = Σ weight_i × component_norm_i × 100
```

Components and default weights are in
[06 §5](06-CONSOLE-SPEC.md#5--ranking--ranking--pillar-2). Weights are a stored,
versioned artefact (`rank_runs.weights`), editable in the UI, and every run records
which set produced it — so a rank can always be reproduced.

**Deliberately simple.** A ranking that a district commander cannot recompute by hand
will not be trusted, and an untrusted ranking changes no behaviour. Normalisation is
min–max within the peer group (same level, same class) rather than global, so a desert
zone is not ranked against Downtown.

**Small-sample guard.** A zone with fewer than 30 incidents in the period is shown as
"insufficient data" rather than ranked. Ranking noise as if it were performance is the
most common way a league table does harm.

**Re-baselining** (BoQ-2 F8) recomputes availability and coverage components against a
modified fleet, holding everything else constant, and reports the before/after delta.

---

## 3 · Predictive and prescriptive engines

### 3.1 `demand` — spatiotemporal forecast · Pillar 3

> The DCAS research proposes Gaussian mixture clustering plus a CNN forward model. We
> implement a **seasonal Poisson rate model with covariate adjustment**. It is weaker
> in principle and stronger in practice at this data volume, it trains in under a
> second, and every term in it can be explained to a duty officer.

**Method.**

1. Base rate per zone per hour-of-week, as an exponentially weighted mean of historical
   counts with a 12-week half-life:
   `λ_base(z, how) = Σ w_k · n_k / Σ w_k`, `w_k = 0.5^(age_weeks / 12)`
2. Multiplicative covariate adjustments, each fitted as a ratio of observed to expected
   on the history:
   - **Weather** — temperature band, rain, sandstorm. Heat is a real demand driver in
     Dubai and the seed reflects it.
   - **Scheduled events** — from the event calendar, scaled by expected footfall.
   - **Day type** — public holiday, Ramadan, school term.
   - **Recent trend** — a 4-week drift term.
3. `λ = λ_base × Π adjustments`
4. Interval: Poisson 80% interval on λ, widened by the covariate uncertainty.

**Held to account.** Every forecast row is written to `demand_forecast` and its
`actual` is backfilled when the bucket closes. Analytics → Forecast shows MAE, bias and
interval coverage for the last 30 days. If the model is bad, the product says so.

**Confidence** = interval coverage achieved over the trailing 30 days, which is an
honest empirical number rather than a self-assessment.

**Feeds:** `coverage`, `crowd`, Analytics → Forecast, advisory category `demand`.

### 3.2 `eta` — travel time prediction · used everywhere

**Method.** OSRM gives free-flow geometry and duration. Free-flow duration is not
response time, so it is calibrated.

1. `t_osrm` — OSRM route duration, origin → destination.
2. **Multiplier model** — a lookup of the empirical ratio `t_actual / t_osrm` from
   history, keyed on hour-of-week band × dominant road class × zone class, with
   shrinkage toward the global mean for thin cells (James–Stein style, shrink factor
   from cell n).
3. **Preemption credit** — if a green-wave corridor is active, apply the measured
   preemption effect from `v_preempt_impact` for that corridor, not an assumed one.
4. **Vertical Response Time (VRT) term** — for incidents with a `floor`, a modelled
   lobby-to-patient time. **Corrected 16 Sep 2026:** the research establishes a VRT
   penalty of **4–8 minutes** in Dubai's high-rise clusters (Marina, JLT, Downtown) —
   comparable to, and sometimes exceeding, the entire vehicular drive time. The first
   draft of this plan modelled 45 s + 8 s/floor, which is an order of magnitude too
   small.

   ```
   VRT = lobbyAccess + securityClearance + liftWait + ascent + corridorFind
       lobbyAccess       60–120 s   (tower lobby, disembark with equipment)
       securityClearance 30–180 s   (gated/managed buildings; 0 for villas)
       liftWait          45–150 s   (scales with tower occupancy and time of day)
       ascent            floor × 2.5 s  (service lift, express vs local core)
       corridorFind      30–90 s    (multi-core floor plates)
   ```
   Calibrated so a 75th-floor Marina tower lands in the 6–8 minute band and a 3rd-floor
   walk-up lands near 90 s. Doubled where the building twin reports a lift out of
   service; a dedicated firefighter-lift override reduces `liftWait` to a floor value.

   This term is reported **separately** from travel time and appears as its own stage in
   the decomposition, because conflating them is exactly how the last-hundred-metres
   problem stays invisible. It is also why the platform distinguishes `onscene_at`
   (ambulance at the entrance) from `at_patient_at` — in a 163-floor building those are
   not the same event, and the standard response-time clock stops at the wrong one.
5. Interval from the residual distribution of the calibration cell.

**Held to account.** `assignments.eta_predicted_at` versus `onscene_at` gives
`eta_error_sec` as a stored generated column. Analytics shows the error distribution.
This is the Concept Note's *"recorded arrival compared with the AI-predicted arrival,
so the model is held to account"* — implemented, not asserted.

**Confidence** = 1 − (IQR of the calibration cell's residuals / predicted duration),
floored at 0.

> **As built (Phase 5)** — `server/engines/eta.js`, calibrated against the materialised
> view `mv_eta_calibration` (refreshed by `npm run seed:derived`).
>
> - **Calibrated on pace, not on the OSRM ratio.** Step 2 above needs OSRM's free-flow
>   duration for every historical trip, and history does not record one, so that ratio
>   cannot be measured. History does record road distance and measured travel, so the
>   engine is calibrated on **seconds per road metre**, keyed on hour band (night, morning
>   peak, midday, evening peak, late evening) × zone class. OSRM supplies the road
>   distance; its own duration is reported as the free-flow reference, never as the
>   prediction. `travel_q = max(short_q, pace_q × distance)`, where `short` is the measured
>   travel of sub-kilometre trips — a pure pace model would claim a 300 m call takes 30 s.
>   Road class is not a key: nothing in history records it.
> - **Shrinkage** toward the all-cells figure with weight `n / (n + 200)`.
> - **No road routing** (OSRM down or slow): distance = straight line × 1.34, and the
>   interval is widened across a 1.15–1.55 detour band. Confidence then falls out of the
>   same formula. Nothing is discounted by hand, and the method string ends
>   `+straight-line` so the UI says so.
> - **VRT is empirical by floor band** (`f00-09 … f60+`), from recorded `vrt_sec`, not the
>   parametric sum above. It is **not** shrunk toward an all-floors figure (height is what
>   drives it); a band with fewer than 30 ascents is extrapolated from the nearest band
>   below plus `ascentSecPerFloor` per extra floor, with a caveat. The parametric
>   constants stay in the jurisdiction pack for the scenario scripts.
> - **Arrival** = measured median acknowledge + turnout (when the unit has not moved) +
>   predicted travel.
> - **Pre-emption credit (step 3) is not applied** — `engines/preempt.js` is Phase 6.7.
> - OSRM lives behind `server/integrations/osrm.js`: memory cache → `route_cache` table →
>   network (2.5 s timeout). Two consecutive failures open a 60 s circuit; `/health`
>   reports request and failure counts and the last error. Route geometry for the map is
>   fetched **after** a dispatch commits (5 s × 3 attempts), so a slow routing server never
>   delays DISPATCH.

### 3.3 `coverage` — fleet positioning · Pillar 5

> The feasibility study proposes a Dueling Double Deep Q-Network over a semi-Markov
> decision process. We implement **Maximal Expected Coverage with a greedy exchange
> heuristic**. This is the standard operations-research formulation for ambulance
> positioning, it is well-evidenced in the EMS literature, and it terminates in
> milliseconds on this problem size.

**Method.**

1. **Demand points** — zone centroids weighted by `demand` forecast for the target
   window, subdivided to 500 m cells in dense zones.
2. **Candidate sites** — stations plus a curated standby-point set (Makani points at
   junctions, hospital forecourts, mall service roads, event perimeters).
3. **Coverage matrix** — `eta`-predicted travel time from every candidate to every
   demand point, thresholded at the target response time. Precomputed and cached;
   invalidated when the multiplier model updates.
4. **Objective** — maximise expected demand covered within target:
   `max Σ_j d_j · [1 − Π_i (1 − q)^{x_ij}]` where `q` is unit busy probability
   estimated from `v_unit_utilisation`, i.e. **MEXCLP**, which accounts for a unit
   already being on a job rather than assuming availability.
5. **Solve** — greedy construction then a 1-opt exchange pass. Optimality gap is
   reported, and at this size (≈60 units, ≈400 demand points, ≈120 candidate sites) it
   is small and the solve is fast.
6. **Relocation cost** — the objective is penalised by the travel time of each proposed
   move, so the engine does not churn the fleet for a marginal gain. The penalty is a
   tunable in the admin panel.

**Output.** Current expected coverage, optimal expected coverage, the gap in percentage
points, and a ranked list of moves — each with the unit, the destination, its Makani
code, the reason, and the expected minutes of response time recovered.

**Confidence** = derived from the demand forecast's confidence and the coverage
matrix's staleness.

**Feeds:** Advisories (category `coverage`), the responder app's standby assignment,
the what-if runner.

### 3.4 `dispatch` — unit recommendation · Pillar 5

**Method.** Multi-criteria scoring with an explicit, published weight vector. Not a
black box, because a dispatcher who cannot see why a unit was recommended will override
it, and a recommendation that is always overridden is worse than none.

```
score(u) = w_eta       · norm(eta(u))              // predicted, not straight-line
         + w_capability · capabilityMatch(u, inc)   // hard filter + graded score
         + w_coverage   · coverageCost(u)           // what taking this unit costs
         + w_crew       · crewReadiness(u)          // hours on shift, jobs run
         + w_equity     · equityAdjustment(u, inc)  // see §3.7
```

- **Capability** is a hard filter first (a BLS unit is not offered a cardiac arrest
  that needs ALS) then a graded preference among the qualifying set.
- **Coverage cost** calls `coverage` to evaluate the resulting fleet configuration —
  so the engine will decline to send the nearest unit when doing so strips cover from a
  high-demand zone and a unit 40 seconds further away does not.
- **Crew readiness** damps units late in a long shift with many jobs run.

The full factor breakdown is stored in `assignments.dispatch_rationale` **forever**.
Six months later, "why was that unit sent" has an answer.

**Multi-unit incidents** run the same scoring per required capability and check for
conflicts across the selected set.

**Feeds:** Operations dispatch panel, the auto-dispatch path in scenarios.

> **As built (Phase 5)** — `server/engines/dispatch.js`, wired by `services/dispatch.js`.
>
> - **Weights** are the jurisdiction pack's `dispatch.weights`: travel 0.55, capability
>   0.20, coverage 0.15, crew 0.10, equity 0. Each component is 0..1, higher is better:
>   travel = fastest arrival ÷ this unit's arrival; capability = 1 / 0.85 / 0.7 / 0.55 by
>   preference rank, 0.4 for a qualifying but unlisted kind.
> - **Capability hard filter** uses `CAPABILITY_REQUIREMENTS`. The candidate pool is the 12
>   nearest *qualifying* units (plus the 5 nearest of any kind, so the panel can show why
>   the closest was not recommended). Supervisor cars, air, mass-casualty buses and marine
>   units are excluded unless the incident kind names them (`nonPrimaryKinds`). A P1 of a
>   kind that does not require ALS still prefers it.
> - **Coverage cost is a proxy until `coverage` (MEXCLP, Phase 6.4) exists:** the demand of
>   the unit's area this hour of week relative to the emirate (from `mv_zone_hour_of_week`)
>   divided by 1 + the other available units within 3 km. Every result carries that caveat.
> - **Equity** is a visible zero until Phase 6.6 — stated in every rationale.
> - **Crew readiness** damps by jobs today (and hours on shift once shifts are recorded —
>   the seed does not record them yet).
> - **Transport.** Units in `nonTransportKinds` (MRU, supercar, supervisor, police, fire,
>   rescue) are flagged `canTransport: false`. When the top recommendation cannot carry a
>   patient, the result names the first unit that can, and the lifecycle never offers
>   `transporting` to such a unit.
> - **Confidence** is the probability that #1 really arrives before #2, from their ETA
>   intervals (σ = IQR ÷ 1.349) — the score's weights are policy, not uncertainty.
> - **The commit recomputes.** `POST /incidents/:ref/assignments` re-runs the engine; the
>   rationale stored is the server's at the moment of commit, with the rank the chosen unit
>   held, the top recommendation, any override reason, and any automatic re-dispatch.
>   Anything but rank 1 needs an override reason.
> - **Multi-unit selection is manual** (the "Add a unit" panel excludes units already on
>   the incident); per-capability multi-unit scoring is not built.

### 3.4a `triage` and `correlation` — as built (Phase 5)

Two small rule engines the plan assumed but did not list.

- **`engines/triage.js`** — used when an incident is created without a priority: the
  kind's modal priority from the case mix, raised to P1 on a life-threat phrase in the
  complaint. Confidence is that priority's share of the kind's calls; `null` when a phrase
  forced P1 (no measured basis). Labelled as a starting point, confirmed with one click.
- **`engines/correlation.js`** — BoQ-1 F9 context: wind and a ±30° plume sector for fires,
  population within 500 m / 1 km (zone density, labelled an estimate), sensitive sites
  within 1 km (hospitals plus the public-access defibrillator register's schools, malls,
  metro, stadiums, mosques, hotels — one line per site), active events within 2 km, the
  agency feeds relevant to the incident, and the agencies it calls for with a reason
  each. Rules, so `confidence: null` and `meta.rulesBased: true`. Its agency set is what a
  dispatch notifies. Civil Defence for a P1 above floor 20 (firefighter-lift control) and
  NCEMA at the emirate patient threshold are **modelled** rules and say so.

### 3.5 `hospital` — destination selection

**Method.** Filter by required capability (cath lab, stroke unit, trauma level,
paediatric, obstetric, burns, hyperbaric), then score on predicted transport time, ED
occupancy from `v_hospital_load`, current inbound count, and a diversion flag.

Returns ranked destinations, each with its reasoning and the clinical justification for
the capability requirement — "STEMI on 12-lead requires a cath lab; Rashid Hospital is
the nearest with one and is not on diversion" rather than a bare list.

> **As built (Phase 5)** — `server/engines/hospital.js`. Requirement by presentation:
> cardiac and cardiac arrest → cath lab; stroke → stroke unit; paediatric, obstetric,
> burns as named; RTA, falls and workplace injury at P1/P2 → trauma level 1. If no hospital
> has the capability, every ED is ranked with a caveat. Diversion excludes a hospital while
> another can take the patient. Score = 0.6 × transport (fastest ÷ this) + 0.3 × (1 − ED
> occupancy) + 0.1 × 1/(1 + inbound). ED occupancy is read from `hospitals` directly, not
> from `v_hospital_load`, whose all-time handover average is too expensive per request.
> Confidence is the recommended destination's transport-time confidence.

### 3.6 `preempt` — green wave · Pillar 5

**Method.** Given an active route:

1. Find signalised intersections within a 40 m buffer of the route line, in traversal
   order.
2. For each, predict arrival time from the unit's live position and the calibrated
   speed profile for that segment.
3. Issue a hold/extend request at `arrival − leadTime`, where `leadTime` is per-signal
   and defaults to 25 s, with a maximum hold from the jurisdiction config.
4. Release on passage, detected by position, or on timeout.
5. Detect conflicts: two units requesting opposing phases at the same intersection
   resolves by incident priority, then by which unit is closer.

**Measured, not assumed.** Every request writes a `preempt_events` row with its
outcome. `v_preempt_impact` compares preempted runs against matched non-preempted runs
on the same corridor and hour band, and reports the **measured** seconds saved. If the
measured saving is zero, the product reports zero.

This directly addresses the documented Dubai problem of ambulances held at a single
signal for minutes at a time.

### 3.7 `equity` — bias-aware dispatch check · Pillar 5

> From the feasibility study's bias-aware reward functions. Implemented as a monitor
> rather than as an objective term that silently reshapes dispatch, because a fairness
> correction that nobody can see is itself a governance problem.

**Method.** For each zone, compare the realised response-time distribution against the
emirate distribution, conditioned on incident priority and time of day. Flag zones
whose p90 is persistently worse than the emirate p90 by more than a threshold, after
controlling for distance-to-nearest-station — so the engine distinguishes *"this zone
is far from a station"* (a facts-of-geography finding, which is a planning input) from
*"this zone is systematically deprioritised at dispatch"* (a process finding, which is
an advisory).

`equityAdjustment` in `dispatch` is a small, capped, **visible** term shown in the
rationale breakdown, not a hidden thumb on the scale.

**Feeds:** advisory category `equity`, Ranking (as a flag, not a component).

### 3.8 `anomaly` — deviation detection · Pillar 5

**Method.** Seasonal-baseline EWMA with robust z-scores.

1. Baseline per series (zone × incident kind × hour-of-week) from the trailing 12 weeks.
2. EWMA of the current series, α = 0.3.
3. Robust z = (observed − median) / (1.4826 × MAD), which does not let one prior spike
   swallow the next one.
4. Flag at |z| > 3 sustained over 2 consecutive buckets — the sustain requirement is
   what keeps the advisory hub from filling with noise.

Series monitored: call volume by kind and zone, acknowledge time, turnout time,
en-route travel, decline rate, cancellation rate, preempt grant rate, data-source
freshness.

**Feeds:** advisory category `anomaly`.

### 3.9 `crowd` — density, stampede risk, evacuation · Pillar 3

**Method.** Three related models over the event and sensor feeds.

**Density.** Footfall counts per zone from the IoT/scenario feed, converted to
persons/m² over the walkable area, classified against the Fruin level-of-service bands
(A–F). LoS E and F are where crowd crush risk begins, and using the published bands
rather than an invented scale means the output is defensible.

**Flow and choke points.** Directional flow between adjacent zones; a choke point is an
edge whose inflow exceeds its modelled capacity (width × 1.3 persons/m/s). Predicted
forward by extrapolating current flow against the event schedule.

**Stampede risk alert.** Threshold-crossing forecast: given current density and flow
derivative, the time until LoS F is reached. The alert states that **lead time
explicitly** — "LoS F predicted at Gate 3 in 14 minutes" — because BoQ-3 F12 requires
"sufficient lead time ahead of a defined threshold breach", and an alert without a
lead-time figure does not satisfy it.

**Evacuation** (BoQ-3 F13). Over the building twin's floor plates: occupancy per floor,
exit and stair capacity, lift availability, and a queueing model producing predicted
clearance time and the bottleneck floors. Used in the high-rise scenarios.

---

## 4 · The advisory engine

`engines/advisory.js` — Pillar 5's action engine, and the thing that makes this a
platform rather than a dashboard. It consumes every other engine and emits advisories
into the lifecycle in
[03 §3.3](03-DOMAIN-MODEL.md#33-advisory).

### 4.1 Detectors

Each detector states its trigger, severity, target agency and SLA. All are configurable
in Admin.

| Detector | Trigger | Severity | Routed to |
|---|---|---|---|
| Coverage gap | Optimal − current expected coverage > 8 pp for > 20 min | warning | DCAS duty officer |
| Demand surge | Forecast exceeds the 95th percentile of the same hour-of-week | alert | DCAS duty officer |
| Acknowledge drift | Zone/shift acknowledge p50 exceeds the 30-day baseline by > 20 s, sustained | warning | Station commander |
| Turnout drift | Same, on chute time | warning | Station commander |
| Response breach | Zone p90 above target for 3 consecutive days | warning | Zone commander |
| Pre-empt shortfall | Grant rate below threshold, or measured saving near zero on a corridor | alert | RTA |
| Equity flag | `equity` engine flags a zone after controlling for distance | warning | Service lead |
| Anomaly | `anomaly` sustained flag | alert or warning by magnitude | Category owner |
| Crowd risk | Predicted LoS F within the lead-time horizon | **emergency** | Event command + all agencies |
| Risk-terrain shift | A cell's risk score moves > 1.5 σ between periods | info | Planning |
| SLA breach | An agency misses its notification SLA on an incident | alert | That agency |
| Data quality | A source drops below its quality threshold | info | Data owner |
| Hospital load | ED occupancy above threshold with inbound cases | alert | DHA coordinator |
| Multi-agency correlation | An incident correlates with a hazard requiring another agency | by incident priority | Correlated agencies |

### 4.2 The Concept Note's worked example, reproduced

The Concept Note cites a specific finding from the UP-112 exercise:

> *"the platform identified that 5,960 pre-empt events — 4.32% of the total — were
> affecting average response time by 27 seconds, and issued a dispatch, acknowledge
> and en-route procedural advisory to close the gap."*

The **pre-empt shortfall** detector reproduces exactly this shape of finding over the
seeded Dubai history: a count, a percentage of total, a measured effect on average
response time in seconds, and a routed procedural advisory naming the stages involved.
The numbers will be Dubai's, not Uttar Pradesh's, but the analysis is the same analysis
— and it is computed, not hard-coded.

### 4.3 Suppression and fatigue

An advisory hub nobody reads is worse than no advisory hub. Therefore:

- **Deduplication** — an open advisory of the same detector, category and zone is
  updated, not duplicated.
- **Cooldown** — per detector, per zone, configurable; default 6 hours.
- **Auto-close** — when the condition clears and stays clear for the verify window, the
  advisory closes itself with the measured value recorded.
- **Volume cap** — no more than N advisories per severity per hour reach the hub;
  overflow is aggregated into one "N similar findings" advisory.
- **Dismissal requires a reason**, and dismissal patterns are themselves monitored: a
  detector dismissed repeatedly is surfaced to the admin as a tuning candidate.

---

## 5 · The assistant seam

`server/lib/llm.js`. Optional. Never throws. Never required.

**Order of resolution for `/api/assistant/ask`:**

1. **Rules first.** A rules table maps recognised intents to a real query against the
   engines — "what is the response time in Al Barsha this week", "which zones are
   below target", "why was AMB-14 sent to INC-260916-0417", "how many cardiac arrests
   last month". These answer from data, exactly and citably, with no model involved.
2. **LLM second**, only if a provider is configured and the rules did not match. The
   model is given the question plus **retrieved engine results**, never raw database
   access, and is instructed to answer only from the supplied context and to say when
   it cannot.
3. **Neither.** A clear "I don't have that" with suggestions of what can be asked.

Every answer states which path produced it. A rules answer is labelled as computed; a
model answer is labelled as generated and carries the engine results it was given.

**Providers:** Groq, Gemini, OpenRouter, Ollama (local — the sovereign option), and
Anthropic. Selected by `LLM_PROVIDER`. Absent configuration changes nothing about the
rest of the product, which is the entire design requirement: the Concept Note promises
deployment with *"no external model calls"*, and that promise must be literally true
when the key is absent.

---

## 6 · Testing

Every engine gets unit tests with fixed inputs and asserted outputs. This is not
optional for this layer — an engine whose output nobody has pinned down will drift, and
a drifting advisory engine erodes trust faster than no advisory engine.

| Test class | What it asserts |
|---|---|
| Golden fixtures | Known input → exact expected output, per engine |
| Envelope conformance | Every engine returns a valid `EngineResult`; `factors` is non-empty where the UI requires it |
| Degenerate input | Empty, single-row, all-identical, extreme outlier — returns a caveat, never a crash and never a fabricated confidence |
| Determinism | Same input twice → identical output (no `Date.now()`, no unseeded random) |
| Calibration | `eta` and `demand` back-tested on a held-out slice of the seeded history, with the error reported in the test output so regressions are visible |
| Performance | Each engine inside its budget on the full seeded dataset: `coverage` < 400 ms, `risk` full rebuild < 20 s, everything else < 200 ms |
