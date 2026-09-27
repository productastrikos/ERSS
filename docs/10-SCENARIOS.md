# 10 · Scenarios

Ten scripted, deterministic runs. Each executes against the scenario clock, drives both
the console and a phone, and produces an after-action report at the end.

Scripts live in `server/sim/scripts/`. A script is a timed list of events with
conditions — it does not fake the product's behaviour. When the script says "the citizen
presses SOS", the citizen app really posts to `/api/sos`, the real `dispatch` engine
really runs, the real `preempt` engine really opens a corridor. The script provides the
stimulus; the product provides the response.

---

## Framing and sensitivity

Several scenarios below are grounded in real, published UAE incidents, some involving
deaths. You asked for exactly this — real events that would have gone better with this
platform — and it is the right instinct: after-action grounding is standard practice in
emergency medicine, and a scenario invented from nothing is a scenario an EMS
professional will dismiss in thirty seconds.

**Three rules govern how that grounding is used.** They protect the people involved and,
practically, they protect the pitch.

1. **Published statistics and systemic findings are cited by name.** Dubai's 3% OHCA
   survival rate, the 10.5% bystander-CPR rate, the documented signal delays, the
   ≈7-minute average response — these are public, systemic, and citing them is the
   strongest argument the product has.
2. **Specific fatal incidents inform the scenario design but are not named in the
   running demo.** The scenario is set at a fictional location with fictional people,
   built to the same operational shape. The real incident is recorded *here*, in the
   design documentation, as the provenance of the scenario's parameters.
3. **No scenario claims a named person would have survived.** That claim cannot be
   supported, it is disrespectful to the families, and — in front of an authority that
   handled the real incident — it reads as a vendor second-guessing professionals who
   were there. What the product may claim is what it can measure: *this platform
   removes this many minutes from this stage of this workflow*. That is a stronger
   claim because it is defensible.

Where a real incident was handled **well**, it can be named and used as a benchmark to
match. The Marina Pinnacle evacuation — 3,820 residents out of a 67-storey tower with
zero injuries — is a success story, and SC-07 is explicitly framed as "the platform's
job is to make this the reliable outcome, not the exceptional one."

---

## The opening sequence — what starting the simulation always shows

Two camera detections, built and running (`server/sim/scripts/`). They are **not a
separate control**: there is one simulation button in the product, and starting it runs
these in order before ordinary call traffic takes over. A scenario picker would invite
the question "so which one is the real system?", and the answer has to be "all of it,
there is only one".

Both run through `engines/detection.js`, which creates their incidents through
`services/incidents.create` exactly as a 998 call-taker would. What marks them out
downstream is `source = 'sensor'` and a `reported_at` stamped when the camera saw it
rather than when somebody dialled — so the lead time is measurable afterwards instead of
being a claim on a slide.

### SC-RW-01 · Collision at DSO Central Roundabout

**Fires** ~3 s after the simulation starts · **Cameras** `RTA-CAM-101A`, `RTA-CAM-101B`

Speed sensors see 48 km/h fall to zero in 1.2 s, density analytics see eighteen vehicles
standing in 50 m², and both junction cameras see a stationary object in a live lane.
Nobody has called. The detection creates a P1 `rta` with two patients; SOP `rta_junction`
locks the junction red, holds the side approaches and opens the diversion, and the map's
transport layer shows the signal plan the panel describes.

### SC-RW-02 · Collapse in a restricted server room, The NEST floor 3

**Fires** ~95 s after the start, once the collision is dispatched and moving ·
**Cameras** `NEST-F3-CAM-07`, `NEST-F3-CAM-08`

A lone technician collapses between the racks. The room is badge-restricted, he is the
only person on the wing, and the corridor camera shows nobody walking past for ninety
seconds. **There is no bystander, so under the old workflow there is no call** — the
response clock does not start until somebody eventually finds him.

The detection creates a P1 `cardiac_arrest` on floor 3 with the room in `unit_no` and the
access chain in `access_note`. SOP `indoor_person_down` alerts building security, requests
the badge-door release, holds service lift 2 at ground, and pushes the indoor route to the
crew. Five of its eight steps are done by the platform before an operator reads them.

**What it proves, and does not.** Not that the patient survives — that claim cannot be
supported. What it shows is arithmetic: the incident exists from the moment of collapse
rather than from the moment of discovery, and the access steps that would otherwise be
phone calls are already done when the crew arrives.

