# 02 · Architecture

---

## 1 · Process model

Two processes. That is the whole system.

| Process | Port | Contents |
|---|---|---|
| **web** | **3327** | Vite dev server (dev) / static `dist` served by `serve` (prod). One bundle, two entry surfaces. |
| **server** | **4327** | One Node process: Express 5 REST + Socket.IO 4 on the same `http.Server`, plus the engines, the scenario runner and the LLM seam. Talks to Postgres. |

Plus **PostgreSQL 16 + PostGIS** on 5432, which is infrastructure, not a process we ship.

There is no third port. No separate API port, no separate socket port, no Python
service. This is `deployment_context.md` §2 followed literally.

```
        ┌───────────────── browser / Android WebView ─────────────────┐
        │                                                             │
        │   http://<host>:3327/          console surface              │
        │   http://<host>:3327/app       mobile surface               │
        └───────────────┬─────────────────────────────────────────────┘
                        │
       REST  ───────────┤  fetch  →  ${VITE_API_URL}/api/...
       WS    ───────────┘  socket →  ${VITE_API_URL}/socket.io/
                        │
                        │   (same origin, same port — one nginx block in prod)
                        ▼
        ┌──────────────────── server : 4327 ──────────────────────────┐
        │  index.js        http.Server ← Express app + Socket.IO      │
        │  routes/         REST surface                                │
        │  realtime/       socket namespaces, rooms, presence          │
        │  engines/        13 deterministic engines                    │
        │  sim/            scenario script runner + clock              │
        │  integrations/   makani · nabidh · cad · rta  (seams)        │
        │  lib/            db, auth, audit, notify, llm, result        │
        └───────────────────────────┬─────────────────────────────────┘
                                    │ pg
                                    ▼
                   ┌────────────────────────────────┐
                   │  PostgreSQL 16 + PostGIS       │
                   │  erss_db                       │
                   └────────────────────────────────┘
```

---

## 2 · Repository layout

```
ers/
├── PLAN.md                      ← index of this document set
├── README.md                    ← how to run it (written in Phase 0)
├── docs/                        ← this document set
├── package.json                 ← root: workspace scripts only (dev, build, seed, audit)
│
├── web/                         ← frontend  → :3327
│   ├── index.html
│   ├── vite.config.ts
│   ├── capacitor.config.ts
│   ├── android/                 ← Capacitor Android project (generated, committed)
│   ├── public/
│   │   ├── brand/               ← logos
│   │   └── media/               ← CCTV clips carried over from DSO
│   └── src/
│       ├── main.tsx             ← SURFACE ROUTER: '/' → console, '/app' → mobile
│       ├── theme/
│       │   ├── theme.css        ← the only place a colour literal exists
│       │   ├── base.css         ← reset, type ramp, focus ring, motion
│       │   └── print.css
│       ├── lib/                 ← SHARED by both surfaces — the contract
│       │   ├── api.ts           ← every REST call, typed, one place
│       │   ├── socket.ts        ← connect, rejoin, typed event map
│       │   ├── types.ts         ← the domain model in TypeScript
│       │   ├── stores/          ← module-level stores + useSyncExternalStore
│       │   ├── i18n.ts
│       │   ├── format.ts        ← durations, tabular numerals, Makani, timestamps
│       │   ├── geo.ts           ← haversine, bbox, Makani parse/format
│       │   ├── routing.ts       ← OSRM client + cache
│       │   ├── native.ts        ← the ONLY Capacitor-aware module
│       │   └── session.ts
│       ├── shared/              ← components used by BOTH surfaces
│       │   ├── map/             ← MapCanvas, layer registry, deck.gl overlay
│       │   ├── charts/          ← hand-built SVG charts on theme tokens
│       │   └── ui/              ← Button, Card, Chip, Table, Modal, Drawer, …
│       ├── console/             ← desktop surface
│       │   ├── ConsoleApp.tsx   ← shell + page switch
│       │   ├── shell/           ← Sidebar, Header, PageHeader, VideoWallMode
│       │   └── pages/
│       │       ├── operations/
│       │       ├── collaborate/
│       │       ├── ranking/
│       │       ├── analytics/
│       │       ├── intelligence/
│       │       ├── advisories/
│       │       ├── executive/
│       │       ├── agencies/    ← the retained DSO modules, re-framed
│       │       └── admin/
│       └── app/                 ← mobile surface
│           ├── MobileApp.tsx    ← login → role → surface
│           ├── responder/
│           ├── citizen/
│           └── common/
│
├── server/                      ← backend  → :4327
│   ├── index.js                 ← the one process
│   ├── config/
│   │   ├── env.js               ← every env var read in exactly one place
│   │   └── jurisdiction.js      ← Dubai pack: agencies, numbers, hierarchy, SLAs
│   ├── lib/
│   │   ├── db.js                ← pg Pool, query helper, transaction helper
│   │   ├── result.js            ← the engine result envelope (evidence/confidence)
│   │   ├── auth.js              ← bcrypt, sessions, role + zone scoping
│   │   ├── audit.js             ← hash-chained append-only log
│   │   ├── notify.js            ← multi-channel adapter (in-app/socket/push live)
│   │   ├── llm.js               ← optional provider seam; never throws
│   │   └── clock.js             ← scenario clock (real time when idle)
│   ├── routes/                  ← one file per resource
│   ├── realtime/                ← socket wiring, rooms, presence, fan-out
│   ├── engines/                 ← 13 engines, pure functions over repo data
│   ├── sim/
│   │   ├── runner.js            ← executes a scenario script against the clock
│   │   └── scripts/             ← one file per scenario (SC-01 … SC-10)
│   ├── integrations/            ← makani.js · nabidh.js · cad.js · rta.js
│   ├── data/
│   │   ├── geo/                 ← pre-baked GeoJSON for close-up scenes
│   │   └── reference/           ← Dubai zones, stations, hospitals, Makani seed
│   ├── db/
│   │   ├── schema.sql           ← the whole schema, one file, idempotent
│   │   ├── views.sql            ← analytical / warehouse views
│   │   └── seed/                ← generators (see 09-DATA-AND-SEED)
│   └── .env.example
│
├── ops/
│   ├── nginx/                   ← the two blocks to paste
│   ├── pm2/ecosystem.config.cjs
│   └── scripts/
│
└── _archive/                    ← the DSO original, kept for reference
    └── dso_api/                 ← the retired FastAPI service
```

