# 09 · Data & seed

`npm run seed` builds the entire database from nothing. It is idempotent,
re-runnable, deterministic (fixed RNG seed) and it is a **first-class deliverable**,
not a throwaway script — every analytics, ranking and forecasting screen in the product
is only as credible as what this produces.

---

## 1 · Provenance — what is real and what is synthesised

This distinction is recorded here and surfaced in the product, because a tender
evaluator will ask, and because the honest answer is a better answer.

| Data | Provenance | In the UI |
|---|---|---|
| Zone boundaries, names | Dubai Municipality community boundaries (public) | Real |
| Hospital names, locations, broad capability | Public information | Real, with capacity synthesised |
| Ambulance / police / Civil Defence station locations | Approximated from public information | **Approximated** |
| Makani codes | **Synthesised** in the correct 10-digit format with correct entrance semantics. Not licensed Makani data. | "Simulated source" chip |
| Road network, basemap | OpenStreetMap via CARTO | Real |
| Historical incidents (24 months) | **Fully synthetic**, calibrated to published aggregate statistics | "Simulated data" chip on every analytics screen |
| Published aggregate targets used for calibration | DCAS and UAE media office statements | Real, cited below |
| Clinical records (NABIDH responses) | **Fully synthetic**, FHIR R4-shaped | "Simulated source" chip |
| Telemetry waveforms | **Synthesised** from published rhythm morphologies | "Simulated source" chip |

**The rule: no screen in the product presents synthetic data as real.** A permanent,
unobtrusive chip on any panel fed by synthesised data. This costs nothing and it is the
difference between a credible PoC and a misleading one.

---

## 2 · Calibration targets — RESOLVED against DCAS open data

> **Updated 16 Sep 2026** after the Gemini research in
> `Research Documents/new research/DCAS Operational Data Research.md`. The discrepancy
> flagged in the first draft of this plan is now settled, and the resolution changes the
> seed substantially.

### 2.1 The discrepancy, resolved

The figures in `DCAS Ambulance PoC Research.md` — 110,543 / 114,905 / 126,023 calls at
6.20 / 6.18 / **10.28** minutes, presented as **2024 / 2025 / 2026 projections** — are
**historical DCAS figures for 2017 / 2018 / 2020**, misattributed. The 10.28-minute
figure is the COVID-19 artefact of 2020 (PPE donning, decontamination between
transports, hospital handover delays), not a forecast of service degradation.

The 235,394 figure is a different unit of measure entirely. The 2023 ontology:

| Metric | 2023 value | What it counts |
|---|---|---|
| Total reports/calls received | 205,200 | Everything entering dispatch, including false and non-emergency |
| **Total emergency calls** | **169,556** | Valid emergency incidents requiring a kinetic dispatch — **this is the fleet-utilisation baseline** |
| Total transportation cases | 96,463 | Patient physically transported |
| — emergency transports | 69,647 | |
| — non-emergency transports | 26,816 | Scheduled transfers, dialysis, step-down |
| Total individuals cared for | 235,394 | All patient contacts including event standby (42 events, 5,000 hours) |

**The seed's incident generator uses the emergency-call series.** The 235,394 figure is
used only for clinical-workload framing, never for dispatch volume.

### 2.2 The authoritative series (ambulance.gov.ae open data)

| Year | Emergency calls | Avg response (min) | Patient cases | Male % |
|---|---|---|---|---|
| 2017 | 110,543 | 6.20 | 115,160 | 63.8% |
| 2018 | 114,905 | 6.18 | 119,336 | 64.1% |
| 2019 | 122,595 | 7.29 | 127,166 | 64.5% |
| 2020 | 126,023 | **10.28** ← COVID | 131,383 | 68.5% |
| 2021 | 136,973 | 9.51 | 141,658 | 62.9% |
| 2022 | 157,181 | 8.55 | 163,744 | 62.6% |
| 2023 | 169,556 | 7.49 | 179,767 | 63.8% |
| **2024** | **198,540** | **6.59** | 208,889 | 64.0% |

**The seed's 24-month window is Oct 2024 → Sep 2026**, extrapolating the 2024 baseline
forward at the observed growth rate with response time continuing to improve toward the
2033 target. That means roughly **420,000 incidents**, not the 230,000 in the first draft.

### 2.3 Derived calibration parameters