**Setting.** The NEST is the DSO twin's own three-storey tech office, with its floors and
rooms unchanged, so the building the console draws and the address the crew is given
agree. The technician is fictional.

**Media.** Two clips per scenario, both angles of one incident — see
`web/public/media/README.md`. A missing clip shows `NO SIGNAL`, never a black rectangle.

---

## Tier 1 — must ship, fully working

### SC-01 · Vertical city cardiac arrest

**Duration** 12 min · **Surfaces** console + citizen phone + responder phone
**Pillars** 3, 5, 1, 6

**Grounding.** Dubai OHCA survival to discharge ≈ 3%; bystander CPR performed in 10.5%
of cases; bystanders present in ~75%. The gap between "someone was there" and "someone
acted" is the scenario's subject.

**Setting.** A fictional 78-storey residential tower in Dubai Marina, floor 75.

| t | Event | What the product does |
|---|---|---|
| 00:00 | Family member presses SOS on the citizen app | Location captured, nearest Makani entrance resolved, medical profile attached, P1 created from `app_sos` |
| 00:08 | | `dispatch` ranks units; recommendation and full rationale on the dispatcher's panel |
| 00:22 | Dispatcher approves | Assignment created, offer pushed to AMB-14's phone, `preempt` opens the corridor, Civil Defence notified for lift control |
| 00:31 | Responder accepts | Acknowledge stage measured. Navigation to **entrance 1**, not the street |
| 00:35 | | Dispatcher-assisted CPR guidance opens on the citizen app — metronome at 110 bpm |
| 01:10–04:30 | En route | Green wave along the route, signals held; the console shows the corridor and each grant |
| 04:38 | On scene | Server-stamped. **Vertical access timer starts as a separate stage** |
| 06:02 | At patient, floor 75 | The 84-second lobby-to-patient time is recorded as its own measured stage |
| 06:20 | Emirates ID scanned | NABIDH mock returns allergies, conditions, medications. Anticoagulant flagged in `--app-danger` |
| 06:40 | Monitor attached | Telemetry streams: VF rhythm, live to the console and the receiving hospital |
| 08:15 | ROSC | Rhythm changes in the stream |
| 08:30 | Destination | `hospital` ranks by cath lab + ED load + transport time, with reasoning. Pre-alert sent |
| 08:52 | Hospital acknowledges | Pre-arrival activation clock stops |
| 09:30–11:30 | Transport | Continuous telemetry, ETA to hospital |
| 12:00 | Handover, incident closed | After-action report generated |

**What it proves.** Citizen-to-crew in one unbroken chain; Makani entrance-level
navigation; green-wave preemption measured; vertical access made visible as its own
problem; NABIDH clinical continuity; pre-arrival activation; every stage measured.

**The closing number.** The AAR compares this run's stage times against the seeded
baseline for the same zone and hour, and states the minutes recovered and where.

---

### SC-02 · Multi-agency collision, Sheikh Zayed Road

**Duration** 15 min · **Surfaces** console (role-switched) + two responder phones
**Pillars** 1, 5, 6

**Grounding.** A multi-vehicle collision on the emirate's primary arterial. The
Concept Note's headline exercise figure is "5 departments on one shared view"; this is
the scenario that demonstrates it. Systemic grounding: published reporting on ambulances
obstructed in traffic and the Dh1,000 penalty for failing to give way.

| t | Event | What the product does |
|---|---|---|
| 00:00 | Multiple 999 and 998 calls | Duplicate detection merges them into one incident with three reporting sources |
| 00:14 | | `correlation` runs: wind direction from the Environment feed (fuel spill), population within radius, the nearest school, RTA camera coverage. Five agencies identified |
| 00:20 | | **Simultaneous notification** to Police, DCAS, Civil Defence, RTA and DHA. The elapsed time from detection to last alert is displayed, and it is the sub-minute claim being proved |
| 00:35 | Multi-unit dispatch | 2 ALS, 1 MRU, 2 PRV, 1 rescue. Each with its own rationale |
| 01:00 | | RTA feed: lane closure applied, upstream signals retimed, CCTV from the nearest camera opens in the incident panel |
| 01:30–05:00 | Units arrive in sequence | Per-agency SLA timers run live; met/not-met shown with labels |
| 03:00 | **Role switch** on the console | The demo operator switches from `dispatcher` to `police_command` to `crisis_centre`. Same incident, same live data, different scope and different actions |
| 05:30 | Triage | Three patients tagged; `hospital` distributes across two receiving facilities to avoid overloading one ED |
| 08:00 | Shared notes | Each agency posts to the thread, attributed |
| 12:00 | Cleared | |
| 15:00 | AAR | Per-agency response timeline, SLA compliance, **route taken versus route proposed** with the minutes difference, notification ledger |

