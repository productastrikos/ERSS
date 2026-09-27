# 00 · Decision record

Every decision below is **settled** unless marked ⚠ **open**. Each records what was
chosen, the reasoning, and — importantly — what the choice rules out, so that a later
change of mind has a visible cost.

---

## D-01 · Jurisdiction: Dubai / UAE, DCAS-led

**Chosen.** The platform models the United Arab Emirates emergency ecosystem with the
Dubai Corporation for Ambulance Services as the primary operator.

| Concern | Value |
|---|---|
| Emergency numbers | **999** Police · **998** Ambulance · **997** Civil Defence · **996** Coastguard |
| Geographic addressing | **Makani** — Dubai Municipality's 10-digit entrance-level code, ~1 m² accuracy |
| Clinical exchange | **NABIDH** — DHA Health Information Exchange, HL7 FHIR R4, Emirates ID as patient identifier |
| Escalation framework | **NCEMA** National Response Framework; Dubai Supreme Committee of Crisis & Disaster Management at emirate level |
| Administrative hierarchy | Emirate → Sector → Community → Beat (Dubai Municipality community boundaries) |
| Legal frame | Federal Decree-Law 45/2021 (PDPL, with government carve-out), Dubai Law 26/2015 (Dubai Data Law), Federal Decree-Law 35/2024 (Civil Defence), UAE IA standards via TDRA |

**Why.** All three source documents converge here once weighted properly: the Concept
Note is explicitly a UAE pitch, the DCAS blueprint is the deepest domain material we
have, and the existing map data, coordinates and responder records in the repo are
already Dubai. The Six-Item BoQ spec is India-flavoured in its *vocabulary*
(State→Range→District→Police Station→Beat, PRV, crore, DPDP Act) but every one of its
~120 specification lines is jurisdiction-neutral in *substance* — they are about
response-time decomposition, ranking, risk-terrain modelling, action engines and
executive dashboards, none of which care which country they run in.

**Ruled out.** A literal India/UP-112 build. The BoQ spec's terminology is translated,
not transplanted: "District Ranking Tool" becomes zone/sector ranking across Dubai,
"PRV fleet availability" becomes ambulance and response-unit availability, "Police
Station" becomes the responding station of any of the four agencies.

**Consequence for later.** Terminology lives in one place —
`server/config/jurisdiction.js` and `web/src/lib/i18n.ts` — so a future India pack is a
configuration exercise rather than a rewrite. This is a deliberate hedge, not a promise
of white-label support; nothing else is built to be jurisdiction-agnostic.

---

## D-02 · Backend: a single Node process on port 4327

**Chosen.** One Express 5 + Socket.IO 4 process serving REST and WebSocket on the same
`http.Server`, talking to PostgreSQL 16 + PostGIS via `pg`.

**Why.** `deployment_context.md` §2 is unambiguous: *"All backend traffic — REST API and
websockets — goes through a single port and a single nginx block."* The current split
(Python FastAPI on 4001 for GIS, Node on 3009 for sockets) predates that rule and is the
exact arrangement §2 tells you to collapse. One language also means one domain model:
today an `Incident` exists as a TypeScript type in the frontend, an implicit shape in
the Node socket payloads, and a SQL row shape in the Python routes, with nothing keeping
the three honest.

