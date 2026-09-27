# DSO map — archived after the Phase 4 decomposition

`src/components/DSOMap/DSOMap.tsx` is the **original** 2,823-line DSO map, exactly as it
stood before Phase 4 (docs/11-BUILD-PLAN.md). The three utilities beside it were ported
with it and are also unchanged. Nothing here is compiled or imported; it is kept so
"what did the DSO version do here?" always has an answer. This repository has no version
control, so this copy *is* that history.

The map now lives in `web/src/shared/map/`: one `MapCanvas`, one deck.gl overlay, and a
layer registry in which every layer is a descriptor.

## Where each domain went

Migrated in this order, one domain at a time. After each step the new layer was
screenshot-checked in the map lab (`/?maplab` under `vite dev`), and the domain's code was
removed from the legacy file.

| DSOMap.tsx domain | Now | Notes |
|---|---|---|
| Basemap, map instance, controls, the deck overlay | `MapCanvas.tsx`, `DeckOverlay.ts`, `styleReconciler.ts`, `camera.ts` | Basemap per theme from `VITE_MAP_STYLE` / `VITE_MAP_STYLE_LIGHT`; `DSO_CAMERA` keeps the DSO centre, zoom, pitch 50 and bearing −55 |
| API detail layers: parks, water, roads, railways, buildings, POIs, infrastructure, road/POI popups, building/infra select | `layers/detail.ts`, `popups/DetailPopups.tsx` | Neon cyan → `--map-*` tokens; the Material POI sprite → lucide glyphs; the hard-coded `dso_api` host → `/api/layers/all` |
| DSO district boundary | `layers/zones.ts` | DSO is one community of fifty-one |
| Incident overlay, alert popup, technician route and marker | `layers/incidents.ts`, `layers/routes.ts`, `layers/units.ts` | The simulator's overlay is superseded by the scenario engine; the P1 alert returns on the console in Phase 5 |
| AccidentTask / WaterTask / WasteTask responder tracking | `layers/units.ts`, `layers/routes.ts` | `trimRoute` → `geometry.ts` `remaining()` |
| Traffic signals, intersections, congestion, CCTV, accident marker | `layers/agency/traffic.ts`, `popups/AgencyPopups.tsx` | `detectIntersections`, `snapSignalToIntersection`, `enrichRoadsWithCongestion` moved as pure helpers; the second hard-coded host is gone |
| Emergency vehicle animation + OSRM fetch | `layers/units.ts` + `layers/routes.ts`; `lib/routing.ts` | Vehicles are units on routes in ERSS; animation by distance, not vertex count (`geometry.ts` `along()`) |
| BMS building overlay | `layers/agency/bms.ts` | Nearest-building matching now capped at 200 m |
| Water pipeline network | `layers/agency/water.ts` | Pipe class by width, status by colour; an isolated pipe is dashed |
| Waste bins | `layers/agency/waste.ts` | Overflow = filled danger disc + pulse |
| Environment (`utils/environmentLayers.ts`) and its hover tooltips | `layers/agency/environment.ts` (three descriptors) | AQI surface on the sequential ramp; tooltips → click popups |
| `utils/poiIcons.ts` | `icons/glyphs.ts`, `icons/shapes.ts` | Mechanism kept (category → generated icon); lucide as the one icon family, colour from tokens via deck.gl mask icons |
| `utils/trafficIcons.ts` | `layers/agency/traffic.ts`, `popups/AgencyPopups.tsx` | react-icons HTML markers → deck.gl; `setHTML` popups → React |

## Not carried forward

- The `IncidentSimulator` incident zone and its `EFFECT_COLOR` palette — replaced by the
  scenario engine (Phase 10) and the priority encoding in docs/05 §5.4.
- The Schneider/NEST special case on building click — the BMS layer emits a plain
  selection; opening the twin is the page's decision (Phase 9).
- The "Dubai Silicon Oasis" badge.
- `_legacy/App.tsx` still imports `DSOMap`. That file is marked REPLACE in
  docs/14-MIGRATION-MAP.md, is excluded from the typecheck and is not mounted by either
  surface; its import is now dangling, and is annotated as such.
