# 11 · Build plan

Twelve phases. Each ends in something runnable and reviewable. No phase is reported
complete until its definition of done is fully met — partial completion is reported as
partial.

**Estimates are in working days for one engineer**, given as a range. They assume the
open items in [00-DECISIONS](00-DECISIONS.md#open-items) are resolved before Phase 1.

---

## Phase 0 — Version control and repository restructure · 1 day

| # | Task |
|---|---|
| 0.1 | `git init`, `.gitignore`, baseline commit of the DSO code untouched on `main` ⚠ needs [O-2](00-DECISIONS.md#open-items) |
| 0.2 | Branch `erss-transformation` |
| 0.3 | Restructure per [02 §2](02-ARCHITECTURE.md#2--repository-layout): `dso-map/` → `web/`, `dso-map/server/` → `server/`, `dso_api/` → `_archive/dso_api/` |
| 0.4 | Root `package.json` with workspace scripts: `dev`, `build`, `seed`, `test`, `audit` |
| 0.5 | Remove misplaced deps (`express`, `cors`, `react-router-dom` from the web package) |
| 0.6 | `.env.example` for both packages; `npm run audit:env` |
| 0.7 | `README.md` — how to run it, from clone to running, on a clean machine |

**Done when** `npm install` succeeds at the root, the tree matches the specified layout,
and `git log` shows the DSO baseline followed by the restructure as separate commits.

---

## Phase 1 — Backend skeleton and database · 3–4 days

| # | Task |
|---|---|
| 1.1 | `server/index.js` — Express 5 + Socket.IO on one `http.Server`, port 4327 |
| 1.2 | `lib/db.js` — `pg` pool, query and transaction helpers |
| 1.3 | `db/schema.sql` — the full schema from [03 §4](03-DOMAIN-MODEL.md#4--schema), idempotent |
| 1.4 | `db/views.sql` — the ten shared views |
| 1.5 | Migration runner (numbered SQL, tracked in a `_migrations` table) |
| 1.6 | `config/env.js`, `config/jurisdiction.js` (the Dubai pack) |
| 1.7 | `lib/auth.js` — bcrypt, sessions, role and zone scoping middleware |
| 1.8 | `lib/audit.js` — hash-chained log + `verify()` |
| 1.9 | `lib/clock.js` — the injected clock. **Non-negotiable this phase**; retrofitting it later is very expensive |
| 1.10 | `lib/result.js` — the `EngineResult` envelope |
| 1.11 | `/health`, `/version`, `/api/bootstrap` |
| 1.12 | `zod` validation middleware; `pino` logging with request ids |
| 1.13 | Port the eight FastAPI GeoJSON routes to `routes/layers.js`, response shapes preserved |

**Done when** `curl :4327/health` returns `{status:'ok', db:'up'}`, `/api/bootstrap`
returns a valid payload, the schema applies cleanly to an empty database and re-applies
without error, and `npm test` passes for auth, audit chain and the layer routes.

⚠ Blocked on [O-1](00-DECISIONS.md#open-items) — Postgres credentials.

---

## Phase 2 — Reference data and seed · 4–5 days

| # | Task |
|---|---|
| 2.1 | Zone hierarchy — emirate, 10 sectors, ~40 communities, beats, with geometry |
| 2.2 | Facilities — stations, hospitals with capability sets, AEDs |
| 2.3 | Fleet — ~60 DCAS units plus police, fire and marine |
| 2.4 | Makani point generator — ~4,000 points, multi-entrance buildings correct |
| 2.5 | Weather series — 24 months, Dubai climate, including the April 2024 event |
| 2.6 | Event calendar — 24 months |
| 2.7 | History generator per [09 §4](09-DATA-AND-SEED.md#4--synthetic-history--24-months), with fleet state carried forward |
| 2.8 | The seven planted patterns |
| 2.9 | Bulk load via `COPY`, indexes after load, `ANALYZE` |
| 2.10 | `seed:verify` — asserts calibration targets, prints the report, **fails on drift** |
| 2.11 | Users and demo accounts |

**Done when** `npm run seed` completes in under 5 minutes from an empty database,
`npm run seed:verify` passes every calibration assertion, and the aggregate report
matches [09 §2](09-DATA-AND-SEED.md#2--calibration-targets-and-a-discrepancy-worth-flagging).

---

## Phase 3 — Theme system and app shell · 4–5 days

| # | Task |
|---|---|
| 3.1 | `theme/theme.css` — the full token block, both themes |
| 3.2 | `theme/base.css` — reset, type ramp, focus ring, motion, reduced-motion |
| 3.3 | Self-hosted Lexend Deca + Lato + JetBrains Mono |
| 3.4 | `npm run audit:theme` — the grep suite from [05 §9](05-DESIGN-SYSTEM.md#9--self-audit), wired into `npm test` |
| 3.5 | `shared/ui/` primitives: Button, Card, Panel, Chip, Badge, StatusDot, Table, Modal, Drawer, Tabs, SegmentedControl, Select, Input, Toast, Tooltip, Skeleton, EmptyState, ErrorState |
| 3.6 | `main.tsx` surface router |
| 3.7 | Console shell — Sidebar, Header, StatusBar, page switch, `lucide-react` icons replacing all emoji |
| 3.8 | `lib/api.ts`, `lib/socket.ts`, `lib/types.ts` + `types:gen` from the schema enums |
| 3.9 | `lib/stores/` — session, fleet, incidents, advisories, filters |
| 3.10 | `lib/i18n.ts` with the `en` pack; every string through `t()` from here on |
| 3.11 | Theme toggle; dark default |

**Done when** the shell renders in both themes at 1280 / 1920 / 3840 / 390 px,
`audit:theme` returns clean, and there is not one emoji or hex literal in `web/src`
outside `theme.css`.

---

## Phase 4 — Map architecture · 5–6 days

| # | Task |
|---|---|
| 4.1 | `shared/map/MapCanvas.tsx` — MapLibre instance, imperative handle |
| 4.2 | `shared/map/DeckOverlay.ts` — the single `MapboxOverlay` |
| 4.3 | `layerRegistry.ts` — descriptors, visibility, order, legend metadata |
| 4.4 | `shared/map/tokens.ts` — CSS custom property → deck.gl colour array |
| 4.5 | Core layers: zones, facilities, incidents, units, routes, Makani |
| 4.6 | Analytical layers: risk, demand, crowd, hotspot, coverage |
| 4.7 | Popups, `useMapFocus`, layer control, legend (generated from the registry) |
| 4.8 | **Migrate** the five agency layer sets out of `DSOMap.tsx`, one at a time |
| 4.9 | Delete `DSOMap.tsx` once the last domain has moved |

**Done when** every layer is a registry descriptor, the legend and layer control are
generated rather than hand-written, `DSOMap.tsx` no longer exists, and there is no
colour array literal in any layer module.

> This is the phase most likely to overrun. 2,823 lines of working imperative map code
> is being restructured while keeping it working. Migrate one domain per commit and keep
> the old file until the last one lands.

---

## Phase 5 — Operations, dispatch and the real-time backbone · 5–6 days

| # | Task |
|---|---|
| 5.1 | Incident CRUD, triage, close |
| 5.2 | Assignment lifecycle with all its transitions and the acknowledge timeout |
| 5.3 | `realtime/` — rooms, presence, fan-out, `units:snapshot`, reconnect behaviour |
| 5.4 | `engines/eta.js` + OSRM client with caching |
| 5.5 | `engines/dispatch.js` with the rationale payload |
| 5.6 | `engines/hospital.js` |
| 5.7 | Operations page: queue, map, detail/dispatch panel, KPI strip |
| 5.8 | The resting state |
| 5.9 | Correlation endpoint and card |

**Done when** an incident can be created, recommended, dispatched, tracked and closed
entirely from the console, with the rationale visible at every step and every stage
timestamp landing correctly in the database.

> **Status (17 Sep 2026): done.** Verified by `npm run test:flow` (6 tests against the
> running backend: the full lifecycle with every stamp checked against
> `v_incident_response`, decline and timeout re-dispatch to the cap, agency SLA, RBAC,
> idempotent replay, a phone listening in, and on-scene stamped from a GPS fix) and by
> driving the same lifecycle through the console in headless Chrome, in both themes at
> 390 / 1280 / 1920 / 3840 px. `npm test` 68 engine and lifecycle tests.
>
> | # | As built |
> |---|---|
> | 5.1 | `services/incidents.js`, `routes/incidents.js`; auto-triage by rules when no priority is given |
> | 5.2 | `domain/lifecycle.js` + `services/dispatch.js`; timeout sweep every 2 s on the domain clock; capped auto re-dispatch; dispatcher can log crew steps from a radio call |
> | 5.3 | Rooms by surface and scope, access-checked `incident:watch`, `units:snapshot` on join and every 30 s, refetch on reconnect (`lib/socket.ts`) |
> | 5.4 | `engines/eta.js` calibrated on pace per road metre (see 08 §3.2 as built), `integrations/osrm.js` with DB cache and circuit breaker |
> | 5.5 | `engines/dispatch.js` — rationale stored forever; coverage is a **proxy** until 6.4, equity a visible zero until 6.6 |
> | 5.6 | `engines/hospital.js` |
> | 5.7 | Operations page: queue, map with routes, recommend/dispatch panel with "why", unit lifecycle, agency SLA strip, context card, timeline, notes, close, create dialog, KPI strip |
> | 5.8 | `db/seed/resting.js` — fleet at rest plus four mid-flight incidents built with the real engines, restored by `seed:reset` in ≈0.4 s |
> | 5.9 | `engines/correlation.js` + card; its agency set is notified on dispatch with SLA clocks |
>
> **Not in this phase, stated plainly:** the pre-empt corridor on dispatch (6.7); MEXCLP
> coverage cost (6.4) and equity (6.6); KPI tiles drilling into Analytics (7.4);
> per-capability multi-unit recommendation (units are added one at a time); patients and
> telemetry on the panel (8); the P1 tone is synthesised, not a recorded sound.

---

## Phase 6 — Intelligence engines · 7–9 days

| # | Task |
|---|---|
| 6.1 | `responseTime` + tests |
| 6.2 | `risk` — RTM grid, factor exposure, Poisson fit, Getis-Ord + tests |
| 6.3 | `demand` — seasonal Poisson with covariates + back-test |
| 6.4 | `coverage` — MEXCLP + greedy exchange + tests |
| 6.5 | `ranking` — composite, weights, re-baseline + tests |
| 6.6 | `anomaly`, `equity`, `crowd` (density, choke, evacuation) + tests |
| 6.7 | `preempt` + `v_preempt_impact` |
| 6.8 | `advisory` — all 14 detectors, suppression, cooldown, auto-close |
| 6.9 | `lib/llm.js` seam + the rules-first assistant |
| 6.10 | Calibration back-tests reporting error in the test output |

**Done when** every engine has golden-fixture tests, returns a conforming envelope,
handles degenerate input without fabricating confidence, meets its performance budget on
the full seeded dataset, and the advisory engine finds all seven planted patterns
without being told where they are.

---

## Phase 7 — The five pillar pages · 8–10 days

| # | Page | Days |
|---|---|---|
| 7.1 | Advisories — hub, drill-down, Analyze/Act, what-if | 2 |
| 7.2 | Collaborate — response time, shared incident, escalations, replay | 2 |
| 7.3 | Ranking — table, weights editor, trends, compare, scorecard, re-baseline | 1.5 |
| 7.4 | Analytics — six tabs | 2.5 |
| 7.5 | Intelligence — report builder, KPI library, quality, lineage | 2 |
| 7.6 | Executive — tiles, layout editor, ISO 22320, event mode, video wall, AAR library | 2 |

Includes the chart component set from
[05 §5.6](05-DESIGN-SYSTEM.md#56-the-chart-set-actually-needed), built once and reused.

**Done when** every pillar route loads populated from the seed with no scenario running,
every chart has hover and a table view, every filter is in the URL, and every predicted
value is marked as predicted.

---

## Phase 8 — Mobile surfaces · 6–7 days

| # | Task |
|---|---|
| 8.1 | `MobileApp.tsx`, login, role resolution |
| 8.2 | Responder: home, duty state, assignment offer with countdown |
| 8.3 | Responder: navigation to the Makani entrance, voice guidance, position reporting |
| 8.4 | Responder: on-scene, vertical access, Emirates ID + NABIDH, vitals, interventions, triage tag |
| 8.5 | Responder: destination, pre-alert, transport, handover, clear, shift |
| 8.6 | Citizen: SOS, type selection, confirm, tracking |
| 8.7 | Citizen: first-aid guidance (offline), medical profile |
| 8.8 | Citizen: accessibility mode including silent SOS and the text exchange |
| 8.9 | Offline queue, degraded states, the never-queue-an-SOS rule |
| 8.10 | `native.ts` with every web fallback |

**Done when** a full responder job and a full citizen SOS both complete on a phone
browser over the LAN, and every capability degrades correctly without Capacitor.

---

## Phase 9 — Agency feeds re-framed · 3–4 days

| # | Task |
|---|---|
| 9.1 | `agency_feeds` registry, classification, freshness |
| 9.2 | Re-theme and re-shell the five modules |
| 9.3 | `/agencies` page with the five tabs |
| 9.4 | Correlation: "incidents correlated with this feed" on each tab, and the contextual card on the incident |
| 9.5 | Wire the Transport feed into `preempt` and `eta`; Environment into `correlation` and `demand`; BMS into `crowd`'s evacuation model |

**Done when** each feed is reachable both from `/agencies` and contextually from an
incident it is relevant to, and the correlation runs on incident creation.

---

## Phase 10 — Scenario engine and the six scenarios · 5–6 days

| # | Task |
|---|---|
| 10.1 | `sim/runner.js` — clock, events, conditions, pause/seek/speed |
| 10.2 | `run_id` tagging throughout; reset by `run_id` |
| 10.3 | Status-bar transport control |
| 10.4 | SC-01 vertical city cardiac arrest |
| 10.5 | SC-02 multi-agency collision |
| 10.6 | SC-03 mega-event staging |
| 10.7 | SC-04 stroke handoff |
| 10.8 | SC-05 signal trap (both runs + the historical analysis) |
| 10.9 | SC-06 mass casualty |
| 10.10 | AAR generation and the replay view |
| 10.11 | The `Ctrl+Shift+D` operator panel |

**Done when** all six Tier-1 and Tier-2 scenarios run start to finish driving console
and phone, each produces an AAR, and reset returns the system to the resting state in
under two seconds with the analytics unchanged.

---

## Phase 11 — Native build, hardening and deployment · 4–5 days

| # | Task |
|---|---|
| 11.1 | Capacitor 8 init, Android project, plugins, permissions, icons |
| 11.2 | Debug APK; install and complete a responder job on a real phone over the LAN |
| 11.3 | Push notifications via FCM behind `notify.js` |
| 11.4 | `ops/nginx/`, `ops/pm2/ecosystem.config.cjs` |
| 11.5 | Production build; `VITE_*` wiring; `audit:env` clean |
| 11.6 | Security pass: CORS allow-list, cookie flags, RBAC on every route, PII handling, no secret in the bundle |
| 11.7 | Performance pass: first meaningful paint under 2 s per page on the demo machine |
| 11.8 | Two-device manual QA script |
| 11.9 | `DEPLOY.md` rewritten for ports 3327/4327 |

---

## Phase 12 — Documentation reconciliation and demo rehearsal · 2 days

| # | Task |
|---|---|
| 12.1 | Update every file in `docs/` to match what was actually built. Anything that changed is corrected here, not left stale |
| 12.2 | Record the honest gaps: what is mocked, what is simulated, what is out of scope |
| 12.3 | A demo script per scenario with timings and talking points |
| 12.4 | Full rehearsal of all six scenarios on the demo hardware |
| 12.5 | Compliance matrix: every BoQ line in the six-item spec against what exists, marked Yes / Partial / No with a remark. **Partial and No stated plainly** |

---

## Summary

| Phase | Days |
|---|---|
| 0 Restructure | 1 |
| 1 Backend skeleton | 3–4 |
| 2 Seed | 4–5 |
| 3 Theme + shell | 4–5 |
| 4 Map | 5–6 |
| 5 Operations + realtime | 5–6 |
| 6 Engines | 7–9 |
| 7 Pillar pages | 8–10 |
| 8 Mobile | 6–7 |
| 9 Agency feeds | 3–4 |
| 10 Scenarios | 5–6 |
| 11 Native + deploy | 4–5 |
| 12 Docs + rehearsal | 2 |
| **Total** | **57–70 working days** |

### Dependencies

```
0 ──► 1 ──► 2 ──┬──► 5 ──► 6 ──► 7 ──┐
      │         │                    ├──► 10 ──► 11 ──► 12
      └──► 3 ──►4 ──► 5              │
                     └──► 8 ─────────┤
                     └──► 9 ─────────┘
```

Phases 3–4 (frontend) can run in parallel with 1–2 (backend) if there are two people.
Phase 6 is the critical path and the one most likely to reveal that a planted pattern
is not detectable — budget rework there rather than assuming it works first time.

### Definition of done — applies to every phase

- [ ] Works from a clean clone with only `README.md` as instructions
- [ ] No hard-coded colour, host, IP or port
- [ ] Both themes verified; all four viewport widths verified
- [ ] Loading, empty and error states designed, not default
- [ ] Every user-facing string through `t()`
- [ ] Every new engine has golden-fixture tests
- [ ] RBAC enforced server-side on every new route
- [ ] Every new write audited
- [ ] `npm test` and `npm run audit` clean
- [ ] `docs/` updated if anything diverged from this plan
