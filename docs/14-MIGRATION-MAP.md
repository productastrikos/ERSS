# 14 · Migration map

What happens to every existing file. Nothing is deleted without appearing in this table.

**Legend**
`MOVE` — relocated, contents largely intact ·
`PORT` — logic kept, rewritten to the new architecture ·
`RETHEME` — kept and restructured for the new shell and tokens ·
`REPLACE` — the capability survives, the implementation does not ·
`ARCHIVE` — moved to `_archive/`, not deleted ·
`DELETE` — removed, with the reason stated

---

## 1 · `dso_api/` — the FastAPI service

| File | Action | Destination / note |
|---|---|---|
| `main.py` | ARCHIVE | `_archive/dso_api/`. Its routing table is the specification for `server/routes/layers.js`. Its `psycopg2.Error` → 503 handler is a good pattern and is reproduced in Node — a database outage should never look like an application bug. |
| `database.py` | ARCHIVE | The stdlib `.env` loader is neat but Node 24 does this natively. The single-global-connection pattern is **not** carried over; `pg.Pool` replaces it. |
| `routes/roads.py` · `buildings.py` · `pois.py` · `parks.py` · `water.py` · `railways.py` · `all_data.py` · `infrastructure.py` | PORT | → `server/routes/layers.js`. **Response shapes preserved exactly** so the map code keeps working during the migration. The SQL in each file is the reference for the ported query. |
| `requirements.txt` · `__pycache__/` | DELETE | No Python in the runtime. |
| `.env` · `.env.example` | ARCHIVE | Values inform `server/.env.example`. |

> `_archive/dso_api/` is kept until the ported layer routes are verified against the
> same database and produce identical GeoJSON. It can be removed after Phase 5.

---

## 2 · `dso-map/` → `web/`

### 2.1 Project files