**What it proves.** One incident, one object, five agencies. Sub-minute multi-agency
notification, measured. Per-department SLA timers. Contextual correlation. The
route-comparison view the Concept Note leads with.

---

### SC-03 · Mega-event predictive staging

**Duration** 20 min (compressed from an 8-hour horizon) · **Pillars** 3, 5, 6

**Grounding.** New Year's Eve in Downtown Dubai. Precedent for the analytical approach:
the Astrikos deployment at the Maha Kumbh, cited in the Concept Note and the DCAS
research.

**Phase 1 — planning, T−6 h (the dashboard in Event mode)**
- Forecast footfall by zone and hour from the event calendar
- `crowd` identifies choke points at gates, the metro exit and the boulevard narrows
- `demand` forecasts medical demand: heat exhaustion, cardiac, crush injury, falls
- `coverage` computes the optimal staging plan — 4 MRU motorcycles and 2 ALS at named
  Makani points on the perimeter, with the expected coverage gain for each
- The advisory hub carries the plan; the duty officer clicks **Act**; units receive
  standby assignments on their phones **with the reason shown**

**Phase 2 — live, T−0**
- Crowd density surface updates; Gate 3 climbs through Fruin LoS D into E
- `crowd` issues an **emergency advisory with an explicit lead time**: "LoS F predicted
  at Gate 3 in 14 minutes." Recommended redirection attached
- Multi-agency notification; Police redirect flow; the surface recedes

**Phase 3 — the incident**
- A spectator collapses inside the perimeter, heat exhaustion
- The nearest MRU is 90 seconds away *because it was pre-positioned*, and the console
  shows the counterfactual: nearest unit without the staging plan was 7 min 40 s
- On scene, treated, transported

**Phase 4 — post-event analytics**
- Footfall against forecast, incidents by type and hour, response by zone, the staging
  plan's measured contribution, and the recommendations for next time

**What it proves.** Prediction ahead of demand. The action engine turning a forecast
into a standing crew's instruction. Crowd risk with lead time. The counterfactual, which
is the only way to show that a prevented problem was prevented.

---

## Tier 2 — ambulance-focused, ship working

These exist because you asked for depth on the ambulance service specifically.

### SC-04 · Stroke — the golden hour and the clinical handoff

**Duration** 14 min · **Pillars** 4, 1, 6

**Grounding, and it is strong.** Published evidence: EMS pre-notification shortens
door-to-imaging from 12 to 9 minutes and door-to-needle from 29 to 20 minutes. Aster
Dubai publishes a target of CT within 25 minutes and thrombolysis within 60. Every
minute of ischaemic stroke costs approximately 1.9 million neurons.

| t | Event | What the product does |
|---|---|---|
| 00:00 | 998 call, weakness on one side | Triage code assigned, P1, stroke pathway flagged |
| 00:30 | Dispatch | `hospital` filters to stroke-capable receiving centres **at dispatch time**, not at scene — because the destination decision changes the routing |
| 04:00 | On scene | FAST assessment on the responder app; **last-known-well time** captured, which is the single field that decides eligibility |
| 05:00 | Emirates ID | NABIDH returns anticoagulant use — the contraindication that changes the treatment plan |
| 06:00 | Destination | Ranked stroke centres with reasoning; nearest is not chosen because it is on diversion |
| 06:30 | **Pre-alert** | Stroke team activated while the ambulance is still moving. The hospital's acknowledgement is measured |
| 07:00–12:00 | Transport | Continuous vitals, ETA, and the **thrombolysis window counting down** on both the crew's phone and the hospital's inbound view |
| 13:00 | Arrival | The AAR states the modelled door-to-needle saved by pre-notification, citing the 29→20 minute evidence |

**What it proves.** The ambulance as a clinical node, not a vehicle. Capability-matched
destination selection. Pre-arrival activation measured end to end. A time-critical
clinical window made visible to everyone who can affect it.

---

### SC-05 · The signal trap — green wave, measured