| Parameter | Value | Source / note |
|---|---|---|
| Patient contacts per dispatch | **1.04–1.06** | Derived from calls vs patient cases; 4–6% of dispatches are multi-casualty |
| Male patient share | **62.6–68.5%**, use 64% | Reflects the expatriate workforce demographic |
| Mean response, current | **6.59 min** | 2024 actual |
| **Median response (OHCA)** | **≈ 9.0 min** | PAROS / GCC systematic review |
| Response distribution | **Log-normal**, not normal | Mean 6.59 with median ≈9.0 implies strong right skew; rapid urban first-responder arrivals pull the mean below the median-of-critical-calls |
| OHCA mean EMS response | **15.75 ± 8.55 min** | Dubai single-centre study — OHCA responses are materially slower than the fleet average, and the seed must reproduce that |
| Bystander CPR rate | **22.92%** (Dubai single-centre); 12.0% (Al-Hajeri regional); range 5.1–30% across studies | Use 23% for Dubai urban |
| Bystanders present at OHCA | **75%** | |
| Bystander AED use | **< 3%** | GCC-wide |
| ROSC rate | **12.6%** | Al-Hajeri |
| Survival where bystander CPR given | **17.6%** | vs far lower without |
| GCC survival to discharge | Bahrain 1.2% · Saudi 2.9% · Qatar 8.1% | Dubai-specific figure not established |
| OHCA saves, 2023 | **90**, +21% YoY | DCAS |
| Rashid Hospital door-to-needle | **64.14 min** mean | The improvement target for SC-04 |
| UAE road fatalities, 2022 | 343 (3.4 per 100,000) | −74% 2011→2025 |
| Dubai Police response, 2025 | **5.8 min** (target 6.6) | For the multi-agency SLA comparison |
| Heat-illness threshold | Rises > 40 °C, spikes near 50 °C | MOHRE bans open-air work 12:30–15:00, 15 Jun – 15 Sep — a hard seasonal signal for the seed |

### 2.4 Case mix — no published DCAS breakdown exists

The research could not establish a published percentage breakdown of DCAS call types.
The seed therefore uses a **proxy distribution from comparable Gulf urban EMS**, and
this is labelled as a proxy in the product:

| Band | Share | Note |
|---|---|---|
| RTC and trauma | 15–20% | |
| Cardiac and respiratory | 25–30% | |
| General medical / lower acuity | remainder | |

The detailed kind-level mix in §4.2 sits inside these bands. When the
`dcas_activity-open` schema is obtained, this is the first thing to replace.

### 2.5 Open data status

| Source | Status |
|---|---|
| `ambulance.gov.ae/OpenData/EmergencyCallsStatistics` | **Annual aggregates only**, all regions combined, embedded in HTML — no CSV, no API. Scraping required. No spatial granularity. |
| `dubaipulse.gov.ae` `dcas_activity-open` | Dataset exists at a known URL; **schema, granularity, coverage and licence unverified** — needs portal authentication. Assume pre-aggregated until proven otherwise. |
| Community/sector boundary geometry | **Restricted.** Indexed on Dubai Pulse but raw GeoJSON/Shapefile downloads are not unconditionally public. Fall back to OSM-derived boundaries. |
| AED registry, station GIS, live traffic volumes | **Restricted** for operational security. |

---

## 3 · Reference geography

### 3.1 Zone hierarchy

Dubai is officially divided into **nine sectors**, subdivided into **communities** — the
standard locality level used for planning, statistics and dispatch zoning. (Corrected
from ten in the first draft.)

```
Emirate of Dubai                                   Z-E1
├── Sector 1 · Deira                               Z-S01
├── Sector 2 · Bur Dubai                           Z-S02
├── Sector 3 · Jumeirah & Coastal                  Z-S03
├── Sector 4 · Marina, JLT & Palm                  Z-S04
├── Sector 5 · Downtown & Business Bay             Z-S05
├── Sector 6 · Al Quoz & Industrial                Z-S06
├── Sector 7 · Mirdif, Al Warqa & Eastern          Z-S07
├── Sector 8 · Jebel Ali, DIP & Southern           Z-S08
└── Sector 9 · Nad Al Sheba, Al Khawaneej & Hatta  Z-S09
       └── communities (≈40 modelled of Dubai's ~226)
              └── beats (3–8 per community)
```

⚠ **Boundary geometry is restricted.** Dubai Pulse indexes "Community", "Sectors" and
"Entrances" datasets, but raw GeoJSON/Shapefile download requires governmental API
clearance. The seed therefore builds boundaries from **OSM-derived land-use traces**,
which are approximate at the edges and exact enough for zone-level analytics. This is
recorded on the Analytics screens as an approximated source.

### 3.1a Population and the diurnal shift

