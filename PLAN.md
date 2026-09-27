# ERSS Dubai — Transformation Plan

**Astrikos Emergency Response Support System · Dubai Corporation for Ambulance Services (DCAS)**

Document set version 1.0 · 16 September 2026 · Status: **awaiting review**

---

## What this is

This repository currently holds **DSO** — a Dubai Silicon Oasis smart-city digital-twin
PoC (React + MapLibre + deck.gl frontend, FastAPI/PostGIS GIS service, Node Socket.IO
dispatch server). This document set plans its transformation into **ERSS Dubai**: a
six-pillar Emergency Response Support System built for DCAS, matching the capability
areas in `Astrikos_ERSS_Concept_Note_UAE.pdf` and the specification lines in
`ERSS_Six_Item_Platform_Suite_Technical_Functional_Specifications.pdf`.

Nothing has been implemented yet. **Read, correct, then approve** — the build begins
against the agreed plan.

---

## Read in this order

| # | File | What it settles |
|---|------|-----------------|
| 00 | [Decisions](docs/00-DECISIONS.md) | Every choice made, why, and what it rules out. Read first. |
| 01 | [Vision & scope](docs/01-VISION-AND-SCOPE.md) | The product, its users, the six pillars, what is in and out of scope |
| 02 | [Architecture](docs/02-ARCHITECTURE.md) | Repo layout, stack, process model, ports, surface routing |
| 03 | [Domain model](docs/03-DOMAIN-MODEL.md) | Entities, identifiers, state machines, full Postgres schema |
| 04 | [API & socket contract](docs/04-API-AND-SOCKET-CONTRACT.md) | Every REST route, every socket event, every payload |
| 05 | [Design system](docs/05-DESIGN-SYSTEM.md) | Amber-on-graphite theme, tokens, component specs, map styling |
| 06 | [Console specification](docs/06-CONSOLE-SPEC.md) | Every screen of the command console, pillar by pillar |
| 07 | [Mobile app specification](docs/07-MOBILE-APP-SPEC.md) | `/app` — responder and citizen surfaces, Capacitor build |
| 08 | [Intelligence engines](docs/08-INTELLIGENCE-ENGINES.md) | Every algorithm, its inputs, its outputs, its explainability |
| 09 | [Data & seed](docs/09-DATA-AND-SEED.md) | Dubai reference geography, 24-month synthetic history, generators |
| 10 | [Scenarios](docs/10-SCENARIOS.md) | Scripted end-to-end runs, grounded in real recorded incidents |
| 11 | [Build plan](docs/11-BUILD-PLAN.md) | Phased execution, task breakdown, definition of done |
| 12 | [Deployment](docs/12-DEPLOYMENT.md) | Ports 3327/4327, nginx, pm2, LAN testing, Android build |
| 13 | [Research gaps](docs/13-RESEARCH-GAPS.md) | Gemini deep-research prompts to close open questions |
| 14 | [Migration map](docs/14-MIGRATION-MAP.md) | What happens to every existing file in the repo |

---

## The shape of it, in one page

```
                        ┌──────────────────────────────────────────┐
                        │  ERSS Dubai — one Vite bundle : 3327     │
                        │                                          │
    Control room  ──────│  /       Command console                 │
    Video wall          │          Operations · Collaborate ·      │
                        │          Ranking · Analytics ·           │
                        │          Intelligence · Advisories ·     │
                        │          Executive · Agencies · Admin    │
                        │                                          │
    Phone / APK  ───────│  /app    Mobile — role chosen at login   │
                        │          ├ responder  (ambulance crew,   │
                        │          │             PRV, fire unit)   │
                        │          └ citizen    (SOS, live ETA)    │
                        └────────────────────┬─────────────────────┘
                                             │ REST + Socket.IO
                                             │ one origin, one port
                        ┌────────────────────▼─────────────────────┐
                        │  Node backend — Express 5 + Socket.IO    │
                        │  single process : 4327                   │
                        │                                          │
                        │  routes/    REST API + GeoJSON layers    │
                        │  engines/   13 deterministic engines     │
                        │  sim/       scenario script runner       │
                        │  lib/llm.js optional assistant seam      │
                        └────────────────────┬─────────────────────┘
                                             │
                        ┌────────────────────▼─────────────────────┐
                        │  PostgreSQL 16 + PostGIS                 │
                        │  operational store + 24 months history   │
                        └──────────────────────────────────────────┘

    Basemap: CARTO dark vector tiles (no OSM import required)
    Routing: OSRM (public or self-hosted)
```

---

## The six pillars, mapped to screens

| Pillar (BoQ item) | Console route | Backing engines |
|---|---|---|
| 1 · Collaborative Intelligence | `/collaborate` | `responseTime`, `sla`, `escalation`, `replay` |
| 2 · Performance Ranking | `/ranking` | `ranking` |
| 3 · ML & Geospatial Analytics | `/analytics` | `risk`, `demand`, `crowd`, `hotspot`, `radial` |
| 4 · Business & Data Intelligence | `/intelligence` | `reportBuilder`, `dataQuality`, `lineage` |
| 5 · Artificial Intelligence | `/advisories` | `advisory`, `anomaly`, `coverage`, `dispatch`, `whatIf` |
| 6 · Executive Dashboard | `/executive` | all of the above, aggregated |

Operations (`/`), Agencies (`/agencies`) and Admin (`/admin`) sit alongside as the
live-working and supporting surfaces.

---

## Non-negotiables carried into the build

1. **One frontend port 3327, one backend port 4327.** No third port, ever.
2. **No hex literal in any component.** Every colour is a `var(--app-*)` token.
3. **Every advisory cites its evidence.** Data sources, window analysed, confidence.
   The Concept Note promises "explainable by construction" — the UI must show it.
4. **No external model call is required for anything to work.** The LLM seam is
   optional and never throws; every pillar functions with the network unplugged.
5. **Writes over REST, fan-out over socket.** The socket is enrichment, never the
   only path to a piece of state.
6. **Archive, never delete**, for anything a person is accountable for.
7. **English only, i18n-ready.** Every user-facing string goes through `t()` from
   day one so an Arabic pack can be added later without rework.

---

## Open items requiring your input

These are listed in full at the end of [00-DECISIONS](docs/00-DECISIONS.md#open-items).
The two that block Phase 1:

- **Postgres credentials.** Port 5432 is listening on this machine but I have not
  verified what is on it. I need either the existing superuser credentials, or your
  go-ahead to create a fresh `erss_db` with a dedicated role.
- **Whether `git init` is acceptable.** This is not currently a git repository. The
  transformation touches or moves nearly every file; without version control it is
  not reversible. Phase 0 task 1 is `git init` + a baseline commit of the DSO code.
