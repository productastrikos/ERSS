# ERSS Dubai

**Emergency Response Support System — Dubai Corporation for Ambulance Services**

An interoperability and decision layer above the command, dispatch and building systems
Dubai's emergency authorities already run. It measures the response minute by minute at
source, predicts where minutes will be lost, and turns each finding into a routed,
tracked instruction with a service-level timer against it.

The full plan — architecture, domain model, API contract, design system, six-pillar
specification, scenarios, build phases — is in [`docs/`](docs/), indexed by
[`PLAN.md`](PLAN.md). **Read [`docs/00-DECISIONS.md`](docs/00-DECISIONS.md) first.**

---

## Run it

> **Deploying on Hostinger?** See [`HOSTINGER.md`](HOSTINGER.md). One process, one port:
> `npm run build` then `npm start`.

### Prerequisites

| | |
|---|---|
| **Node** | ≥ 22.9 (24.x in use) |
| **PostgreSQL** | 16+ — 18 in use |
| **PostGIS** | ⚠ **Required, and NOT bundled with PostgreSQL.** Install via Start menu → *Application Stack Builder* → PostgreSQL → Spatial Extensions → PostGIS. Two minutes. |

### Setup

```powershell
npm install

# 1. Fonts (self-hosted — a control room may be air-gapped)
node ops/scripts/fetch-fonts.mjs

# 2. Database: creates the erss role + erss_db, enables PostGIS,
#    and writes the generated password into server/.env
.\ops\scripts\setup-db.ps1

# 3. Schema, views, and 24 months of calibrated history
npm run db:schema
npm run db:views
npm run seed
npm run seed:verify        # asserts the calibration targets are met

# 4. Run
npm run dev
```

| URL | Surface |
|---|---|
| `http://localhost:3327/` | Command console |
| `http://localhost:3327/app` | Mobile app — responder or citizen, by role |
| `http://localhost:4327/health` | Backend liveness + database state |

### Signing in

Sign in as **`admin` / `Astrikos2026`** for full access — every capability, every page.
Both login screens list the seeded accounts and fill the form on a click, so nothing has
to be looked up mid-demonstration; the full table is in `DEPLOY.md` §3 and the list
itself is `web/src/lib/demoAccounts.ts`. Every other demo account uses `erss2026`.

Each browser TAB holds its own session, so a dispatcher, a duty officer and a service
lead can be signed in side by side in one browser.

Within about 45 seconds of signing in — or of pressing **Restart PoC** in the header — a
camera raises a road collision, the map flies to it, and the right rail opens by itself
on the AI log: what the platform saw, what it weighed, what it chose and why.

### On a phone, over the LAN

```powershell
npm run dev:lan
```

Then open `https://<your-lan-ip>:3327/app` and accept the self-signed certificate.

**HTTPS is not optional here.** `navigator.geolocation` and `getUserMedia` both refuse a
plain-HTTP LAN origin, so without it the citizen app cannot get a location and the
responder app cannot open the camera — and both fail *silently*. Add your LAN origin to
`CORS_ORIGINS` in `server/.env`.

---

## Trial build (PoC scope)

This build is scoped to the agreed proof of concept, in one file:
[`server/config/poc.js`](server/config/poc.js). With `poc.enabled` on (the default):

| | |
|---|---|
| **Fleet** | Eight ambulances in the Silicon Oasis catchment. The map, the fleet counts and the dispatch engine all see these eight and nothing else. The rest of the fleet is still in the database, just out of scope. |
| **Road only** | Every incident is on the carriageway (`server/sim/roadSites.js`). No floors, rooms or buildings. The indoor scenario is in [`_archive/indoor-scenario/`](_archive/indoor-scenario/README.md). |
| **No calls** | No 998 call stream and no manual "create incident". Cameras raise every incident (`source = 'sensor'`). |
| **Automatic dispatch** | Always on. Incidents the queue loses (a restart, or every ambulance busy) are swept back in every 10 s. |
| **No simulation panel** | The live picture **starts with the server**. `POST /api/sim/reset` clears it and restarts it. |

Set `enabled: false` to get the emirate-wide product back unchanged.

---

## Layout