### Layout rules

1. **`web/src/lib/` is the contract.** Both surfaces import from it; neither surface
   imports from the other. If the console and the mobile app need the same thing, it
   lives here. This is the single most important structural rule in the repo.
2. **`server/engines/` are pure.** An engine takes data in and returns a result
   envelope. It does not query the database directly, does not touch the socket, does
   not read the clock. Repositories fetch; engines compute; routes and the runner wire
   them together. This is what makes them unit-testable and their outputs explainable.
3. **One file per REST resource, one file per socket concern.** No `utils.js`.
4. **`theme.css` is the only file containing a colour literal.** Enforced by
   `npm run audit:theme`.
5. **`native.ts` is the only Capacitor-aware module.** Everything else runs identically
   in a browser and in the WebView.

---

## 3 · Technology stack

### Frontend

| Concern | Choice | Reason |
|---|---|---|
| UI | React 19.2 + TypeScript 5.9 (strict) | Already in the repo at this version; no migration cost |
| Build | Vite 7 + `@vitejs/plugin-react` | Already in the repo |
| Dev HTTPS | `@vitejs/plugin-basic-ssl` | Geolocation and camera need a secure context on a LAN IP — the phone will not give you GPS over plain `http://192.168.x.x` |
| Styling | **SCSS + CSS custom-property tokens**. No Tailwind. | The repo is already SCSS-per-component; introducing Tailwind mid-transformation doubles the styling vocabulary for no gain. Tokens do the theming work either way. |
| Icons | `lucide-react` — one family, replacing the current emoji | Emoji icons (`🚦`, `🏢`, `🗑️`) render differently per platform and read as unserious in a command room. This is a visible upgrade. |
| Map | **MapLibre GL 5** (imperative) + **deck.gl 9** via `MapboxOverlay` | Already in the repo and working; deck.gl handles the heavy aggregation layers (heatmap, hexagon, trips, arcs) that Pillar 3 needs |
| Basemap | CARTO dark-matter vector style | Keyless, dark, already in use |
| Charts | Hand-built inline SVG on theme tokens | No chart library can be made to obey the token system exactly; the chart set needed here is small and specific |
| State | Module-level stores + `useSyncExternalStore` | No Redux, no Zustand, no React Query. One idiom. The repo's current prop-drilling through `App.tsx` (25+ pieces of state) is the thing this replaces. |
| Routing | A `switch` in the console shell, tab state in the mobile app; a path check in `main.tsx` | `react-router-dom` is currently a dependency and is not earning it |
| Real-time | `socket.io-client` 4.8 | Already in the repo |
| Native | Capacitor 8 — `app`, `filesystem`, `geolocation`, `push-notifications`, `camera`, `share`, `splash-screen`, `status-bar` | Android APK for the responder and citizen demo |
| Fonts | Lexend Deca + Lato, self-hosted | A control room may be air-gapped; a Google Fonts CDN dependency is a demo risk |

