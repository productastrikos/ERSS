# 06 · Command console specification

Surface: `/` on port 3327. Desktop, tablet and video-wall.

---

## 1 · Shell

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ▇ ERSS Dubai    Operations                    ⌕ search    ◷ 14:32:07 GST  ⬤ 3 │ 64px
├──────────────┬────────────────────────────────────────────────────────────────┤
│              │                                                                │
│ OPERATIONS   │                                                                │
│ ▎Operations  │                                                                │
│  Advisories 3│                     page content                               │
│              │                                                                │
│ INTELLIGENCE │                                                                │
│  Collaborate │                                                                │
│  Ranking     │                                                                │
│  Analytics   │                                                                │
│  Intelligence│                                                                │
│              │                                                                │
│ COMMAND      │                                                                │
│  Executive   │                                                                │
│  Agencies    │                                                                │
│              │                                                                │
│ SYSTEM       │                                                                │
│  Admin       │                                                                │
│              │                                                                │
│ ─────────────│                                                                │
│ ⬤ Dispatcher │                                                                │
│   A. Khalil  │                                                                │
├──────────────┴────────────────────────────────────────────────────────────────┤
│ ⬤ SYSTEM ONLINE │ DB ok │ 42 units on duty │ SC-01 running ▮▮ 03:14 │ v1.0.0  │ 32px
└───────────────────────────────────────────────────────────────────────────────┘
   248px
```

**Header.** Logo lockup (the metallic §1.0 treatment, one of two places it appears),
current page title in Lexend 20/700, global search, GST clock with seconds, and the
alert bell with an unacknowledged-advisory count.

**Sidebar.** Four sections. Nav items are `lucide-react` icons at 16px plus a 13/600
label. The active item carries a 3px `--app-accent` left rail and an `--app-accent-bg`
wash. Sections use the 9.5/600 Lexend uppercase eyebrow. Collapsible to 64px (icons
only) with the state persisted. **No emoji anywhere** — this replaces the current
`🚦 🏢 🗑️` set.

**Status bar.** System state, database reachability, units on duty, and — when a
scenario is running — its ref, a transport control (pause / resume / stop) and the
cursor. The scenario control being permanently visible in the chrome, rather than
hidden inside a page, is deliberate: an operator must always be able to stop a running
demo from wherever they are.

**Role shapes the shell.** `zone_scope` filters every list; a role without a pillar's
permission does not see its nav item at all (not a disabled item). The nav is generated
from the permission set returned by `/api/bootstrap`.

---

## 2 · Operations · `/`

The working screen. Everything else in the product exists to make this screen better.

```
┌──────────────────┬─────────────────────────────────────────┬──────────────────┐
│  INCIDENT QUEUE  │                                         │  DETAIL / DISPATCH│
│                  │                                         │                  │
│ [Active 7][All]  │                                         │  ┌─────────────┐ │
│ ┌──────────────┐ │                                         │  │ INC-…-0417  │ │
│ │▎P1 CARDIAC   │ │              MAP                        │  │ P1 Cardiac  │ │
│ │  04:12 AMB-14│ │                                         │  │ arrest      │ │
│ ├──────────────┤ │     units · incidents · zones           │  ├─────────────┤ │
│ │▎P2 RTA       │ │     routes · coverage rings             │  │ RECOMMENDED │ │
│ │  11:47 PRV-22│ │                                         │  │ ▸ AMB-14    │ │
│ ├──────────────┤ │                                         │  │   ETA 2:40  │ │
│ │▎P3 FALL      │ │                                         │  │   ▇▇▇ why   │ │
│ │  02:31 —     │ │                                         │  │ ▸ AMB-09    │ │
│ └──────────────┘ │                                         │  │   ETA 4:05  │ │
│                  │  ┌───────────────────────────────────┐  │  ├─────────────┤ │
│ ── FLEET ──      │  │ layers ▾  │ basemap ▾ │ ⛶ │ ▶ SC  │  │  │ [ DISPATCH ]│ │
│ available   18   │  └───────────────────────────────────┘  │  └─────────────┘ │
│ responding   9   │                                         │                  │
│ on scene     6   │                                         │                  │
│ transporting 4   │                                         │                  │
├──────────────────┴─────────────────────────────────────────┴──────────────────┤
│ TODAY  calls 312 │ p50 resp 6:04 │ p90 11:22 │ ≤8min 71% │ ack p50 38s │ …    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Incident queue (left, 300px)