| Figure | Value |
|---|---|
| Resident population (end 2025 / 2026) | **4.58 million** |
| **Daytime** population | **6.392 million** |
| Daily influx | **1.812 million** — commuters from Sharjah/Ajman, tourists, transient business |

This 1.8-million-person daily swing is the largest single driver of spatial demand
variation in Dubai and the seed models it explicitly: between **08:00 and 18:00** demand
probability shifts toward commercial corridors (Downtown, Business Bay, DIFC); between
**19:00 and 06:00** it retracts to dense residential high-rise clusters. Zones carry both
`population` (resident) and `population_daytime`, and `demand` weights by the
time-appropriate one rather than by a single static figure.

Each zone carries its class — `urban`, `suburban`, `industrial`, `freezone`, `coastal`,
`desert` — which drives separate baselines in `demand`, `risk` and `ranking`. Ranking a
desert periphery zone against Downtown on raw response time would be meaningless, and
the class is how that is avoided.

**Communities modelled** (the ones the scenarios and demo need to be real):
Dubai Marina, JLT, Palm Jumeirah, Downtown Dubai, Business Bay, DIFC, Deira, Al Ras,
Bur Dubai, Al Karama, Oud Metha, Jumeirah 1–3, Umm Suqeim, Al Safa, Al Wasl,
Al Barsha 1–3, Al Quoz 1–4, Al Sufouh, Dubai Internet City, Dubai Media City,
Dubai Silicon Oasis, Academic City, Mirdif, Al Warqa, Al Qusais, Al Nahda,
Muhaisnah, International City, Discovery Gardens, Jebel Ali, Dubai Investments Park,
Dubai South, Nad Al Sheba, Al Khawaneej, Hatta.

### 3.2 Facilities

| Kind | Count | Notes |
|---|---|---|
| **DCAS ambulance points** | **133** | **68 primary ground stations** (2022) + 12 added in 2023 + standby points, kiosks and co-located fire/police integrations. HQ in Warsan Third. These 133 nodes are the fixed origins for all routing. |
| Police stations — **manned** | ~9 named | Al Barsha, Jebel Ali, Naif, Al Qusais, Rashidiya, Al Raffa, Muraqqabat, Bur Dubai, Al Khawaneej |
| Police — **Smart Police Stations** | **33** | **Unmanned.** Flagged `dispatchable = false`; the dispatch engine must exclude them or it will route an incident to a kiosk. |
| Civil Defence stations | ~20 | Named: Al Quoz, Al Barsha, Palm Jumeirah, Al Karama, Nad Al Sheba, Emirates Martyrs (Sheikh Zayed Rd), Al Rashidiya, + the world's first **floating fire station** for coastal/island response |
| Coastguard | 4 | Coastal only; marine routing network |
| Hospitals with a 24-hour ED | **11 verified** (see below) | |
| AED public access points | ~180 modelled | ⚠ The real registry is **restricted** — see the note below |

**Hospital set — corrected against the research.** The first draft of this plan listed
several facilities that the research did not verify as operating a 24-hour ED. This is
the verified set:

| Hospital | Area | Class | Capabilities modelled |
|---|---|---|---|
| **Rashid Hospital** | Oud Metha | Public | **trauma L1 (regional apex)**, stroke (Dubai's first stroke unit, 2011), cath lab, neurosurgery, extensive ICU, toxicology |
| **Al Jalila Children's** | Al Jaddaf | Public | **paediatric**, paediatric burns |
| **Jebel Ali Hospital** | Jebel Ali | Public | trauma, critical care, imaging |
| **Fakeeh University Hospital** | **Dubai Silicon Oasis** | Private | 350 beds, 35 adult ICU, 10 paed ICU, trauma, **hyperbaric (HBOT)**, obstetric |
| **Saudi German Hospital** | Al Barsha / Hessa St | Private | major trauma, **hyperbaric (HBOT)** |
| **King's College Hospital** | Dubai Hills Estate | Private | trauma, **cardiac** |
| **Clemenceau Medical Center** | Dubai Healthcare City | Private | **stroke**, cardiac chest-pain pathway, **burns** |
| **International Modern Hospital** | Port Rashid / Mankhool | Private | trauma, cardiac, **stroke** |
| **Trellis Hospital** | Al Qusais | Private | major trauma, complex fractures, **burns** |
| **Aster Hospital** ×3 | Mankhool, Muhaisnah, Jebel Ali | Private | general ED, heatstroke, cardiac arrest |
| **HMS Mirdif Hospital** | Mirdif | Private | urgent care, **hyperbaric (HBOT)** |

**Three capabilities create genuine routing overrides** — and these are what make
`hospital` more than a nearest-facility lookup:

- **Hyperbaric (HBOT)** — only Fakeeh, Saudi German, HMS Mirdif. Carbon-monoxide
  poisoning from a high-rise fire, decompression sickness from offshore diving, or
  specific crush trauma must bypass closer facilities.
- **Burns** — only Clemenceau, Trellis, Al Jalila (paediatric).
- **Paediatric** — Al Jalila is the designated centre.

⚠ **AED registry is restricted, and the real one is smarter than a list.** DCAS operates
an **IoT-connected** PAD network using telemetry-enabled devices (Lifepak CR2): opening
the cabinet transmits to the control room, **auto-generating a high-acuity incident** at
those coordinates and alerting nearby responders. Coordinate-level registries are not
public (property security and anti-tampering). The seed models ~180 plausible locations
**with the telemetry behaviour implemented** — an AED cabinet opening is a valid incident
source in this platform, because that is how the real one works.

### 3.3 Fleet

| Kind | Count | Capability |
|---|---|---|
| ALS ambulance | 34 | Advanced life support |
| BLS ambulance | 18 | Basic life support |
| MICU | 4 | Mobile intensive care, neonatal/bariatric |
| MRU (motorcycle) | 12 | Rapid response, congestion-immune — the mega-event asset |
| MCU | 3 | Mass casualty |
| Supervisor | 6 | |
| Police PRV | 40 | |
| Fire / rescue | 22 | |
| Marine | 4 | |

≈60 DCAS units, which matches the engine performance budgets in
[08 §6](08-INTELLIGENCE-ENGINES.md#6--testing).

### 3.4 Makani points

~4,000 synthesised points in the correct format: 10 digits, displayed as two groups of
five, one per building entrance, with entrance number and role (`main`, `service`,
`emergency`, `parking`, `lobby-b`). Dense in the scenario neighbourhoods — Marina,
Downtown, DSO, Business Bay — sparse elsewhere.

**Multi-entrance buildings are the point.** Marina Pinnacle, Burj Khalifa, Dubai Mall,
Emirates Towers and the DSO towers each get their real entrance count, so "entrance 4 of
11" is a genuine navigation problem in the demo rather than a slogan.

---

## 4 · Synthetic history — 24 months

`server/db/seed/history.js`. ~230,000 incidents across 24 months, calibrated per §2.

### 4.1 Generation model

Incidents are generated from an inhomogeneous Poisson process whose intensity is the
product of:

1. **Zone base rate** ∝ population × class multiplier. Industrial zones get more trauma
   and fewer medical; residential more cardiac and falls; freezones more workplace
   injury.
2. **Diurnal curve** — bimodal, peaking 08:00–10:00 and 17:00–21:00, trough 03:00–05:00.
3. **Weekly curve** — Friday and Saturday differ from the working week; Dubai's weekend
   shape, not a Western one.
4. **Seasonal curve** — a summer heat peak (heat exhaustion, cardiac), a winter road
   peak (fog collisions, which are a real Dubai pattern).
5. **Event calendar** — NYE, Ramadan and Eid, Dubai Shopping Festival, GITEX, the World
   Cup of whatever is on, concerts, marathons. Each with a footfall figure and a
   demand multiplier.
6. **Weather series** — 24 months of daily temperature, humidity, wind, visibility and
   rain, shaped to Dubai's climate, **including the April 2024 extreme rainfall event**
   (see [10-SCENARIOS](10-SCENARIOS.md)).

### 4.2 Incident kind mix

Shaped to published pre-hospital case-mix patterns:

| Kind | Share | Priority skew |
|---|---|---|
| Medical — general | 26% | P2/P3 |
| Trauma — falls | 14% | P2/P3 |
| Road traffic collision | 13% | P1/P2 |
| Cardiac (incl. arrest) | 9% | P1 |
| Respiratory | 8% | P1/P2 |
| Neurological (incl. stroke) | 6% | P1 |
| Heat-related | 5% | P2, heavily summer-weighted |
| Workplace injury | 5% | P2, industrial/freezone-weighted |
| Obstetric | 3% | P1/P2 |
| Psychiatric / behavioural | 3% | P3 |
| Drowning / water | 2% | P1, coastal/summer-weighted |
| Fire-related | 2% | P1 |
| Paediatric-specific | 2% | P1/P2 |
| Other / non-emergency | 2% | P4 |

### 4.3 Response generation — the part that must be right

For each incident, the seed **simulates the actual dispatch** rather than sampling a
response time from a distribution. This matters: it means the seven stage timestamps
are internally consistent, the fleet is genuinely busy when it should be, and the
analytics are measuring something real rather than reproducing the distribution they
were handed.

1. Fleet state is carried forward through the timeline — a unit on a job is not
   available for the next one.
2. `dispatch` selects the unit using the same engine the live product uses.
3. Stage durations are sampled from log-normal distributions parameterised per stage,
   zone class and hour band, then **the whole set is scaled** so the aggregate lands on
   the calibration target.
4. Travel time comes from a road-network distance estimate times a congestion factor
   for the hour and corridor. Sheikh Zayed Road at 18:00 is slow in the seed because it
   is slow in reality.
5. Degradation events are injected at realistic rates: declines, timeouts, reassignments,
   cancellations, no-patient-found, duplicate calls. **Without these the analytics are
   too clean to be believable** and the advisory engine has nothing to find.
6. A residual is applied so that some zones genuinely underperform — because a ranking
   table where every zone is equal demonstrates nothing, and the advisory engine must
   have real findings to surface.

### 4.4 Deliberately planted findings

The advisory engine must find real things in the seed. These are planted as *patterns*,
not as hard-coded advisories — the engine discovers them by the same analysis it would
run on real data.

| Planted pattern | What the engine should find |
|---|---|
| Al Quoz acknowledge time drifts +45 s after the 07:00 shift change over the last 6 weeks | `acknowledge drift` advisory, shift-changeover as the dominant factor |
| A Sheikh Zayed Road corridor has a low preempt grant rate and near-zero measured saving | `pre-empt shortfall` advisory routed to RTA, in the shape of the Concept Note's 5,960-event example |
| Two outer communities have p90 above target after controlling for station distance | `equity` advisory — process, not geography |
| Coverage in Sector 9 degrades every weekday 16:00–19:00 | `coverage gap` advisory with a concrete relocation plan |
| Summer heat-related calls rise sharply above 42 °C | `demand surge` advisory tied to a weather covariate |
| One data source's timeliness degrades in month 20 | `data quality` advisory |
| Vertical access time in Marina high-rises exceeds the emirate median by 90 s | Surfaced in the stage decomposition as a distinct `vertical access` term |

### 4.5 Volume and runtime budget

| Table | Rows | Note |
|---|---|---|
| `incidents` | ~230,000 | |
| `assignments` | ~290,000 | Some incidents take multiple units |
| `incident_timeline` | ~1.8 M | Batch-inserted via `COPY` |
| `unit_positions` | ~600,000 | Seed writes routes only for the trailing 60 days |
| `agency_notifications` | ~140,000 | Multi-agency incidents only |
| `patients` | ~200,000 | |
| `telemetry` | ~300,000 | Trailing 90 days only |
| `demand_forecast` | ~180,000 | Hourly × zone × trailing period |
| `risk_cells` | ~30,000 | Cells × 6 hour-of-week bands |
| `advisories` | ~400 | Historical, mostly closed |

**Target: under 5 minutes on the demo machine.** Achieved with `COPY FROM STDIN` for
the bulk tables, indexes created *after* load, and `ANALYZE` at the end. A seed that
takes half an hour will not be re-run, and a seed that is not re-run rots.

### 4.6 Commands

```bash
npm run seed              # full rebuild: schema, reference, history, derived
npm run seed:reference    # zones, facilities, fleet, Makani only — fast
npm run seed:history      # regenerate the 24 months
npm run seed:derived      # recompute forecasts, risk cells, rankings, KPI snapshots
npm run seed:reset        # drop everything a scenario created, restore resting state
npm run seed:verify       # assert the calibration targets are met, print the report
```

`seed:verify` is the honesty check. It prints the achieved aggregates against §2's
targets and **fails** if the mean response time is outside ±10 s of target or the case
mix is outside ±1 pp. A seed that silently drifts away from its calibration produces
analytics that look authoritative and are not.

---

## 5 · Live-data readiness

The seed is a stand-in. The path to real data is designed for, not deferred:

| Source | Path |
|---|---|
| DCAS historical dispatch | CSV/Parquet import into the same schema via `server/db/import/`. The column mapping is configuration. |
| Live CAD | The `cad` integration seam — webhook or poll |
| Dubai Pulse open data | `dcas_activity-open` and related datasets — the first thing to ingest for a real baseline |
| Makani | Swap the mock for the Search API v2 client; `makani_points` becomes a cache |
| NABIDH | Swap the mock FHIR service for the DHA endpoint; the payload shape does not change |
| Weather | A live provider behind the same interface the seeded series implements |

When real data lands, `is_seed = true` rows are excluded rather than deleted, so a
before/after comparison is possible and the demo still works.