**Duration** 10 min · **Pillars** 5, 1, and the RTA feed

**Grounding — and a correction that changes how this is pitched.**

- The delay is documented: a September 2018 Gulf News report from a resident describes
  ambulances approaching **Rashid Hospital** held at the Metro roundabout signal for
  **up to ten minutes**, observed over six-plus months.
- Dubai's signals are centrally controlled and modern: ~**620 signalised
  intersections** on RTA's **UTC-UX Fusion** (Yutraffic) platform with AI and
  digital-twin features, feeding DITSC and RTA's Enterprise Command & Control Centre
  (EC3). Not independent SCATS islands.
- ⚠ **But there is no public evidence that emergency vehicle preemption is actually
  deployed in Dubai.** A January 2020 media item described a national "smart ambulance"
  intention; no RTA or DCAS confirmation, no intersection count, no published API or
  dispatch-to-signal integration pathway exists. RTA's only public APIs concern fleet
  data.

**Therefore this scenario is framed as a proposal with an evidence base, never as a
description of something running.** The demo says: here is a documented delay, here is
what preemption would recover, here is the international evidence for the effect size,
and here is the measurement harness that would hold it to account. Claiming Dubai has
EVP today, in front of the RTA, would be a serious error.

International effect sizes used to bound the model, and cited on screen:

| Evidence | Effect |
|---|---|
| US signal preemption study | **14–23%** reduction in ambulance route time (~70 s over 3–6 signals) |
| Minnesota DOT | **10–16%** shorter EV travel time on long routes |
| St Paul, MN (long-term) | Intersection EV crashes **8.0 → 3.3 per year** (≈58% reduction) |

Penalty context for the multi-agency framing: failing to yield to an emergency vehicle
now carries **Dh3,000**, 6 black points and impoundment under the 2025 federal traffic
law (up from Dh500 in 2018).

**Structure — the scenario runs twice, side by side.**

**Run A, preemption off.** A P1 transport along a congested corridor. Every signal
encountered normally. The console shows the unit stopping at four intersections, and a
live counter accumulating seconds lost at each. Total transport time recorded.

**Run B, identical incident, preemption on.** `preempt` requests each signal ahead of
arrival. The corridor is drawn on the map; each grant is logged with its hold duration.
The unit passes without stopping.

**The comparison** is the deliverable: transport time A versus B, seconds saved per
intersection, grant rate, and the two runs' routes overlaid. Then the console opens
`v_preempt_impact` over the **seeded history** and shows the same analysis at scale —
the number of pre-empt events, the percentage of total, the measured effect on average
response time in seconds, and the procedural advisory routed to RTA. That is the shape
of the Concept Note's 5,960-event finding, computed on Dubai data.

**What it proves.** A specific, documented, systemic delay, quantified and closed —
with the saving measured rather than assumed. If the measured saving on a corridor is
small, the product says so, and that honesty is itself the demonstration.

---

### SC-06 · Mass casualty — coach collision

**Duration** 25 min · **Pillars** 1, 3, 5, 6

**Grounding.** On 6 June 2019 a coach travelling from Muscat struck an overhead height
barrier near Rashidiya at approximately 94 km/h; 17 people died and 13 were injured.
Per the framing rules above, the scenario is set at a fictional location with fictional
occupants, and uses that incident's **operational shape**: a sudden high-count MCI on a
fast road, mixed acuity, multiple nationalities and languages, and a receiving-capacity
problem across the city rather than at one hospital.

| t | Event | What the product does |
|---|---|---|
| 00:00 | First call; occupant count unknown | Incident opened; `patients_count` unknown is an explicit state, not a default of 1 |
| 00:20 | | MCI protocol triggers on the reported count. `advisory` escalates automatically to the emergency response package |
| 00:30 | | All agencies notified simultaneously; NCEMA escalation threshold evaluated against the National Response Framework and the result shown |
| 01:00 | | `coverage` recomputes emirate-wide: the fleet draw-down creates coverage gaps elsewhere, and the engine issues relocation advisories **for the rest of the city** — which is the failure mode of every real MCI and the one a single-incident view cannot see |
| 02:00–08:00 | Units arrive | MCU, 6 ALS, 4 BLS, 3 MRU, rescue, police |
| 04:00 | Triage | START/SALT tags on responder phones; the console's casualty board fills live: red/yellow/green/black counts |
| 06:00 | **Distribution** | `hospital` distributes casualties across six receiving facilities by capability and live ED capacity, rather than sending everyone to the nearest — the decision that determines MCI outcomes |
| 10:00 | Family reunification | Casualty board with identification state, for the information cell |
| 20:00 | Scene clear | |
| 25:00 | AAR | Full reconstruction: per-casualty timeline, per-hospital load, the coverage impact on the rest of Dubai and how long it lasted |