```
erss/
├── docs/          the plan — read 00-DECISIONS first
├── web/           frontend  → :3327   one bundle, two surfaces
│   └── src/
│       ├── theme/     theme.css — the ONLY file with a colour literal
│       ├── lib/       the shared contract: api, types, socket, stores, i18n
│       ├── shared/    components used by BOTH surfaces (map, charts, ui)
│       ├── console/   the command console
│       ├── app/       the mobile app
│       └── _legacy/   DSO components awaiting migration (docs/14)
├── server/        backend   → :4327   Express 5 + Socket.IO, one process
│   ├── config/    env.js and jurisdiction.js — the Dubai pack
│   ├── lib/       db, clock, result envelope, auth, audit, errors
│   ├── routes/    one file per resource
│   ├── engines/   the deterministic intelligence layer
│   ├── sim/       the scenario runner
│   └── db/        schema.sql, views.sql, seed/
├── ops/           nginx, pm2, setup and audit scripts
└── _archive/      the DSO original, kept for reference
```

---

## The rules this codebase is held to

Run `npm run audit` to check the first two mechanically.

1. **No colour literal outside `web/src/theme/theme.css`.** Retheming the whole product
   must be possible by editing that one file.
2. **No host, IP or port literal in source.** Every cross-service URL is an env var.
3. **One frontend port (3327), one backend port (4327).** No third port, ever.
4. **Writes over REST, fan-out over the socket.** Every screen must render correctly
   from REST alone; the socket only makes it live.
5. **Nothing calls `Date.now()` for a domain timestamp** — only `lib/clock.js`. This is
   what makes scenario replay, seek and speed control possible.
6. **Every engine returns an `EngineResult`** carrying its method, window, inputs,
   factors and confidence. An engine that returns a bare number cannot be displayed.
7. **Archive, never delete** anything a person is accountable for.
8. **No screen presents synthesised data as real.** Panels fed by a mock carry a
   permanent "simulated source" chip.

---

## Commands

| | |
|---|---|
| `npm run dev` | Both servers |
| `npm run dev:lan` | Both, with HTTPS, bound to the LAN |
| `npm run build` | Production frontend build |
| `npm run seed` | Rebuild the 24-month history |
| `npm run seed:verify` | Assert the calibration targets; fails on drift |
| `npm run seed:reset` | Remove everything a scenario created and restore the resting state (fleet at rest, four mid-flight incidents, relative to now) |
| `npm run seed:resting` | Restore only the resting state |
| `npm run test` | Server tests, including engine golden fixtures — no database needed |
| `npm run test:flow` | The Phase 5 dispatch flow against the **running** backend; cleans up after itself |
| `npm run audit` | Theme + env discipline |
| `npm run typecheck` | Frontend types |

---

## Status

Phases 0, 1, 3, 4 and 5 are complete and verified; Phase 2 is verified except for its
seed-timing target. See [`docs/11-BUILD-PLAN.md`](docs/11-BUILD-PLAN.md).

> **Demo day:** the seeded history ends when `npm run seed` last ran, so the KPI strip's
> "today" is empty on any later day until live incidents arrive. Re-seed on the day, or
> accept an honest zero. `npm run seed:reset` refreshes the resting incidents to now.

| Phase | State |
|---|---|
| 0 · Repository restructure | done |
| 1 · Backend skeleton, schema, auth, audit, clock | done — schema applied (PostgreSQL 18 + PostGIS 3.6) |
| 2 · Reference data and seed | seeded; all 15 `seed:verify` calibration checks pass. The "under 5 minutes from empty" target is **not yet measured** |
| 3 · Theme system and app shell | done |
| 4 · Map architecture | done — `web/src/shared/map`; DSOMap archived to [`_archive/dso-map`](_archive/dso-map/MIGRATION.md). Layers without a live source yet (incidents, units, analytical, agency feeds) are verified against lab fixtures |
| 5 · Operations, dispatch, realtime | done — create, recommend (with the full "why"), dispatch, track every stage, close, from the console; live over the socket; resting state. Coverage cost is a proxy until 6.4, pre-empt corridor waits for 6.7 |
| 6 · Intelligence engines | not started |
| 7 · The five pillar pages | placeholders that say so |
| 8 · Mobile surfaces | shell only |
| 9–12 | not started |