**Ruled out.** The Python ML sidecar. This costs us scikit-learn, statsmodels and
XGBoost. See [D-07](#d-07--intelligence-deterministic-engines-with-an-optional-llm-seam)
for how the intelligence pillars are satisfied without them — the short version is that
the algorithms we actually need (Poisson rate estimation, kernel density, weighted
greedy coverage, EWMA anomaly detection, isotonic travel-time calibration) are a few
hundred lines of honest arithmetic each, and are *more* defensible when the arithmetic
is visible than when it is inside a fitted `.pkl`.

**Migration.** The eight FastAPI GeoJSON routes (`/roads`, `/buildings`, `/pois`,
`/parks`, `/water`, `/railways`, `/all`, `/infrastructure`) are ported to Node as
`server/routes/layers.js`, preserving response shapes so the existing map code keeps
working during the transition. `dso_api/` is archived, not deleted — see
[14-MIGRATION-MAP](14-MIGRATION-MAP.md).

---

## D-03 · Packaging: one bundle, two endpoints, role at login

**Chosen.**

```
3327  /        command console      (desktop / video wall)
3327  /app     mobile application   (phone browser + Capacitor Android APK)
                └─ after login, the account's role selects the surface:
                   responder → field crew surface
                   citizen   → SOS surface
```

A path check in `web/src/main.tsx` picks console vs mobile. Inside `/app`, the surface
is chosen by the authenticated user's role — **not** by a second URL. A citizen never
sees a responder screen and vice versa; there is no `/app/responder` to guess at.

**Why.** One bundle, one build, one deploy, one port — and one shared `lib/` for the API
client, socket protocol, types, tokens and i18n, so the console and the phone can never
drift apart on what an `Incident` is. This is the jbvnl pattern, which is field-proven in
this organisation. Keeping `/app` as a single endpoint (your correction) is better than
the three-surface split originally proposed: role-based surfacing is how the real DCAS
apps work, it removes a whole class of "wrong screen for this user" bug, and it means the
Android APK has exactly one entry point to configure.

**Ruled out.** Separate console and mobile projects; a volunteer (ESEFNI 2.0) surface;
a commander mobile surface. ESEFNI in particular is the most distinctive idea in the DCAS
blueprint and is *not* being built — see [Open items](#open-items) if you want it back.

**Capacitor.** Capacitor 8 wraps `/app` into an installable Android APK. Requires JDK 21
(Temurin), Android SDK platform 36, build-tools 36.0.0, Gradle 8.14.3. iOS is out of
scope (no Mac in the toolchain).

---

## D-04 · Visual identity: signal amber on graphite

**Chosen.** The Astrikos theme's chassis is kept in full — graphite neutral surfaces,
Lexend Deca / Lato typography, the 4px spacing scale, the `6/8/9/10/12/14/999` radius
family, the light-not-outline depth formula, the 60° geometry, the 120–300ms motion
curve. **Only the accent hue changes**, from periwinkle to signal amber.

```
--app-accent        #E0912F     nav active · focus ring · primary CTA · selection
--app-accent-strong #EFA544
--app-accent-deep   #B87322
--app-accent-bg     rgba(224, 145, 47, 0.10)
```

Status hues are untouched (`#22B15C` success · `#D99B3C` warning · `#DC4A4A` danger ·
`#5E9BD1` info) so colour keeps meaning colour.

**Why.** The brief was "no violet, no bluish, nothing that looks AI-generated". The
Astrikos brand accent (`#A597FF` periwinkle / `#A79EDA`) is precisely the hue that reads
as generated, and amber on graphite reads instead as instrumentation — SCADA, control
desk, aviation. It is also *correct* for the domain: amber is the emergency-services
signal colour, and reserving red strictly for genuine critical status means a P1 cardiac
arrest is visually distinct from ordinary chrome.

**⚠ Brand tension to flag.** This is a documented, deliberate divergence from
`ASTRIKOS-UI-THEME.md` §2.1, which marks the brand source colours *immutable*, and from
§15's ban on inventing colours. The theme file also states Law 8: the metallic §1.0
chrome gradient appears on the logo and exactly one control. We keep that law — the
metallic treatment stays on the logo lockup and the AI/advisory action — but the accent
divergence should be signed off by whoever owns the brand before this ships to a client.
If the answer is no, reverting is a single token block edit and nothing else, *because*
no component hard-codes a colour.

**Warning band note.** `--app-accent` (#E0912F) and `--app-warning` (#D99B3C) are close
in hue. [05-DESIGN-SYSTEM](05-DESIGN-SYSTEM.md#accent-versus-warning) specifies how they
are kept distinguishable: accent is never used on a status surface, warning is never used
on chrome, and the two never appear adjacent in a legend.

---

## D-05 · Data: PostGIS as the operational store, vector basemap for geography

**Chosen.**

| Layer | Source |
|---|---|
| Base geography (roads, coastline, land use, labels) | **CARTO dark-matter vector tiles** — already in use, keyless, no import |
| Operational data (incidents, units, stations, hospitals, zones, Makani points, telemetry, advisories, history) | **PostgreSQL 16 + PostGIS**, built entirely by `npm run seed` |
| Detail geometry for close-up scenes (DSO, Marina, Downtown) | Pre-baked GeoJSON in `server/data/geo/`, ported from the existing FastAPI output |
| Routing | **OSRM** — public demo server by default, self-hostable via env |

**Why.** The value of a PostGIS database in an ERSS is the operational and historical
data, not a copy of OpenStreetMap. Every analytical requirement in BoQ-2 and BoQ-3 —
hotspot clustering, radial search, 24-month trends, zone ranking, risk surfaces — is a
spatial *query over our own records*, which PostGIS does natively and a JSON file cannot.
Meanwhile the basemap is a solved problem that costs nothing.

**Ruled out.** A full `osm2pgsql` import of the Dubai extract (multi-GB download, long
import, and it buys detail we only need in three neighbourhoods, which the pre-baked
GeoJSON covers). Also ruled out: the pure JSON document store, which would have made
`git clone && npm i && npm run dev` work with zero setup but would have pushed every
analytical query into memory.

**Cost of this choice.** Postgres + PostGIS must be installed and reachable before the
app does anything useful. `npm run seed` is therefore a first-class, idempotent,
re-runnable deliverable, not a throwaway script — see
[09-DATA-AND-SEED](09-DATA-AND-SEED.md).

⚠ **Open:** credentials. See [Open items](#open-items).

---

## D-06 · Existing DSO modules: retained as multi-agency feeds

**Chosen.** The ~12,000 lines of working smart-city code are kept and re-framed, not
deleted and not left as-is.

| DSO module today | Becomes | Serves |
|---|---|---|
| Traffic signals + CCTV + congestion | **Transport feed (RTA)** | Green-wave preemption, corridor congestion in ETA, CCTV at incident |
| BMS + building digital twin (NEST) | **Civil Defence feed** | High-rise incident context, alarms, occupancy, evacuation modelling |
| Water pipeline network | **Utility feed (DEWA)** | Hydrant/supply context at fire, utility-caused incidents |
| Smart waste | **Municipality feed** | Obstruction and access context, mega-event sanitation load |
| Environment / AQI / wind | **Environment feed** | Hazard plume direction, heat-stress demand driver, weather in forecasts |

**Why.** This is not sentimentality about existing code — it is the single requirement
that most distinguishes this product from a CAD dashboard. BoQ-1 functional spec #9 and
#10 demand exactly this: *"a single, unified command interface connecting Police, Fire,
Health/Ambulance, Transport, Sanitation, and Energy/Utility stakeholders … such that
every connected department views the same live information"*, and *"correlate it with
available contextual data (e.g. weather/wind direction where relevant, population
density, nearby sensitive sites such as schools/hospitals)"*. The Concept Note's headline
simulation figure is **"5 departments on one shared view"**. We already have five
departments' worth of live feeds built.

**What "re-framed" means concretely.** Each module is rethemed to the amber tokens, its
panel chrome is rebuilt on the new shell, its data is registered in the agency feed
registry so it can be correlated against an incident, and its entry point moves from a
standalone sidebar module to a layer under `/agencies` plus a contextual card that
appears on the incident it is relevant to. The *simulation logic inside each* is largely
untouched.

**Ruled out.** Deleting them; and leaving them quarantined behind one nav entry as a
second product bolted on.

---

## D-07 · Intelligence: deterministic engines with an optional LLM seam

**Chosen.** All analytical and predictive capability is implemented as explicit,
inspectable, unit-testable code in `server/engines/`. Thirteen engines, each of which
returns its result **together with the inputs it used, the window it analysed, and a
confidence or interval**. A conversational assistant sits behind
`server/lib/llm.js` — an OpenAI-compatible seam supporting Groq / Gemini / OpenRouter /
Ollama / Anthropic — which **never throws**: with no API key configured it falls back to
a rules-based responder and the rest of the product is unaffected.

**Why.** Two constraints point the same way. The Concept Note promises sovereign
deployment with *"no external model calls"* and advisories that are *"explainable by
construction — every advisory cites the data sources it was derived from"*. BoQ-5
technical spec #5 requires *"explainability of AI outputs (e.g. confidence scores, key
contributing factors)"*. A deterministic engine satisfies both by construction; a model
behind an API satisfies neither.

**Honest labelling.** These engines are statistics and operations research, not deep
learning. The plan does not describe them as anything else, and
[08-INTELLIGENCE-ENGINES](08-INTELLIGENCE-ENGINES.md) states each method by name. Where
the source research proposes D3QN reinforcement learning for fleet repositioning, we
implement a maximal-expected-coverage heuristic instead and say so. Claiming a trained
D3QN in a tender response we cannot demonstrate would be a liability; a working,
explainable coverage optimiser that measurably improves staged response time is not.

**Ruled out.** LLM-first intelligence; and the offline-trained-weights option (fit models
in Python, ship coefficients as JSON) — reconsider this at Phase 4 if the demand forecast
proves too weak, since it is additive rather than structural.

---

## D-08 · Liveness: scripted scenarios only

**Chosen.** There is no continuous background simulation. The map is populated from
seeded history and current fleet state; live movement happens when an operator starts a
scenario, which then runs deterministically under a controllable clock
(start / pause / resume / seek / speed / stop).

**Why.** Predictability in front of an audience. A scenario that runs identically every
time can be rehearsed, timed to a narrative, paused on the exact frame that makes the
point, and replayed for after-action review. It also satisfies BoQ-1 technical spec #10
and BoQ-6 technical spec #10, which both require a scenario replay/simulation capability
for training and drills — that requirement is *for* scripted runs.

**The risk this creates, and the mitigation.** An empty command dashboard is a weak first
impression. Mitigations, all specified in [09-DATA-AND-SEED](09-DATA-AND-SEED.md) and
[06-CONSOLE-SPEC](06-CONSOLE-SPEC.md):

- Every analytics, ranking, forecasting and BI view is fully populated from the seeded
  24-month history on first load, with no scenario running.
- The Operations map opens with a realistic resting state: units at stations and on
  standby points, a handful of incidents already in progress at plausible stages, the
  KPI strip showing today's figures to date.
- The scenario launcher is on the Operations screen, one click from the resting state.

**Ruled out.** Continuous simulation; recorded-day replay as the primary mode (though the
replay *mechanism* is built anyway for after-action review, so this could be added later
at low cost).

---

## D-09 · Language: English only, i18n-ready

**Chosen.** Every user-facing string goes through `t('key')` from the first commit;
`web/src/lib/i18n.ts` ships an `en` pack only. Layouts avoid RTL-hostile patterns
(no `margin-left` where `margin-inline-start` will do, no hard-coded left-to-right icon
ordering, no text baked into images).

**Why.** Arabic with correct RTL is a significant share of a build like this — it touches
every panel, every chart axis, every map overlay, every mobile screen — and the brief is
to get six pillars genuinely working. Doing i18n plumbing now and the Arabic pack later
costs a few percent; retrofitting i18n into finished screens costs a great deal.

**Ruled out.** Full bilingual RTL now; Arabic strings with LTR layout (which looks
bilingual in a screenshot and is obviously wrong to an Arabic reader — a presentation
risk, not a saving).

**Note.** For a real DCAS engagement, Arabic is not optional. This decision is a
sequencing choice for the PoC, and should be presented as such.

---

## D-10 · Version control before anything moves

**Chosen.** Phase 0 task 1: `git init`, `.gitignore`, baseline commit of the DSO code
exactly as it stands, on a `main` branch; then all transformation work on an
`erss-transformation` branch.

**Why.** This is not currently a git repository. The transformation moves, renames or
rewrites most of the tree. Without a baseline commit there is no way to diff, review or
revert, and no way to answer "what did the DSO version do here?" six weeks from now.

⚠ **Open:** needs your go-ahead — see below.

---

## D-11 · Every visualisation is filtered and forecast, through one contract

**Chosen.** There is ONE analytical filter vocabulary and ONE forecaster, and every chart
in the product uses both.

- `server/lib/filters.js` defines the filter: window, call type, priority, origin,
  outcome, zone subtree, zone class, unit type, agency, station, complaint, escalation,
  weekday, hour band, floor band, acuity band, response band, and the target/transport/
  high-rise/multi-agency/seeded/resting flags. Every `/api/insights/*` and
  `/api/analytics/*` route parses the same keys, and every response carries
  `filters.describe` so a panel can name its own slice.
- `server/lib/forecast.js` is the predictor: Holt–Winters additive with a damped trend,
  falling back to Holt and then to a flat mean as the history shortens. Every result
  returns its method, its fitted parameters, an 80% and a 95% prediction interval, and a
  walk-forward backtest (MAE / MAPE / interval coverage) measured on the same series.
- `web/src/lib/filters.ts` holds the filter in one module-level store, round-trips it
  through the URL (so a filtered chart is a shareable link and Back undoes a filter), and
  carries it across navigation. `shared/filters/FilterBar.tsx` is the only control.
- Charts are also filter controls: clicking a bar, an almanac cell or an hour narrows the
  same filter.

**Why.** The client's requirement was "wherever there is a graph, trend, bar or chart, it
should have as many filters as possible, with predictions." Implemented per page that
becomes twenty half-compatible control sets and twenty ad-hoc extrapolations, where the
same words mean different things on different screens. One vocabulary is the only version
of that requirement that stays true as pages are added.

**Honesty rules this carries (they are the point, not decoration).**
- A forecast is never presented as a measurement: dashed line, hollow markers, a shaded
  interval, a divider at "now", and a note naming the method and its backtest error.
- An engine that cannot honour part of the filter says so in `filters.ignored`, and the
  bar greys that dimension out. A filter that looks applied and is not is worse than none.
- Today is not a day. Day series stop at yesterday and today returns as `partialDay` —
  the same rule the monthly chart always applied to the current month. A forecaster fitted
  on a third of a day reads it as a collapse in demand and predicts the collapse
  continuing.
- Two measures of different scale never share an axis.

**Ruled out.** Per-page filter controls; a charting library (the set stays hand-rolled
inline SVG, `shared/charts/`); an opaque model — anything whose backtest error the screen
cannot show is not shippable to an authority.

**Cost noted.** The filter touches the hot path, so three things were measured and fixed
rather than assumed: responder predicates use `ANY(ARRAY(subquery))` to stop the planner
flattening them into a semi-join driven from the wrong side (2.3s → 50ms); target
attainment moved into `erss_within_target()` in `db/views.sql` so the base table applies
the same rule without a correlated lookup into the view (124ms → 7ms); and day/hour grids
are gap-filled in JavaScript rather than by a generated calendar join (1820ms → 85ms).
A nine-dimension filtered read of any page is under 200ms on 409k incidents.

---

## D-12 · The map is the live response, in 3D, and every response is kept

**Chosen.** One `LiveOpsMap` (`web/src/shared/map/live/`), embedded on the Dashboard and
filling the window at `/live`. It is organised around two questions and nothing else:

    WHICH CALLS HAVE NOBODY GOING TO THEM?   A column of light rises from every live call,
                                             sized by priority in SCREEN pixels so it is
                                             visible from across the emirate. Uncovered
                                             calls pulse; the response rail lists them
                                             loudest, sorted by how long they have waited.
    WHERE HAS EACH AMBULANCE GOT TO?          The vehicle sits at its live fix with a
                                             heading arrow and an ETA chip, the road ahead
                                             is drawn, the road behind fades as a trail,
                                             and an arc links it to its call.

Clicking a rail row frames that response; clicking its arrow rides with it — a chase
camera that tilts in behind the vehicle and turns with its heading
(`MapViewState.follow.chase`, `LayerDescriptor.bearingOf`).

3D is the basemap's own `render_height` extruded (`layers/buildings.ts`). It is not
decoration: Dubai's response problem is vertical — a call on floor 60 is a different job
from a call on the pavement, which is why `v_incident_response` measures vertical access
separately — and a tilted map with the towers standing up is the only view in which that
is legible at all.

**Why.** The previous dashboard map filled half the screen and drew eighty identical
discs, which is worse than no map: it took the space a live picture needed and answered
nothing with it. Every element added here answers one of the two questions above, and
everything that answered neither was made quieter — idle ambulances collapse to a dot
below z12.5, and only units on a job carry a callsign.

**Ruled out.** A third map implementation for the wall view (the desk view and the wall
view are one component at two sizes, so they cannot drift); a separate 3D scene engine
(deck.gl over MapLibre was already in the stack); tilting by default at every zoom (the
2D/3D toggle is one click, and a flat map is still the right one for reading geography).

**The recording, and what it is honestly worth.** Every response keeps its proposed route,
its driven route, its GPS trail, its stage timeline and its predicted-vs-achieved arrival.
Three things had to be fixed for that sentence to be true:

- `route_taken` was never written. The simulation stored the route it PROPOSED and then
  threw away the one the crew drove — of 409,619 assignments, 21 had a driven route, all
  of them from the seed. `sim/live.js` now records it on arrival.
- A simulation reset deleted `unit_positions` and `assignments` for the whole run, so the
  corpus never grew past one demo. Completed responses are now lifted out of the run and
  survive it.
- `/api/insights/playbook` reports the corpus as COVERAGE PERCENTAGES per signal and names
  anything under half as a gap. A training set nobody can audit is not an asset, and the
  panel on `/live` says "route driven: 0.1% of responses" when that is the truth.

---

## D-13 · Where the calls come from is a surface, not a list

**Chosen.** Radial search opens on a DEMAND SURFACE: every call in the filtered window,
binned to a ~110 m grid by `/api/insights/geo`, re-binned into hexagons in the browser
(`shared/map/geo/hexbin.ts`) and drawn three ways over the emirate —

    3D HEXAGONS   height and colour both carry the measure, so a tower generating three
                  hundred calls stands over a quiet district and nothing rests on colour
    HEATMAP       the same numbers as a continuous field, for the SHAPE of demand
    CALLS         the individual incidents inside the circle, when the question has
                  narrowed to particular jobs

with four measures (volume, P1/P2 share, mean response, share inside target), a hexagon
size from 150 m to 1.5 km, and an hour-of-day time-lapse. Clicking a hexagon opens its
numbers and offers "search this place", which moves the radial circle there — the two
halves of the screen answer each other.

**Why.** The radial search could only answer "what happens inside this circle", and the
circle had to be guessed. The question underneath it — WHERE SHOULD THE CIRCLE GO — was
unanswerable from a 320-pixel map with six hundred identical dots on it. A density surface
is the standard instrument for that question and this codebase already had the whole stack
(deck.gl, PostGIS, the universal filter) to build one.

**The grid/hexagon split is the point.** The aggregation runs in the BROWSER over a grid
the server sends once, so hexagon size, measure and hour are dials the analyst turns while
looking at the map instead of round trips that turn the screen into a report. The emirate
at 110 m is 11,688 cells; sent columnar (one array per measure, not 11,688 objects with
repeated key names) that is ~315 kB, and a re-bin is a few milliseconds.

**Colour.** The demand ramp (`--geo-1` … `--geo-6`) is the one ramp in the product that
is not single-hue: a density surface is read from across a room and the cool-to-hot
convention is what an operations room already reads. The cost is paid down deliberately —
magnitude is carried by HEIGHT first, every adjacent pair of bands was validated for
deutan/protan/tritan separation (worst adjacent ΔE 15.0 deutan), and the legend prints the
numeric break for every band, so the order never has to be inferred from the colour.

**Bands are quantiles, with two fallbacks.** Demand is a power law: equal-width bands put
the whole emirate in band one. Quantiles fail on ties — one hour of one month is three
hundred hexagons with a single call each — so few distinct values become one band each,
and tied quantiles fall back to log-spaced edges.

**Height is always volume; colour is the measure.** Raising a hexagon by whatever measure
is selected turns "share inside target" into a wall of equally tall columns and says
nothing — and it makes the worst attainment in the emirate look identical over four calls
and over four hundred. So the column's HEIGHT is always how many calls come from that
hexagon and its COLOUR is the measure, which is the pairing every ambulance question is
actually asked in: how much is happening here, and how well is it going. Height is in
SCREEN PIXELS converted to metres per zoom, so the surface keeps its shape whether the
camera is reading the emirate or one junction.

**Bands survive ties, three ways.** Quantiles over the data are right for call volume;
when the data ties (one hour of one month is three hundred hexagons with one call, and
attainment piles up at 100%) the bands fall back to one per distinct value, then to
quantiles over the distinct values, then to equal width. Without that ladder the legend
reads "1 1 1 1 2", or — the bug this rule was written for — a log-spaced 0/1/4/9/21/46%
for a measure whose real spread is 60–100%.

**Ruled out.** Aggregating on the server per interaction (a report, not an instrument);
H3 (a dependency and a projection quarrel for a grid this simple); a hover tooltip as the
only way in (the inspector has to survive a click and drive an action); colouring by one
measure while raising by the same one (see above).

---

## D-14 · Riding with a vehicle is one mechanism, live and in replay

**Chosen.** Vehicles are DEAD-RECKONED between fixes and the camera is placed on the
vehicle's position for the frame it is drawn in.

    motion.ts        a track per vehicle: distance along the road it was given, advanced
                     at its reported speed, corrected — never replaced — by each fix
    followCamera.ts  a camera driven from the animation frame: centre on the vehicle,
                     bearing eased onto its heading, satnav look-ahead, and the wheel
                     zoom re-implemented because a per-frame `jumpTo` cancels MapLibre's
                     own gesture handlers
    vehicle3d.ts     one vehicle renderer for the live map and the replay
    replay/trip.ts   a finished job rebuilt as a timed track, played on the real clock

**Why.** Positions arrive about once a second and the road ahead every three; drawn at the
last fix, an ambulance sat still for most of every second and the chase camera lurched from
fix to fix — reported as "the ambulance doesn't move when I follow it". Interpolating is
not decoration: it is the difference between a screen you can watch a response on and a
screen that flickers. Three rules keep it honest — the vehicle moves along the ROUTE
(never across a block), it never reverses (a fix behind the estimate slows it instead), and
it stops when the feed stops (no confident driving on with no data).

**The model is a model, not a marker.** Recognisable from behind, which is the only view a
chase camera has: rear-door windows, a red-and-white chequer, tail lights and a rear light
bar that flashes red/blue. It is ~1,900 triangles built in code (an air-gapped control room
downloads nothing), capped at a few times life size so it never becomes scenery standing
over the city, and below that it becomes the same vehicle seen from directly above, laid
flat on the road. Its paint is baked into the vertices rather than themed: an ambulance is
white with red markings in both themes. An x-ray pass draws its silhouette wherever a tower
is in front of it, so it is never lost and never mistaken for being in front.

**The replay is the same picture.** A job plays on the real clock (1× to 16×) rather than a
fixed fourteen-second cartoon, in 3D with the buildings up, with the same vehicle and the
same ride-along camera. For that to be possible three things had to be recorded that were
not: the TRANSPORT leg's driven road (`route_hospital`, so the second half of a job is a
road and not straight lines between fixes), breadcrumbs every 2 s instead of 5 s while a
crew is on a job (at 90 km/h a five-second gap cuts every corner), and each breadcrumb is
projected onto the road it belongs to when the trip is rebuilt.

**Ruled out.** Easing the camera on every fix (what lurched); interpolating in React state
(a cursor pushed through the tree sixty times a second to move one marker); trusting dead
reckoning without correction (drift no operator would forgive); smoothing the camera onto a
moving target with a time constant (a permanent lag that grows and shrinks as the vehicle
brakes — the offset decays to zero instead).

---

## D-15 · A priority is judged against its own clock, not against the other priorities

**Chosen.** The radial search's priority card is a four-row panel — one row per priority,
each carrying the same four things in the same places: which priority and what it means,
how many calls (a bar against the busiest priority here), median response as a BULLET
against that priority's own target with the same priority emirate-wide as a hollow tick,
and attainment with the points it is above or below the emirate. Clicking a row filters
the page, as the bar list it replaces did. `/api/insights/radial` gained the per-priority
performance to make it possible, measured from `incidents` with `erss_within_target()`
inlined, one scan inside the circle and one outside it.

**Why.** The card was four bars of call counts, which answers "is this place busy" — a
question the KPI row already answers. The question a standby point is argued from is
whether the URGENT calls here are reached in time, and that cannot be read from a count.
Worse, four bars side by side invite exactly the wrong comparison: P1 and P4 are not
comparable with each other, because P1 is held to 8:00 and P4 to 40:00. A bullet chart
puts each row's own target ON its track, so the only comparison the eye can make is the
one that means something.

**How it stays honest.** Status colour is used — this is the service passing or failing a
commitment — and never alone: the state is written in words ("median inside target"), the
value and the target are printed, and the target is a rule on the track rather than a
change of hue. The comparison tick is deliberately weaker than the measurement.

**A trap worth writing down.** `.prio` was already a dashboard class (a 15 px priority
badge), so the panel's own `.prio` rules inherited `height: 15px` and the card clipped
itself to seventy pixels while the rows rendered inside it. Every stylesheet in this app is
global; a new block gets a name nothing else uses (`.priperf`), checked with a grep
before it is written.

---

## D-16 · The dashboard follows each incident by itself, and shows the AI's reasoning

**Asked (22 Sep 2026):** show traffic only as red on the ambulance's own route; more detail
about the ambulances; let a duty officer set the automatic-dispatch rules or keep them as
the AI sets them; every card opens a right-hand panel with all its detail; and when an
incident happens, zoom to it, show the nearby ambulances, show the AI choosing, send the job,
follow the ambulance with live crew and vehicle details — with the AI's thinking visible,
on fewer incidents that each play out completely.

**Decided with the user:** always auto-focus (fewer incidents, never overlapping); the AI
log is the dispatch engine's own trace, not LLM narration (exact, and works offline — a
client requirement); traffic is simulated and labelled, drawn only on a crew's route; the
detail panel REPLACES the right rail rather than covering the map. Unasked and chosen as
the obvious defaults: the rules are real (persisted, audited, applied by the engine), and
the crew roster is openly demo data.

**What it is:**
- `server/services/decisions.js` — THINK on `incident:new` (engine run, road routes for the
  three leading candidates, simulated traffic on each, re-score with it) pushed as
  `decision:update`; TRACE rebuilds the numbered, timestamped steps from the database, the
  stored rationale (now with `alternatives`, `policy`, `requirement`) and the preview, so it
  is as true after a restart. `GET /api/live/decisions/:ref`.
- `server/services/dispatchRules.js` + table `dispatch_rules` — `ai` mode adapts (coverage
  weight rises as the free share of the fleet falls, and says so); `custom` is applied
  exactly. Every rule changes behaviour: per-priority auto/manual and window, weights, ALS
  for P1, reserve for P3/P4, escalation alert, traffic weighting. `dispatch.rules` capability.
- `server/sim/traffic.js` — value-noise field by hour + a queue around every live road
  incident. The simulation DRIVES through it (slower in red) while still meeting the
  engine's predicted arrival, so ETAs stay honest.
- Pacing (`sim/live.js pacedGenerate`): the next alert waits until every live incident has
  an ambulance on scene, plus 75 s, and at least 4 min after the last. Resting incidents are
  not built in PoC mode. The headline detection takes a turn every 20 min.
- Web: `shared/map/live/useIncidentDirector.ts` (deciding → dispatched → following →
  arrived, once per step, paused by a person dragging the map), `layers/decision.ts` (routes
  being weighed + rank chips), traffic stretches in `layers/liveResponse.ts`, the ride-along
  card, and `console/detail/*` behind `lib/stores/detail.ts`.

**Honest limits, stated on screen:** traffic is simulated; names, staff numbers and plates
are demo data; the AI is deterministic engines, not a trained model (see the open client
question in the PoC scope).

---

## Open items

| # | Item | Blocks | What I need |
|---|---|---|---|
| O-1 | **Postgres credentials.** 5432 is listening on this machine; I did not probe it. | Phase 1 | Either the superuser credentials for the existing instance, or approval to create a fresh database `erss_db` and role `erss` with a password you set in `server/.env`. Tell me which; do not paste a password into chat — put it in `server/.env` and tell me it is there. |
| O-2 | **`git init` approval.** | Phase 0 | A yes. If no, say so and I will work without it, accepting that the transformation is not revertible. |
| O-3 | **Brand sign-off on the amber accent.** Diverges from BISG §2.0 immutable colours. | Ship, not build | Confirmation from whoever owns Astrikos brand. Build proceeds either way; reverting is one token block. |
| O-4 | **Assistant name.** The jbvnl reference calls its assistant "Sia". | Phase 6, cosmetic | Proposal: **"Nabd"** (pulse) — apt for an ambulance service, pronounceable in both languages, not a Western first name. Say if you want something else, or plain "ERSS Assistant". |
| O-5 | **ESEFNI 2.0 volunteer surface** was deselected. It is the most distinctive idea in the DCAS blueprint — geofenced cardiac-arrest alerts to nearby trained civilians — and Dubai's published bystander-CPR rate of 10.5% is the strongest possible argument for it. | Nothing; additive | Confirm it stays out, or add it as a third role inside `/app` (est. one additional phase). |
| O-6 | **OSRM hosting.** The public demo server is rate-limited and unsuitable for a live demo over a hotel network. | Phase 8 | Confirm whether a self-hosted OSRM (Dubai extract, Docker) is available on the demo machine or server, or accept the public instance with a cached-route fallback. |
| O-7 | **Real-incident framing.** [10-SCENARIOS](10-SCENARIOS.md) grounds scenarios in published UAE incidents and statistics. Some involve fatalities. | Ship, not build | Read the "Framing and sensitivity" section in that file and confirm the approach. |