**What it proves.** MCI at scale. Casualty distribution across a hospital network.
Automatic escalation against a real national framework. And the point nothing else makes:
**a major incident degrades response everywhere else**, and this platform can see it
happening and act on it.

---

## Tier 3 — stretch, build if time allows

| Ref | Scenario | Grounding | Proves |
|---|---|---|---|
| **SC-07** | **High-rise fire** — tower evacuation | Marina Pinnacle, 13 June 2025: 67 storeys, 3,820 residents from 764 apartments, six hours, **zero injuries**. Named openly as a benchmark to match. | Civil Defence + BMS feed + evacuation modelling + the building twin. Medical standby scaled to evacuated population. Smoke plume against wind direction. |
| **SC-08** | **City-wide weather emergency** | April 2024 UAE record rainfall — a year's rain in 24 hours, ~142 mm in Dubai in a day, Sheikh Zayed Road lined with abandoned vehicles, 20+ deaths across the UAE and Oman. | Demand surge under a weather covariate; emirate-wide fleet repositioning; flooded-route avoidance; NCEMA escalation; the platform under genuine overload. The hardest and most valuable of the three. |
| **SC-09** | **Paediatric drowning** | Summer coastal pattern; 996 + 998 joint response. | Coastguard integration, nearest AED, dispatcher-assisted resuscitation, paediatric-capable destination (Latifa). |
| **SC-10** | **Remote rescue, Hatta** | Long-transport geography at the emirate's edge. | Location without an address, extended transport, rendezvous with a second unit, air ambulance decision, the limits of a coverage model at the periphery. |

---

## Script mechanics

### Structure

```js
export default {
  ref: 'SC-01',
  name: 'Vertical city cardiac arrest',
  tier: 1,
  durationSec: 720,
  grounding: {
    statistics: ['Dubai OHCA survival to discharge ≈3%',
                 'Bystander CPR performed in 10.5% of Dubai OHCA cases'],
    realIncident: null,          // none named in this scenario
    setting: 'fictional tower, Dubai Marina',
  },
  setup:  async (ctx) => { /* position the fleet, set weather, ED loads */ },
  events: [
    { at: 0,   do: 'citizen.sos',      with: { userRef: 'CIT-DEMO-1', kind: 'cardiac',
                                               makani: '2797 87586', floor: 75 } },
    { at: 22,  do: 'dispatcher.approveRecommendation', waitFor: 'recommendation.ready' },
    { at: 31,  do: 'responder.accept', with: { unitRef: 'AMB-14' } },
    { at: 278, do: 'responder.onScene' },
    { at: 362, do: 'responder.atPatient', with: { floor: 75 } },
    { at: 380, do: 'responder.scanEid',   with: { patient: 'demo-cardiac-1' } },
    { at: 400, do: 'telemetry.start',     with: { profile: 'vf-to-rosc' } },
    // …
  ],
  teardown: async (ctx) => { /* nothing — reset is by run_id */ },
};
```

### Rules

1. **The script provides stimulus, never response.** It may say "the responder taps
   accept". It may **not** say "the ETA is 2:40" — that comes from the engine, or it is
   not a demonstration of anything.
2. **Every row a run creates carries its `run_id`.** Reset deletes by `run_id`. Seeded
   history is never touched, so the analytics do not drift across repeated demos.
3. **One run at a time.** Starting a second requires `force` and is audited.
4. **Fully controllable.** Pause, resume, seek, speed 0.5×–8×, stop. Available from the
   status bar on every page.
5. **Deterministic.** Fixed RNG seed per run. The same script produces the same run,
   every time, so it can be rehearsed and timed to a narrative.
6. **Every run produces an AAR**, whether it completed or was stopped.

### Demo operator controls

A hidden operator panel (`Ctrl+Shift+D`) for rehearsal and for recovery in front of an
audience: jump to any labelled moment in the script, force the next event, skip a
waiting condition, reset the fleet, and a large "STOP AND RESET" that returns the
system to the resting state in under two seconds.
