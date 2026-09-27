/**
 * Every layer in the product. A surface builds its MapView from a subset of these;
 * nothing else in the codebase draws on a map.
 */

import type { LayerDescriptor } from '../layerRegistry';
import { zonesLayer } from './zones';
import { detailLayer } from './detail';
import { aedsLayer, hospitalsLayer, stationsLayer } from './facilities';
import { makaniLayer } from './makani';
import { routesLayer } from './routes';
import { responsesLayer } from './responses';
import { unitsLayer } from './units';
import { incidentsLayer } from './incidents';
import { liveResponseLayer } from './liveResponse';
import { decisionLayer } from './decision';
import { buildingsLayer } from './buildings';
import { coverageLayer } from './coverage';
import { riskLayer } from './risk';
import { demandLayer } from './demand';
import { crowdLayer } from './crowd';
import { hotspotLayer } from './hotspot';
import { trafficLayer } from './agency/traffic';
import { camerasLayer } from './agency/cameras';
import { bmsLayer } from './agency/bms';
import { waterLayer } from './agency/water';
import { wasteLayer } from './agency/waste';
import { airQualityLayer, pollutionLayer, windLayer } from './agency/environment';

export { unitPoints, type UnitPoint } from './units';
export { responsesLayer, type ResponsesData, type ResponseRoute, type ResponseLeg } from './responses';
export { radialLayer, type RadialData, type RadialPoint } from './radial';
export { geoDensityLayer, GEO_RAMP, type GeoDensityData, type GeoMode } from './geoDensity';
export { vehicleLayers, vehicleScale, metresPerPixel, FLAT } from './vehicle3d';
export { replayLayer, type ReplayData } from './replay';
export { incidentsLayer } from './incidents';
export { decisionLayer, EMPTY_DECISION, type DecisionOverlayData, type DecisionCandidateMark } from './decision';
export { unitsLayer } from './units';
export { liveResponseLayer } from './liveResponse';
export type { LiveResponseData, LiveResponse, LiveAlert } from './liveResponse';
export { buildingsLayer } from './buildings';
export { zonesLayer } from './zones';
export { stationsLayer, hospitalsLayer } from './facilities';
export type { ZonesData } from './zones';
export type { DetailData } from './detail';
export type { RouteOverlay, RoutesData } from './routes';
export type { CoverageArea, CoverageData } from './coverage';
export type { RiskCell, RiskData } from './risk';
export type { DemandData, DemandPoint } from './demand';
export type { ChokePoint, CrowdData, CrowdDensityPoint, FruinLoS } from './crowd';
export type { HotspotCluster, HotspotData, KdePoint } from './hotspot';
export type { TrafficFeed, SignalPoint, CongestionSegment, TrafficAccident } from './agency/traffic';
export { camerasLayer, camerasFeed, viewCone } from './agency/cameras';
export type { CamerasFeed } from './agency/cameras';
export { detectIntersections, snapToIntersection, matchCongestion, cctvClip } from './agency/traffic';
export type { BmsBuilding, BmsFeed, BmsMode } from './agency/bms';
export type { WaterFeed, WaterNode, WaterPipe, WaterBreak } from './agency/water';
export type { WasteBin, WasteFeed } from './agency/waste';
export type { AirSensor, PollutionSource, WindVector } from './agency/environment';

/** Reference geography and facilities. */
export const REFERENCE_LAYERS: LayerDescriptor[] = [detailLayer, zonesLayer, stationsLayer, hospitalsLayer, aedsLayer, makaniLayer, buildingsLayer];

/** What is happening now. */
export const OPERATIONAL_LAYERS: LayerDescriptor[] = [liveResponseLayer, incidentsLayer, unitsLayer, responsesLayer, routesLayer, coverageLayer];

/**
 * The live operations map (shared/map/live/). A deliberately short list: the live
 * response picture, the fleet, the facilities it uses, and the city it happens in.
 * Everything analytical is left off — this surface answers "what is happening", and a
 * risk surface underneath a live call is noise at the moment it matters.
 */
export const LIVE_OPS_LAYERS: LayerDescriptor[] = [
  liveResponseLayer, decisionLayer, unitsLayer, incidentsLayer, hospitalsLayer, stationsLayer, zonesLayer, buildingsLayer,
  // Road watch is not a second map. The junction signals, the corridor congestion and the
  // camera estate are LAYERS on the one operations map — the same picture the Dashboard
  // and the wall view already show. A separate page would mean two answers to "what is
  // happening", which is one too many.
  //
  // The building-management layer is not in the list any more. It existed for the indoor
  // scenario, and the trial watches the road (server/config/poc.js): seven building
  // status plates the operator had no reason to read were seven more things on the map.
  camerasLayer, trafficLayer,
];

/** Engine outputs drawn as surfaces — Pillar 3. */
export const ANALYTICAL_LAYERS: LayerDescriptor[] = [riskLayer, demandLayer, crowdLayer, hotspotLayer];

/** The five agency feeds re-framed from the DSO modules (docs/00 D-06). */
export const AGENCY_LAYERS: LayerDescriptor[] = [
  camerasLayer, trafficLayer, bmsLayer, waterLayer, wasteLayer, airQualityLayer, pollutionLayer, windLayer,
];

export const ALL_LAYERS: LayerDescriptor[] = [...OPERATIONAL_LAYERS, ...ANALYTICAL_LAYERS, ...AGENCY_LAYERS, ...REFERENCE_LAYERS];

/** The ambulance service's console: no partner-agency feeds (RTA, Civil Defence, DEWA,
 *  Municipality) — those stay available to the map lab, not to the DCAS operator. */
export const DCAS_LAYERS: LayerDescriptor[] = [...OPERATIONAL_LAYERS, ...ANALYTICAL_LAYERS, ...REFERENCE_LAYERS];