| File | Action | Note |
|---|---|---|
| `package.json` | PORT | Remove `express`, `cors` (server deps in a frontend package), `react-router-dom` (unused once the shell switch lands). Add `lucide-react`, `zod`, `@capacitor/*`, `@vitejs/plugin-basic-ssl`. |
| `vite.config.ts` | PORT | Add `basic-ssl`, `server.host`, port 3327, path aliases. |
| `tsconfig*.json`, `eslint.config.js` | MOVE | Tighten to `strict` + `noUnusedLocals`/`noUnusedParameters`. |
| `index.html` | PORT | Self-hosted font links, correct title and meta, theme colour. |
| `.env`, `.env.example` | REPLACE | Per [02 §8](02-ARCHITECTURE.md#8--environment-variables). The current file points at `socket-dso.astrikos.xyz` and is DSO-specific. |
| `README.md` | REPLACE | |

### 2.2 Core

| File | Action | Note |
|---|---|---|
| `src/main.tsx` | REPLACE | Becomes the surface router. |
| `src/App.tsx` (478 lines) | REPLACE | Currently holds 25+ pieces of state and drills every one of them into children. Its state moves to `lib/stores/`, its layout to the console shell, its module switch to the page switch. **This file is the main reason the app is hard to extend, and it does not survive.** |
| `src/App.scss`, `App.css`, `index.css`, `index.scss` | REPLACE | → `theme/theme.css` + `theme/base.css`. |
| `src/config.ts` | PORT | → `lib/config.ts`, reading `VITE_*` with no hard-coded fallback host. |
| `src/types/index.ts` (322 lines) | PORT | → `lib/types.ts`, regenerated against the SQL enums; DSO-specific types dropped, ERSS types added. |
| `src/hooks/useLayerVisibility.ts` | PORT | → the layer registry's visibility state. |
| `src/api/incidentsAPI.ts` | REPLACE | → `lib/api.ts`. Contains a hard-coded `https://dso_api.astrikos.xyz:8443`. |

### 2.3 The map

| File | Action | Note |
|---|---|---|
| `src/components/DSOMap/DSOMap.tsx` (2,823 lines) | REPLACE | Decomposed into `shared/map/` per [02 §5](02-ARCHITECTURE.md#5--map-architecture--replacing-dsomaptsx). Migrated one domain per commit; the file is deleted only when the last domain has moved. Also contains two hard-coded API hosts. |
| `DSOMap.scss` | REPLACE | |
| `src/utils/poiIcons.ts` (1,201 lines) | PORT | → `shared/map/icons/`. Genuinely useful canvas icon generation; keep the mechanism, retheme the colours to tokens. |
| `src/utils/trafficIcons.ts` | PORT | → `shared/map/icons/`, under the Transport feed. |
| `src/utils/environmentLayers.ts` (515 lines) | PORT | → `shared/map/layers/agency/environment.ts`. The deck.gl layer construction is reusable; colour arrays become token lookups. |
| `src/data/dsoBoundary.ts` | REPLACE | → the seeded zone hierarchy. DSO becomes one community among ~40. |

### 2.4 Components

| Component | Action | Becomes |
|---|---|---|
| `TopBar` (101) | REPLACE | `console/shell/Header` |
| `Sidebar` (285) | REPLACE | `console/shell/Sidebar` — emoji icons → `lucide-react`, modules → the ERSS nav |

> **Measured baseline for the emoji purge:** 907 lines across `dso-map/src` contain an
> emoji character. That is the scale of the icon replacement in Phase 3, and it is
> spread across nearly every component rather than concentrated in the Sidebar.

| `MapControls` (101) | PORT | `shared/map/LayerControl` — currently commented out of `App.tsx` |
| `BuildingPanel` (336) | RETHEME | Reference panel under the Civil Defence feed |
| `BuildingTooltip` (—) | RETHEME | `shared/map/popups/` |
| `InfraPanel` (276) | RETHEME | Reference panel |
| `IncidentAlertPopup` (97) | PORT | Becomes the P1 incident alert on the console |
| `IncidentSimulator` (840) | REPLACE | **Superseded by the scenario engine.** Its incident-progression logic is the reference for `sim/runner.js` — read it before writing the runner. |
| `AccidentResponsePanel` (1,021) | PORT | **The most valuable component in the repo for this transformation.** It already implements responder selection, task dispatch, acceptance, en-route tracking and arrival. It becomes the basis of the Operations dispatch panel and the assignment lifecycle. |
| `TrafficSignalManager` (603) · `TrafficCommandPanel` (759) · `TrafficCommandCenter` (583) | RETHEME → merge | One Transport feed panel. Three overlapping traffic panels is two too many. **Note the nesting:** `TrafficCommandPanel` renders `TrafficCommandCenter` at line 80, so the two are one component split across two files, not two alternatives — merge them rather than choosing between them. |
| `BMSPanel` (489) · `BMSBuildingPopup` (146) | RETHEME | Civil Defence feed |
| `BuildingDigitalTwin` (1,240) · `NestBuilding3D` (1,795) · `HVACIncidentPanel` (557) · `HVACSchematicPanel` (722) | RETHEME | Civil Defence feed → the building twin. Feeds the evacuation model in `crowd`. Keeps `three`. |
| `NestBuilding3D_OLD_BACKUP.tsx` (1,695) | DELETE | A backup file in source control's place. Phase 0 deletes it; the git baseline preserves it. |
| `WaterPipelinePanel` (1,016) | RETHEME | Utility (DEWA) feed. Contains a hard-coded API host. |
| `SmartWastePanel` (721) | RETHEME | Municipality feed |
| `EnvironmentAnalyticsPanel` (418) | RETHEME | Environment feed |
| `FloorSelector` | PORT | Reused for vertical-access UI — directly relevant to the high-rise scenarios |

### 2.5 Data

| File | Action | Note |
|---|---|---|
| `data/responders.ts` (213) | PORT | **The seed of the fleet model.** Its `Responder` type, `haversine`, `getNearestResponders` and the `TaskStatus` lifecycle all map onto `units` and `assignments`. Read it before writing the schema migration. |
| `data/incidents.ts` (1,044) + `data/incidents/*.json` | REPLACE | → `scenarios` + `sim/scripts/`. The ten incident JSON files are a useful reference for scenario script structure. |
| `data/bmsBuildings.ts` (869) | PORT | → seeded building reference for the Civil Defence feed |
| `data/environmentSensors.ts` (912) · `pollutionSources.ts` (396) · `windFlowData.ts` (170) | PORT | → seeded Environment feed. Wind data feeds hazard-plume correlation. |
| `data/trafficSignals.ts` (409) | PORT | → seeded signal set; the input to `preempt` |
| `data/waterNetwork.ts` (794) · `wasteBins.ts` (65) | PORT | → seeded Utility and Municipality feeds |
| `data/indoorData.ts` · `landmarks.ts` (74) | PORT | Indoor data supports vertical access; landmarks become reference points |
| `data/technicians.ts` (61) | REPLACE | Folded into `users` + `units` |

### 2.6 Assets

| Asset | Action |
|---|---|
| `public/traffic_cctv_*.mp4` (15 files), `traffic_accident_cctv.mp4`, `traffic_jam_cctv_1.mp4` | MOVE → `web/public/media/`. Used by the Transport feed's CCTV panel and the scripted detection overlay. |
| `public/Astrikos Logo Transparent perfect 1.png`, `Astrikos_solo_logo.png`, `astrikos_login_page 1.png` | MOVE → `web/public/brand/` |
| `public/dso_logo_bg_transperant.png` | DELETE | DSO-specific |
| `src/assets/react.svg`, `public/vite.svg` | DELETE | Scaffold leftovers |

---

## 3 · `dso-map/server/` → `server/`

| File | Action | Note |
|---|---|---|
| `index.cjs` (405 lines) | PORT | → ESM, split across `index.js`, `routes/`, `realtime/`. **The socket event model is largely right and is carried forward**: login/rejoin, task dispatch, accept/reject, location updates, arrival, route updates, completion. Renamed per [04 §10](04-API-AND-SOCKET-CONTRACT.md#10--socket-protocol) and moved behind REST where the write rule requires it. |
| — password hashing | REPLACE | SHA-256 with the fixed salt `'dso-smartcity-2024'` → **bcrypt**. Unsalted-per-user and fast; not acceptable in a system shown to a security authority. |
| — `registered` / `online` in-memory maps | REPLACE | → `users`, `sessions`, and a presence store |
| — `DSO_SIGNALS`, `/api/signals/*` | PORT | → the Transport feed and `preempt` |
| — `randomNearbyLocation()` around the DSO centre | REPLACE | → seeded station and standby positions across the emirate |
| — CORS `origin: '*'` | REPLACE | → allow-list from `CORS_ORIGINS` |
| `data/users.json` | REPLACE | → the `users` table. **Inspect before discarding** — it may hold accounts used in previous demos. |
| `seed-users.cjs` · `seed-users.js` | DELETE | Two copies of the same script. Superseded by `db/seed/`. |

---

## 4 · Root

| File | Action | Note |
|---|---|---|
| `DEPLOY.md` | REPLACE | → [12-DEPLOYMENT](12-DEPLOYMENT.md). Describes the superseded three-port scheme (3209/3009/4001) and the retired `fastapi` nginx file. |
| `deployment_context.md` | KEEP | Still the organisation-wide convention. Add the `erss / 3327 / 4327` row to its registry. |
| `Research Documents/` | KEEP | Source material. Gemini research outputs land here per [13](13-RESEARCH-GAPS.md). |

---

## 5 · Things worth reading before writing the replacement

Four files in the current codebase encode real thinking that should not be re-derived:

| File | What to take from it |
|---|---|
| `AccidentResponsePanel.tsx` | The complete dispatch → accept → en route → arrive → resolve loop, already working against the socket. The closest thing in the repo to what ERSS does. |
| `data/responders.ts` | The `TaskStatus` lifecycle and nearest-responder selection — the direct ancestor of `assignments` and `engines/dispatch`. |
| `IncidentSimulator.tsx` | How an incident is progressed through stages with a timeline — the reference for `sim/runner.js`. |
| `dso_api/main.py` | The database-outage-as-503 handler, and the habit of returning the *target* in an error so a misconfiguration is diagnosable. Reproduce both. |

---

## 6 · Risks in this migration

| Risk | Mitigation |
|---|---|
| `DSOMap.tsx` decomposition breaks the map in ways that only show at certain zoom levels or layer combinations | Migrate one domain per commit; keep the old file until the last domain moves; screenshot-compare each domain before and after |
| The ported layer routes return subtly different GeoJSON from the FastAPI | Keep `_archive/dso_api` runnable through Phase 5 and diff the responses for the same bbox |
| `data/users.json` holds accounts someone still needs | Inspect and export before replacing |
| The building digital twin (3,500+ lines across four files, plus `three`) consumes disproportionate time to retheme | Time-box it. If it overruns, ship it in the DSO theme behind a "legacy view" label rather than half-rethemed, and finish it in Phase 12 |
| Three overlapping traffic panels contain behaviour that is not obviously duplicated | Diff them before merging. `TrafficCommandPanel` nests `TrafficCommandCenter`, so the boundary between them is arbitrary and the merge is safe; `TrafficSignalManager` is the separate one. |
| The transformation loses something nobody noticed was load-bearing | The Phase 0 git baseline. This is the entire reason [O-2](00-DECISIONS.md#open-items) blocks the work. |