Sorted by priority then elapsed. Each card per [05 §7.1](05-DESIGN-SYSTEM.md#71-incident-card).
Filters: state, priority, kind, zone, agency. Cards pulse once on arrival and a short
tone plays for P1 (mutable, off by default, remembered per device).

### 2.2 Map (centre, flexible)

Layers from the registry, grouped in the layer control: **Operational** (incidents,
units, routes, coverage), **Analytical** (risk, demand, crowd, hotspots), **Agency**
(traffic, buildings, water, waste, environment), **Reference** (zones, stations,
hospitals, Makani, AEDs).

Interactions: click an incident → detail panel; click a unit → unit card with its
current assignment and a "follow" toggle; click a zone → zone summary with a drill-down
link into Ranking; right-click anywhere → "create incident here" (dispatcher role only),
which is how a demo starts an unscripted call.

### 2.3 Detail / dispatch panel (right, 380px)

Three states:

**Nothing selected** — fleet status board: units by agency and kind, with status
counts, and the coverage figure with its trend.

**Incident selected, undispatched** — this is the screen that matters most:

- Incident facts, with Makani code, entrance, floor and access note prominent. The
  vertical-city information is not buried; it is second only to the priority.
- **Recommended units**, ranked, each showing predicted ETA and an expandable "why"
  that renders the `dispatch_rationale` factor breakdown — travel time, capability
  match, coverage cost of taking this unit, crew hours, equity adjustment. The
  dispatcher approves a recommendation; they do not re-derive it.
- Manual override: any available unit, with a required reason, recorded.
- `[ DISPATCH ]` — the primary action, amber with dark ink. One click performs the
  whole commit described in [04 §3](04-API-AND-SOCKET-CONTRACT.md#3--incidents):
  assignment created, offer pushed to the unit's phone, preempt corridor opened,
  correlated agencies notified, SLA clocks started.

**Incident selected, dispatched** — live timeline, assignment states, per-agency SLA
strip, correlation card, route proposed vs taken, patient and telemetry if present,
notes thread, and `[ Close incident ]` with a required outcome.

### 2.4 KPI strip (bottom)

Today to date: calls, p50 and p90 response, percentage within the 8-minute target,
p50 acknowledge, units on duty, mean turnout. Each tile drills into Analytics with the
filter carried. Values come from `v_incident_response` — the same view every other
screen uses.

### 2.5 Resting state

With no scenario running the screen is **not empty**: units sit at stations and standby
points, three or four incidents are in plausible mid-flight states from the seed, and
the KPI strip shows the day's real figures to date. The scenario launcher (`▶ SC`) sits
on the map control bar.

---

## 3 · Advisories · `/advisories` — Pillar 5

The Concept Note's advisory hub, built literally.

**Left: the hub.** Advisories grouped by severity — Emergency, Warning, Alert, Info —
each card per [05 §7.2](05-DESIGN-SYSTEM.md#72-advisory-card). Filters by category,
zone, agency, state. Sort by severity, age or SLA urgency.

**Right: drill-down** for the selected advisory:

- Impacted areas listed by zone, with counts
- A geo-representation of the pattern on a small map
- The historical window analysed, stated as dates and record counts
- The data sources cited, by name
- The factor contributions as a horizontal bar set
- Confidence, sample size, baseline and target
- Action history: who analysed, who acted, who it was routed to, the SLA clock
- `[ Analyze ]` runs the deeper query and attaches the result inline
- `[ Act ]` — the metallic control — opens the routing dialog: owning agency, owner,
  action text, SLA hours. Creating it starts the clock and notifies the owner.

**What-if runner** (BoQ-5 F10) on its own tab: change fleet size, weather, a scheduled
event or a staging plan, re-run the forecast and coverage engines, and show the delta
against the current plan. Nothing is persisted.

**Advisory generation** runs on a schedule and can be forced. The engines that produce
advisories are listed in [08 §4](08-INTELLIGENCE-ENGINES.md#4--the-advisory-engine).

---

## 4 · Collaborate · `/collaborate` — Pillar 1

Four tabs.

### 4.1 Response time

The stage decomposition. A stacked horizontal bar per stage showing p50 and p90, with
the largest contributor called out in prose above it — "En-route travel is 58% of total
response in Al Quoz, 2.4× the emirate median." Split by zone, agency, unit kind, hour of
week, priority. A dot plot compares the selected split against the baseline.

Below: the distribution histogram, and the list of the individual incidents most
damaging to the average, each linking to its after-action report. This is the Concept
Note's *"the events most damaging to average response time flagged before the shift
begins"*.

### 4.2 Shared incident view

The multi-agency picture for one incident. Agency lanes down the left, timeline across.
Every agency sees the same object. Per-lane: notified, acknowledged, on-scene, SLA met
or not. The notes thread is shared and attributed. A "notification ledger" shows the
elapsed time from detection to each agency's alert, which is the measured proof of the
sub-minute claim in BoQ-1 F9.

### 4.3 Escalations

Threshold rules (per agency, priority and zone), the live escalation queue, and the
escalation history. Creating a rule is a form, not a config file — BoQ-1 F7 requires it
be configurable without vendor dependency.

### 4.4 Replay

Scenario and historical incident replay. A transport bar with scrub, speed and
jump-to-event. The map, timeline and SLA strip all follow the cursor. Used for
after-action review and for drills.

---

## 5 · Ranking · `/ranking` — Pillar 2

**League table.** Zones at the selected level, ranked by composite score, with rank
movement arrows and per-component columns. Drill from Emirate → Sector → Community →
Beat. A choropleth beside the table, coloured by the composite, with the selected row
highlighted on both.

**Weights editor.** The hyperparameters, exposed:

| Parameter | Default weight |
|---|---|
| Average response time | 30% |
| Percentage within target | 25% |
| Unit availability | 15% |
| Event closure rate | 12% |
| Acknowledge time | 10% |
| Pre-empt event rate | 8% |

Sliders, normalised to 100%, with a live re-rank as they move and a "what changed"
diff against the saved set. Saving is versioned and audited. This is BoQ-2 F2 —
re-weighting without vendor dependency — and it must be demonstrably live, not a form
that files a request.

**Trends.** Rank movement over week / month / quarter / year, as small multiples.

**Compare.** Two to four zones side by side across every component.

**Scorecard.** Per zone, publishable: the composite, the components, the trend, the
rank, the peer group, and the two advisories most relevant to it. Exports to PDF and
PNG.

**Re-baseline** (BoQ-2 F8). Change a zone's fleet strength — add two ambulances to Al
Barsha — and the availability and coverage metrics recompute against the new baseline,
showing before and after as a dot plot. This answers "what would another ambulance
actually buy us", which is the question a ranking table otherwise provokes and cannot
answer.

---

## 6 · Analytics · `/analytics` — Pillar 3

Six tabs, all sharing one filter bar (period, zone, incident kind, priority) that
persists across tabs.

### 6.1 Incidents

Heat surface on the map with the top-ten and bottom-ten event types beside it, and
monthly counts against forecast. Drill-down follows the zone hierarchy to the 500 m
cell. Hotspot clusters are marked where they are statistically significant, not merely
dense — the method and the significance test are named in the panel.

### 6.2 Risk terrain

The RTM grid. Choose an hour of week and the surface changes — risk is temporal, and a
static risk map is a misleading one. Clicking a cell shows its factor contributions:
road-class density, historical incident intensity, population, high-rise count,
industrial sites, crowd venues, junction density. Each contribution is a signed bar.

### 6.3 Forecast

Demand forecast by zone and hour with an 80% interval, and — on the same page, not
hidden — **forecast accuracy**: predicted versus actual for the last 30 days, MAE and
coverage of the interval. The Concept Note promises the model is "held to account";
this is where that happens, and it is not optional.

### 6.4 Radial search

The Concept Note's feature, exactly: pick any address or point, choose a radius between
500 m and 1000 m, and get the incident count inside it trended over time, broken down
by type, with a period-over-period comparison against the prior 30 days.

### 6.5 Crowd & events

Live and forecast crowd density for a selected event, choke-point identification,
stampede and congestion risk with an explicit lead-time figure, and the recommended
pre-emptive redirection. Feeds Scenario SC-03.

### 6.6 Evacuation

Building egress modelling over the digital twin's floor plates: occupancy, exit
capacity, stair and lift availability, predicted clearance time, and the bottleneck
floors. Feeds the high-rise scenarios.

> **Two honest gaps on this page.** The CCTV panel plays real video with scripted
> detection overlays — there is no live computer-vision model, and the panel says so on
> a permanent chip. The text-analysis panel classifies call notes with rules, not a
> language model, and says so. See
> [01 §3 Pillar 3](01-VISION-AND-SCOPE.md#pillar-3--ml--geospatial-analytics--analytics).

---

## 7 · Intelligence · `/intelligence` — Pillar 4

**Report builder.** Dimensions and measures from the semantic layer in a left rail;
drag to rows, columns, values, filters; pick a form from the [approved chart
set](05-DESIGN-SYSTEM.md#56-the-chart-set-actually-needed); the result renders live.
Save, share with a role, schedule, export. The builder posts a structured query, never
SQL.

**KPI library.** Every KPI with its name, definition, the formula in readable form, its
unit, direction, target, warning and breach thresholds, its ISO 22320 reference, its
owner and its source view. Editable by an admin; every edit versioned and audited.

**Data quality.** Per source: completeness, validity, duplication and timeliness, as a
scorecard with the failing rows inspectable. A source whose quality drops below
threshold raises an advisory — which is the point of measuring it.

**Lineage.** A graph from source table → view → KPI → the dashboard tiles that use it.
Clicking a KPI anywhere in the product can reach this, which is how a disputed number
gets settled.

---

## 8 · Executive · `/executive` — Pillar 6

A configurable tile grid, per role.

**Default layout for `service_lead`:**

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ RESPONSE    │ WITHIN      │ CALLS       │ UNITS       │
│ p50         │ TARGET      │ today       │ on duty     │
│ 6:04  ▼12s  │ 71%   ▲3pt  │ 312   ▲8%   │ 42 / 48     │
├─────────────┴─────────────┼─────────────┴─────────────┤
│ RESPONSE TIME · 90 DAYS   │ LIVE OPERATING PICTURE    │
│ line + 80% band           │ map, incidents + units    │
├───────────────────────────┼───────────────────────────┤
│ ZONE RANKING · TOP/BOTTOM │ OPEN ADVISORIES           │
│ horizontal bars           │ by severity, with SLA     │
├───────────────────────────┴───────────────────────────┤
│ STAGE DECOMPOSITION · emirate                         │
│ stacked bar, p50 / p90                                │
└───────────────────────────────────────────────────────┘
```

Every tile drills into its pillar carrying the current filter. Every tile shows its
freshness ("as of 14:31"). A tile whose data is stale beyond a threshold says so rather
than showing a confident old number.

**ISO 22320 view.** The KPI set mapped to clause references, with compliance state.
This is BoQ-6 F3 and it is what a tender evaluator will look for first.

**Event mode.** For a mega-event: the same dashboard with staging plan, crowd surface,
perimeter and dedicated event KPIs overlaid. BoQ-6 F10 requires this without a parallel
system, so it is a mode, not a page.

**Video-wall mode.** Per [05 §7.4](05-DESIGN-SYSTEM.md#74-video-wall-mode).

**After-action library.** Closed incidents and completed scenario runs with their
reports, searchable, with the executive summary of each.

---

## 9 · Agencies · `/agencies`

The retained DSO modules, re-framed as the five departments on one shared view.

| Tab | Source module | Re-framed as |
|---|---|---|
| Transport (RTA) | Traffic signals, CCTV, congestion | Signal state, corridor congestion, preemption log with measured seconds saved, CCTV at incident |
| Civil Defence | BMS + building digital twin | Building alarms, occupancy, HVAC and smoke state, evacuation modelling, the tower twin |
| Utility (DEWA) | Water pipeline network | Network state, hydrant availability, supply incidents |
| Municipality | Smart waste | Obstruction and access, event sanitation load |
| Environment | AQI, wind, sensors | Wind direction and plume for hazard correlation, heat stress as a demand driver |

Each tab: the feed's own live view, its classification under the Dubai Data Law, its
last-update time, and — the part that makes it more than a port — **"incidents
correlated with this feed"**, the list of incidents where this feed contributed context.
That list is what turns five smart-city modules into one multi-agency picture.

---

## 10 · Admin · `/admin`

Users (create, edit, archive — never delete; role, agency, zone scope, unit binding),
roles and permissions, KPI thresholds and SLA defaults, escalation rules, agency feed
registry and classification, the jurisdiction pack, integration seam status (which are
live, which are mocked — the same truth the UI chips show), and the audit log with
**chain verification**: a button that walks the hash chain and reports the first break
or confirms integrity.

---

## 11 · Cross-cutting requirements

| Requirement | Applies to |
|---|---|
| Every screen renders correctly from REST alone; the socket only makes it live | All |
| Every screen has a loading skeleton, an empty state and an error state, all designed | All |
| Every number carries a unit; every timestamp carries GST | All |
| Every predicted value is visually marked as a prediction and reveals its method | All |
| Every mocked data source carries a permanent "simulated source" chip | Analytics, Agencies, clinical |
| Every table has column sort, column visibility, and CSV export | All tables |
| Every filter state is in the URL, so a view can be sent to a colleague | All |
| Keyboard: `g` then a letter jumps between pages; `/` focuses search; `Esc` closes any overlay | All |
| No screen may take more than 2 s to first meaningful paint on the demo machine | All |