**Dependencies removed:** `react-router-dom`, `three` / `@types/three` *(only if the
building digital twin's 3D view is not retained — it is, so three stays)*, `express` and
`cors` from `web/package.json` (they belong to the server, and are in the frontend's
dependency list today by mistake).

### Backend

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node 24 (present on this machine), ESM | Native `.env` loading via `--env-file-if-exists`, no dotenv |
| HTTP | Express 5 + `cors` + `helmet` | Async-error friendly |
| Real-time | Socket.IO 4.8 on the same `http.Server` | One port |
| Database | PostgreSQL 16 + PostGIS, `pg` 8 with a pool | Spatial queries are the point |
| Migrations | Plain idempotent SQL (`schema.sql` + numbered `migrations/`) run by a tiny runner | A migration framework is overhead at this size |
| Auth | `bcrypt` + signed HTTP-only cookie sessions, role and zone claims | PoC-appropriate; SSO is a seam |
| Validation | `zod` on every request body | One schema per payload, shared shape with the TS types |
| Uploads | `multer` → `server/data/uploads`, served with a cache header | Photos from the field app |
| Push | Capacitor push via FCM; abstracted behind `notify.js` | So SMS/e-mail can be added without touching callers |
| LLM | `fetch` to OpenAI-compatible endpoints; Anthropic SDK loaded dynamically if selected | Provider is a runtime setting; absent key = rules fallback |
| Testing | `node:test` + `supertest` for routes, pure unit tests for engines | No new test framework |
| Logging | `pino` with request ids | Structured logs matter when replaying an incident |

### Why not the current stack

| Current | Replaced with | Reason |
|---|---|---|
| FastAPI + `psycopg2` on 4001 | Node route module on 4327 | One backend, one port ([D-02](00-DECISIONS.md#d-02--backend-a-single-node-process-on-port-4327)) |
| `psycopg2` single global connection, reconnect-on-error | `pg.Pool` | The current pattern serialises every request through one connection and races on reconnect |
| Hard-coded `https://dso_api.astrikos.xyz:8443` in four files | `VITE_API_URL` | `deployment_context.md` §5: never hardcode |
| SHA-256 + fixed salt `'dso-smartcity-2024'` for passwords | `bcrypt` | The current scheme is unsalted-per-user and fast; it is not acceptable even in a PoC that will be shown to a security authority |
| `users.json` flat file | `users` table | Roles, zone scoping and audit need relations |
| Emoji module icons | `lucide-react` | Consistency and seriousness |
| 2,823-line `DSOMap.tsx` | `shared/map/` with a layer registry | See §5 |

---

## 4 · The surface router

`web/src/main.tsx` — the entire routing story:

```tsx
const path = window.location.pathname;
const surface = path.startsWith('/app') ? 'mobile' : 'console';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {surface === 'mobile' ? <MobileApp /> : <ConsoleApp />}
  </StrictMode>
);
```

Inside `MobileApp`, after authentication:

```tsx
const { role } = useSession();
if (!role)              return <LoginScreen />;
if (role === 'responder') return <ResponderSurface />;
if (role === 'citizen')   return <CitizenSurface />;
return <UnsupportedRoleScreen />;   // a console role logging in on a phone
```

In the Capacitor build, `capacitor.config.ts` sets the start path so the APK opens
directly on `/app`. The console code is still in the bundle but never reached — an
acceptable cost for one build pipeline. If APK size becomes a problem, `vite build`
with a `--mode app` that stubs the console entry is the escape hatch, and is noted in
[12-DEPLOYMENT](12-DEPLOYMENT.md).

---

## 5 · Map architecture — replacing `DSOMap.tsx`

The current `DSOMap.tsx` is 2,823 lines holding basemap setup, twelve unrelated feature
domains, imperative MapLibre layer management, deck.gl overlay wiring, popups, markers,
video elements and the routing animation. It works, and it cannot be extended safely.

**Replacement structure:**

```
shared/map/
├── MapCanvas.tsx           mount MapLibre, own the instance, expose an imperative handle
├── DeckOverlay.ts          the single MapboxOverlay, layers composed from the registry
├── layerRegistry.ts        id → { source, layers, deckLayers, visible, order, legend }
├── layers/
│   ├── incidents.ts        incident points, clusters, priority styling
│   ├── units.ts            live unit positions, heading, status
│   ├── routes.ts           proposed vs taken, corridor, trips animation
│   ├── zones.ts            sector/community boundaries, choropleth by metric
│   ├── risk.ts             RTM grid surface
│   ├── demand.ts           forecast heat surface
│   ├── crowd.ts            density surface + choke points
│   ├── coverage.ts         isochrone / coverage rings
│   ├── facilities.ts       stations, hospitals, AEDs
│   ├── makani.ts           entrance points
│   └── agency/             traffic · bms · water · waste · environment (ported)
├── popups/                 one component per popup kind
└── useMapFocus.ts          flyTo / fitBounds / follow-unit, one place
```

Rules:

- A layer module exports a descriptor, not side effects. It never touches the map
  instance directly.
- Visibility, order and legend metadata live in the registry, so the layer panel and
  the legend are generated, not hand-maintained.
- All layer styling reads theme tokens through `shared/map/tokens.ts`, which resolves
  CSS custom properties to the `[r,g,b,a]` arrays deck.gl needs — so the map rethemes
  with the rest of the app instead of carrying its own palette.

**Migration approach:** the existing layer code is *moved*, not rewritten, one domain at
a time, with the old file kept until the last domain has moved. See
[11-BUILD-PLAN](11-BUILD-PLAN.md) Phase 4.

**As built (Phase 4).** The structure above, plus:

| File | Why it exists |
|---|---|
| `styleReconciler.ts` | The only code that calls `addSource`/`addLayer`/`setPaintProperty`; diffs what it applied, so a theme switch repaints in place |
| `camera.ts` | Camera presets (`DUBAI_CAMERA`, `DSO_CAMERA`) |
| `geometry.ts` | Circles, distance-along-path, bearings — shared by layers and feeds |
| `icons/glyphs.ts`, `icons/shapes.ts` | lucide glyphs and canvas shapes as deck.gl *mask* icons, coloured from tokens at draw time |
| `layers/kit.ts` | The shared disc-marker and label construction |
| `layers/detail.ts` | Close-up geometry from `/api/layers/*` (D-05) |
| `layers/agency/environment.ts` | Three descriptors — air quality, wind, pollution — so their toggles are generated |
| `lab/` | **Dev only** (`/?maplab` under `vite dev`): every layer fed from fixtures and driven by the URL, for screenshot checks of layers whose pages and feeds do not exist yet |

A `MapView` (from `createMapView`) is one map instance's state — visibility, data, load
status, selection, follow — so the Operations and Analytics maps can differ. Reference
layers self-load over REST the first time they are shown; operational, analytical and
agency layers are fed with `setLayerData` and show "No feed" until they are. The
original `DSOMap.tsx` and a domain-by-domain record of where it went are in
`_archive/dso-map/`.

### As built (Phase 5) — the server's layers

The layout in §2 has `routes/` calling engines directly. Operations needed one more layer,
because the same dispatch must be reachable from a route, the acknowledge-timeout loop and
(Phase 10) the scenario runner — and must be the *same* dispatch in each:

```
server/
├── domain/lifecycle.js     pure state machines: incident, assignment, unit — what is legal
├── repos/                  SQL only: incidents.js · fleet.js · reference.js
├── engines/                pure computation: eta · dispatch · hospital · correlation · triage
├── integrations/osrm.js    the routing seam: memory → route_cache → network, circuit breaker
├── services/               the operations: incidents · dispatch · units · eta · kpi · actor
│                           read and compute outside a transaction → lock, re-validate, write
│                           → audit → fan-out
├── realtime/fanout.js      every server → client emit, called only after commit
└── lib/idempotency.js      Idempotency-Key replay for retryable writes
```

Routes validate and authorise; services decide; repos hold the SQL; engines never touch
the database, the clock or the socket. The web side mirrors it: `lib/socket.ts` (connect,
rooms, resync-on-reconnect), `lib/stores/{incidents,fleet,kpis,now,toast}.ts`, and
`lib/stores/now.ts` — the **client-side domain clock**, anchored to the server's
`serverTime` and `run:clock`, so elapsed counters run on scenario time, not the laptop's.

---

## 6 · Data flow rules

These are non-negotiable and every reviewer should check them.

1. **Writes go over REST. Fan-out goes over the socket.** A client never mutates
   state by emitting a socket event alone. The server writes, then broadcasts.
   *Exception, deliberate and single:* `unit:position` from the responder app is
   high-frequency and lossy by nature; it is socket-only, batched, and persisted by the
   server on a throttle.
2. **REST is the floor, the socket is enrichment.** Every screen must render correctly
   from REST alone. The socket makes it live. A dropped connection degrades liveness,
   never correctness. On reconnect, the client refetches rather than replaying.
3. **Every engine output travels in a result envelope.** See `lib/result.js`:
   ```js
   { value, unit, confidence, window: { from, to }, inputs: [...], factors: [...],
     method: 'poisson-rate-hourly-v1', computedAt }
   ```
   The UI is built to display `factors` and `window`. An engine that returns a bare
   number cannot be shown in the advisory UI — the envelope is the enforcement
   mechanism for the explainability requirement, not a convention.
4. **The clock is injected.** Nothing calls `Date.now()` except `lib/clock.js`. When a
   scenario is running, the clock is the scenario clock. This is what makes replay,
   seek and speed control possible at all, and it must be true from the first commit —
   retrofitting it is very painful.
5. **Archive, never delete** for users, incidents, assignments and advisories.
   `archived_at` / `closed_at`, never `DELETE`.

---

## 7 · Security posture (PoC-honest)

| Control | Implemented | Notes |
|---|---|---|
| Password storage | bcrypt, cost 12 | Replaces the current SHA-256 + fixed salt |
| Session | Signed HTTP-only cookie, 12 h, rotate on privilege change | Native app uses the same cookie via Capacitor's WebView cookie jar |
| RBAC | Role + zone scope enforced **server-side on every route** | Never client-side only |
| Audit | Hash-chained append-only `audit_log` | Every write, every advisory action, every role change |
| Input validation | `zod` on every body and query | |
| CORS | Allow-list from env; `*` is not permitted in production config | The current server uses `*` |
| Transport | TLS terminated at nginx in production; `basic-ssl` in dev | |
| Secrets | `server/.env`, never committed; `.env.example` documents every key | |
| PII | Emirates ID stored as a salted hash plus last-3 for display; never in logs; patient clinical data behind a role gate and fully audited | Matches PDPL and the health-data sensitivity note in the Concept Note §09 |
| Not implemented | SSO/MFA, rate limiting, HA/DR, pen testing | Stated in scope-out, not silently absent |

---

## 8 · Environment variables

Every one, in one place. `web` reads only `VITE_*`.

### `web/.env`
```
VITE_API_URL=http://localhost:4327          # dev; prod = https://erss-api.astrikos.xyz:8443
VITE_SOCKET_URL=http://localhost:4327       # same host — one backend
VITE_OSRM_URL=https://router.project-osrm.org
VITE_MAP_STYLE=https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
VITE_BUILD_SURFACE=both                     # both | app  (app trims the console entry)
```

### `server/.env`
```
PORT=4327
NODE_ENV=development
CORS_ORIGINS=http://localhost:3327,http://192.168.1.10:3327

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=erss_db
DB_USER=erss
DB_PASSWORD=

SESSION_SECRET=
BCRYPT_ROUNDS=12

OSRM_URL=https://router.project-osrm.org

# Optional — absent means the assistant falls back to rules, and nothing else changes
LLM_PROVIDER=                # groq | gemini | openrouter | ollama | anthropic
LLM_API_KEY=
LLM_MODEL=
LLM_BASE_URL=

# Integration seams — absent means the mock is used
MAKANI_API_KEY=
NABIDH_BASE_URL=
FCM_SERVER_KEY=
```

Rule from `deployment_context.md` §5, restated: **no host, IP or port literal appears in
source.** `npm run audit:env` greps for them and fails the build.
