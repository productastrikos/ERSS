import { useEffect, useRef, useState } from 'react';
import { OSRM_URL } from '../../config';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { DSO_BOUNDARY_GEOJSON } from '../../data/dsoBoundary';
import type { LayerVisibility, TooltipInfo, SelectedBuilding, SelectedInfra, ActiveIncidentState, TrafficState, TrafficSignal, EnvironmentLayerVisibility, BMSLayerMode } from '../../types';
import type { AccidentTask, WaterTask, WasteTask } from '../../data/responders';
import { ROLE_COLORS } from '../../data/responders';
import { WASTE_BINS, fillColor, fillLabel, BIN_TYPE_ICON } from '../../data/wasteBins';
import { bmsBuildings, getBuildingColor } from '../../data/bmsBuildings';
import type { BMSBuilding } from '../../data/bmsBuildings';
import { EFFECT_COLOR } from '../../data/incidents';
import { SIGNAL_COLOR, CONGESTION_COLOR } from '../../data/trafficSignals';
import BuildingTooltip from '../BuildingTooltip/BuildingTooltip';
import IncidentAlertPopup from '../IncidentAlertPopup/IncidentAlertPopup';
import { registerPoiIcons, poiIconImageExpression, poiIconSizeExpression, registerInfraStructures, infraStructureImageExpression, infraStructureSizeExpression } from '../../utils/poiIcons';
import {
  signalMarkerHTML,
  cctvMarkerHTML,
  cctvPopupHTML,
  signalInfoPopupHTML,
  vehicleMarkerHTML,
  drawIntersectionNodeImage,
  VEHICLE_COLOR,
} from '../../utils/trafficIcons';
import { createEnvironmentLayers } from '../../utils/environmentLayers';
import type { EnvironmentSensor } from '../../data/environmentSensors';
import type { PollutionSource } from '../../data/pollutionSources';

// ── Map each signal (by index 0-11) to a public CCTV video ───────────────────
const SIGNAL_VIDEOS: string[] = [
  '/traffic_cctv_1.mp4',
  '/traffic_cctv_2.mp4',
  '/traffic_cctv_3.mp4',
  '/traffic_cctv_4.mp4',
  '/traffic_cctv_5.mp4',
  '/traffic_cctv_6.mp4',
  '/traffic_cctv_7.mp4',
  '/traffic_cctv_8.mp4',
  '/traffic_cctv_9.mp4',
  '/traffic_cctv_10.mp4',
  '/traffic_cctv_11.mp4',
  '/traffic_cctv_12.mp4',
  '/traffic_cctv_13.mp4',
];

import './DSOMap.scss';

// ── Traffic signal icon renderer (canvas → MapLibre ImageData) ────────────────
// Draws a realistic 3-light traffic signal pole, highlights the active lamp.
function drawSignalIcon(state: 'RED' | 'YELLOW' | 'GREEN' | 'FLASHING'): { data: Uint8Array; width: number; height: number } {
  const W = 20, H = 36;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Housing — dark rounded rectangle
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.roundRect(2, 0, W - 4, 26, 4);
  ctx.fill();
  ctx.strokeStyle = '#4a4a6a';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Highlight border based on state
  const borderColors: Record<string, string> = { RED: '#ef4444', YELLOW: '#f59e0b', GREEN: '#22c55e', FLASHING: '#f97316' };
  ctx.strokeStyle = borderColors[state];
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(2, 0, W - 4, 26, 4);
  ctx.stroke();

  // Three lamps: [y-center, color, state-key]
  const LAMPS: [number, string, string][] = [
    [5,  '#ef4444', 'RED'],
    [13, '#f59e0b', 'YELLOW'],
    [21, '#22c55e', 'GREEN'],
  ];

  LAMPS.forEach(([cy, color, lampState]) => {
    const isOn = state === lampState || (state === 'FLASHING' && lampState === 'RED');

    // Lens background
    ctx.beginPath();
    ctx.arc(W / 2, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = isOn ? color : 'rgba(30, 30, 50, 0.9)';
    ctx.fill();

    if (isOn) {
      // Inner glow
      const grad = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, 4);
      grad.addColorStop(0, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(W / 2, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      // Dim ring
      ctx.beginPath();
      ctx.arc(W / 2, cy, 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(100,100,130,0.5)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  });

  // Pole
  ctx.fillStyle = '#555';
  ctx.fillRect(W / 2 - 2, 26, 4, 10);

  const imgData = ctx.getImageData(0, 0, W, H);
  return { data: new Uint8Array(imgData.data.buffer), width: W, height: H };
}

function registerSignalIcons(map: maplibregl.Map) {
  (['RED', 'YELLOW', 'GREEN', 'FLASHING'] as const).forEach((state) => {
    const id = `signal-${state}`;
    if (!map.hasImage(id)) {
      map.addImage(id, drawSignalIcon(state));
    }
  });
}

// ── OSM intersection detection from GeoJSON road network ─────────────────────
// A real intersection = coordinate node shared by coordinate sets of ≥3 distinct road ways.
interface DetectedIntersection {
  coords:     [number, number]; // [lng, lat]
  roadCount:  number;
}

function detectIntersections(fc: GeoJSON.FeatureCollection): DetectedIntersection[] {
  // Map: rounded-coord key → set of osm_ids passing through that node
  const nodeOwners = new Map<string, Set<number | string>>();
  const nodeCoords = new Map<string, [number, number]>();

  for (const feature of fc.features) {
    const geom = feature.geometry as GeoJSON.Geometry;
    if (geom.type !== 'LineString') continue;
    const osmId = (feature.properties as Record<string, unknown>)?.osm_id ?? Math.random();
    for (const coord of (geom as GeoJSON.LineString).coordinates) {
      const key = `${coord[0].toFixed(4)}_${coord[1].toFixed(4)}`;
      if (!nodeOwners.has(key)) {
        nodeOwners.set(key, new Set());
        nodeCoords.set(key, [coord[0], coord[1]]);
      }
      nodeOwners.get(key)!.add(osmId as number);
    }
  }

  const intersections: DetectedIntersection[] = [];
  for (const [key, owners] of nodeOwners) {
    if (owners.size >= 3) {
      intersections.push({ coords: nodeCoords.get(key)!, roadCount: owners.size });
    }
  }
  return intersections;
}

// ── Snap traffic signals to nearest detected OSM intersection ────────────────
// Max snap radius: ~300 m (≈ 0.003°).
function snapSignalToIntersection(
  signal: TrafficSignal,
  intersections: DetectedIntersection[],
): [number, number] {
  const SNAP_DEG = 0.003;
  let best: DetectedIntersection | null = null;
  let bestDist = Infinity;
  const [sLng, sLat] = signal.location;

  for (const inx of intersections) {
    const dLng = inx.coords[0] - sLng;
    const dLat = inx.coords[1] - sLat;
    const dist = Math.sqrt(dLng * dLng + dLat * dLat);
    if (dist < SNAP_DEG && dist < bestDist) { bestDist = dist; best = inx; }
  }
  return best ? best.coords : signal.location;
}

// ── Build signal GeoJSON from current state (with optional snapped positions) ─
function buildSignalGeoJSON(
  signals: TrafficSignal[],
  snappedPositions?: Map<string, [number, number]>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: signals.map((s) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: snappedPositions?.get(s.signal_id) ?? s.location,
      },
      properties: {
        signal_id:       s.signal_id,
        name:            s.name,
        state:           s.state,
        vehicle_density: s.vehicle_density,
        connected_roads: s.connected_roads,
        color:           SIGNAL_COLOR[s.state] ?? '#888',
      },
    })),
  };
}

// ── Enrich API road GeoJSON with congestion colours ──────────────────────────
// Matches API road names (from OSM) to simulation road segments by substring.
function enrichRoadsWithCongestion(
  fc: GeoJSON.FeatureCollection,
  simRoads: TrafficState['roads'],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const osmName: string = ((f.properties as Record<string, unknown>)?.name as string) ?? '';
      // Transparent fallback — only color roads that clearly match a sim segment.
      // Use STRICT matching: both names must share >=5 chars in common, and neither
      // can be a short fragment that accidentally matches many roads.
      let congColor = 'rgba(0,0,0,0)'; // invisible for unmatched roads
      if (osmName.length >= 5) {
        for (const road of simRoads) {
          const simClean = road.name.toLowerCase().replace(/ \(.*\)/, '').trim();
          const osmClean = osmName.toLowerCase().trim();
          // Require the shared fragment to be at least 6 chars
          const matchLen = longestCommonSubstr(simClean, osmClean);
          if (matchLen >= 6) {
            congColor = CONGESTION_COLOR[road.congestion_level] ?? congColor;
            break;
          }
        }
      }
      return { ...f, properties: { ...(f.properties as object), cong_color: congColor } };
    }),
  };
}

/** Find length of longest common substring between two strings */
function longestCommonSubstr(a: string, b: string): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let l = 0;
      while (i + l < a.length && j + l < b.length && a[i + l] === b[j + l]) l++;
      if (l > max) max = l;
    }
  }
  return max;
}

// ── OSRM road-following route (free OSM routing engine) ──────────────────────
// Fetches the actual road path between two coordinates via OSRM public API.
// Falls back to a straight-line segment if the request fails.
async function fetchRoadRoute(
  start: [number, number],
  end: [number, number],
): Promise<[number, number][]> {
  try {
    const url =
      `${OSRM_URL}/route/v1/driving/` +
      `${start[0]},${start[1]};${end[0]},${end[1]}` +
      `?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    const coords: [number, number][] = data.routes?.[0]?.geometry?.coordinates ?? [];
    if (coords.length > 1) return coords;
  } catch (e) {
    console.warn('[OSRM] routing failed, using straight line:', e);
  }
  // Fallback: 40-point straight line so animation still works
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
  }
  return pts;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [55.38718, 25.11985];
const MAP_CONFIG = {
  zoom: 14.5,
  pitch: 50,       // matches 2GIS p/50
  bearing: -55,    // matches 2GIS r/-55
  minZoom: 12,
  maxZoom: 20,
};

// ── Remote API endpoints ─────────────────────────────────────────────────
const API_BASE = 'https://dso_api.astrikos.xyz:8443';
const API_ENDPOINTS = {
  roads:          `${API_BASE}/roads`,
  buildings:      `${API_BASE}/buildings`,
  pois:           `${API_BASE}/pois`,
  parks:          `${API_BASE}/parks`,
  water:          `${API_BASE}/water`,
  railways:       `${API_BASE}/railways`,
  infrastructure: `${API_BASE}/infrastructure`,
} as const;

// CARTO base map style URLs — switch by passing mapStyleUrl prop
export const CARTO_STYLES = {
  positron:    'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  darkMatter:  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  voyager:     'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
} as const;

const DEFAULT_MAP_STYLE = CARTO_STYLES.darkMatter;

// ── Incident zone helper ─────────────────────────────────────────────────────
function makeCircleGeoJSON(center: [number, number], radiusM: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = center;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([
      lng + (radiusM / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a),
      lat + (radiusM / 111320) * Math.cos(a),
    ]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

// ── BMS building spatial-match helpers ────────────────────────────────────────
/** Compute centroid [lng, lat] from a GeoJSON Polygon or MultiPolygon feature */
function featureCentroid(feature: GeoJSON.Feature): [number, number] {
  const geom = feature.geometry;
  let pts: number[][] = [];
  if (geom.type === 'Polygon') pts = geom.coordinates[0];
  else if (geom.type === 'MultiPolygon') pts = geom.coordinates.flatMap((p) => p[0]);
  if (!pts.length) return [0, 0];
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ] as [number, number];
}

/** Approximate distance in metres between two [lng, lat] points */
function approxDistM(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * 111320;
  const dLng = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Convert 0-255 r/g/b to "#rrggbb" */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}

// (colour palette removed — native MapLibre paint properties used directly)

// ── Component ─────────────────────────────────────────────────────────────────

interface DSOMapProps {
  visibility:          LayerVisibility;
  onBuildingSelect:    (b: SelectedBuilding | null) => void;
  onInfraSelect:       (infra: SelectedInfra | null) => void;
  mapStyleUrl?:        string;
  activeIncident?:     ActiveIncidentState | null;
  /** Called when user clicks "Begin Response" inside the alert popup */
  onAlertAcknowledged?: () => void;
  /** Live traffic simulation state — drives signal & congestion map layers */
  trafficState?:       TrafficState | null;
  /** Ref to expose map instance to parent (for programmatic control) */
  mapRef?:             React.MutableRefObject<maplibregl.Map | null>;
  /** Called when user clicks the Schneider Electric smart building marker */
  onSchneiderBuildingClick?: () => void;
  /** Environment sub-layer visibility controls */
  envLayers?:          EnvironmentLayerVisibility;
  /** BMS City overlay — show colored building dots on map */
  bmsActive?:          boolean;
  bmsLayerMode?:       BMSLayerMode;
  onBMSBuildingClick?: (building: BMSBuilding) => void;
  /** Live AccidentTask data from AccidentResponsePanel — drives responder tracking markers */
  accidentTasks?:      AccidentTask[];
  /** Live WaterTask data from WaterPipelinePanel — drives water crew tracking markers */
  waterTasks?:         WaterTask[];
  /** Live WasteTask data from SmartWastePanel — drives waste crew tracking markers */
  wasteTasks?:         WasteTask[];
  /** Smart Waste overlay — show bin markers on map */
  wasteActive?:        boolean;
  /** Which bin is currently overflowing (gets pulsing red highlight) */
  overflowBinId?:      string | null;
  /** Water Pipeline overlay — show pipeline network on map */
  waterActive?:        boolean;
  waterNodes?:         any[];
  waterPipelines?:     any[];
  waterIncident?:      any;
}

// MapLibre layer IDs grouped by visibility key (populated after API load)
type LayerGroups = Record<string, string[]>;

export default function DSOMap({ visibility, onBuildingSelect, onInfraSelect, mapStyleUrl, activeIncident, onAlertAcknowledged, trafficState, mapRef: externalMapRef, onSchneiderBuildingClick: _onSchneiderBuildingClick, envLayers, bmsActive, bmsLayerMode, onBMSBuildingClick, accidentTasks, waterTasks, wasteTasks, wasteActive, overflowBinId, waterActive, waterNodes, waterPipelines, waterIncident }: DSOMapProps) {
  const containerRef         = useRef<HTMLDivElement>(null);
  const mapRef               = useRef<maplibregl.Map | null>(null);
  const layerGroupsRef       = useRef<LayerGroups>({});
  const incidentMarkerRef    = useRef<maplibregl.Marker | null>(null);
  const techMarkerRef        = useRef<maplibregl.Marker | null>(null);
  const schneiderMarkerRef   = useRef<maplibregl.Marker | null>(null);
  const schneiderPopupRef    = useRef<maplibregl.Popup | null>(null);
  const poiPopupRef          = useRef<maplibregl.Popup | null>(null);
  /** Snapped [lng,lat] positions for each signal_id, derived from OSM intersection detection */
  const snappedPositionsRef  = useRef<Map<string, [number, number]>>(new Map());
  /** Last-fetched API roads FeatureCollection (cached so congestion overlay can update cheaply) */
  const apiRoadsFcRef        = useRef<GeoJSON.FeatureCollection | null>(null);
  /** Deck.gl overlay for environment visualization layers */
  const deckOverlayRef       = useRef<MapboxOverlay | null>(null);
  /** HTML markers for traffic signal react-icons */
  const signalMarkersRef     = useRef<maplibregl.Marker[]>([]);
  /** HTML markers for CCTV cameras at each signal + accident */
  const cctvMarkersRef       = useRef<maplibregl.Marker[]>([]);
  /** HTML markers for animated emergency vehicles */
  const vehicleMarkersRef    = useRef<maplibregl.Marker[]>([]);
  /** Interval ID for vehicle animation loop */
  const vehicleAnimRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Popup for CCTV feed preview */
  const cctvPopupRef         = useRef<maplibregl.Popup | null>(null);
  /** Popup for signal info click */
  const signalInfoPopupRef   = useRef<maplibregl.Popup | null>(null);
  /** Raw API buildings GeoJSON — stored on load for BMS spatial matching */
  const apiBuildingsRef      = useRef<GeoJSON.FeatureCollection | null>(null);
  /** HTML markers for AccidentTask/WaterTask/WasteTask live responder tracking */
  const taskMarkersRef       = useRef<Map<string, maplibregl.Marker>>(new Map());
  /** HTML markers for IoT waste bin locations */
  const wasteBinMarkersRef   = useRef<maplibregl.Marker[]>([]);

  /** Trim a full OSRM route to start from ~currentPos (removes already-traveled portion) */
  function trimRoute(coords: [number, number][], currentPos: [number, number]): [number, number][] {
    if (coords.length < 2) return coords;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const dx = coords[i][0] - currentPos[0];
      const dy = coords[i][1] - currentPos[1];
      const d  = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return [currentPos, ...coords.slice(bestIdx + 1)];
  }
  /** Stable event handler ref for BMS overlay click (allows proper off() cleanup) */
  const bmsClickHandlerRef   = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  /** RAF id for animated traffic-flow dash effect */
  const dashAnimRef          = useRef<number | null>(null);
  /** Interval id for idle signal realistic cycle timer */
  const signalCycleTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * OSRM-fetched real road geometry cache — key = road_id, value = coordinate array.
   * Populated lazily the first time each sim segment is shown so subsequent
   * congestion renders are instant (no repeated API calls).
   */
  const simRoadRoutesRef     = useRef<Map<string, [number, number][]>>(new Map());

  const [mapLoaded,       setMapLoaded]       = useState(false);
  const [tooltip]                             = useState<TooltipInfo | null>(null);
  const [alertPopupOpen,  setAlertPopupOpen]  = useState(false);
  const [alertPopupPos,   setAlertPopupPos]   = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [_selectedSensor,  setSelectedSensor]  = useState<EnvironmentSensor | null>(null);
  const [_selectedSource,  setSelectedSource]  = useState<PollutionSource | null>(null);
  const [envTooltip, setEnvTooltip] = useState<{
    type: 'sensor' | 'source';
    data: EnvironmentSensor | PollutionSource;
    x: number;
    y: number;
  } | null>(null);

  // ── Initialise MapLibre map ────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleUrl ?? DEFAULT_MAP_STYLE,
      center: MAP_CENTER,
      zoom: MAP_CONFIG.zoom,
      pitch: MAP_CONFIG.pitch,
      bearing: MAP_CONFIG.bearing,
      minZoom: MAP_CONFIG.minZoom,
      maxZoom: MAP_CONFIG.maxZoom,
    });

    // Navigation controls (zoom / rotate / pitch)
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

    // Scale bar
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      // ── 1. Restyle base map ──────────────────────────────────────────────
      try {
        // Remove any stray base-map building layers so they don't conflict
        if (map.getLayer('building-3d')) map.removeLayer('building-3d');
        if (map.getLayer('building'))    map.setPaintProperty('building', 'fill-opacity', 0);

        // Directional light tuned for neon dark aesthetic — strong enough to
        // illuminate fill-extrusion side faces without washing out the glow
        map.setLight({
          anchor:    'viewport',
          color:     '#c8e8ff',
          intensity: 0.65,
          position:  [2, 210, 45],
        });
      } catch { /* non-fatal */ }

      // ── 2. Fetch all DSO API layers in parallel ──────────────────────────
      const groups: LayerGroups = {};
      // Shared popup reused for POI & infrastructure icon clicks
      poiPopupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', className: 'dso-poi-popup' });
      const localPoiPopup = poiPopupRef.current;

      // Pre-register POI icons + infra structure icons into the map sprite, then load all layer data
      registerInfraStructures(map);
      registerPoiIcons(map).then(() => Promise.all([
        fetch(API_ENDPOINTS.parks).then((r) => r.json()).catch(() => null),
        fetch(API_ENDPOINTS.water).then((r) => r.json()).catch(() => null),
        fetch(API_ENDPOINTS.roads).then((r) => r.json()).catch(() => null),
        fetch(API_ENDPOINTS.railways).then((r) => r.json()).catch(() => null),
        fetch(API_ENDPOINTS.buildings).then((r) => r.json()).catch(() => null),
        fetch(API_ENDPOINTS.pois).then((r) => r.json()).catch(() => null),
        fetch(API_ENDPOINTS.infrastructure).then((r) => r.json()).catch(() => null),
      ])).then(([parksData, waterData, roadsData, railwaysData, buildingsData, poisData, infraData]) => {

        // ── Parks ────────────────────────────────────────────────────────
        if (parksData) {
          map.addSource('api-parks', { type: 'geojson', data: parksData });
          map.addLayer({ id: 'api-parks-fill', type: 'fill', source: 'api-parks',
            paint: { 'fill-color': '#0d2b1a', 'fill-opacity': 0.8 } });
          map.addLayer({ id: 'api-parks-outline', type: 'line', source: 'api-parks',
            paint: { 'line-color': '#1a5c30', 'line-width': 1 } });
          groups['parks'] = ['api-parks-fill', 'api-parks-outline'];
        }

        // ── Water ────────────────────────────────────────────────────────
        if (waterData) {
          map.addSource('api-water', { type: 'geojson', data: waterData });
          map.addLayer({ id: 'api-water-fill', type: 'fill', source: 'api-water',
            paint: { 'fill-color': '#051826', 'fill-opacity': 0.95 } });
          map.addLayer({ id: 'api-water-outline', type: 'line', source: 'api-water',
            paint: { 'line-color': '#0a3a5c', 'line-width': 1 } });
          groups['water'] = ['api-water-fill', 'api-water-outline'];
        }

        // ── Roads ────────────────────────────────────────────────────────
        if (roadsData) {
          // Cache for traffic congestion overlay + intersection detection
          apiRoadsFcRef.current = roadsData;

          map.addSource('api-roads', { type: 'geojson', data: roadsData });
          map.addLayer({
            id: 'api-roads-casing', type: 'line', source: 'api-roads',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#4a4a56',  // dark gray casing
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 20, 14],
            },
          });
          map.addLayer({
            id: 'api-roads-fill', type: 'line', source: 'api-roads',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              // Base road color: always gray. Traffic overlay (traffic-roads-api-layer)
              // draws on top with green/amber/red congestion colors when module active.
              'line-color': [
                'match', ['get', 'highway'],
                'motorway',             '#9ca3af',   // light gray — motorway
                'trunk',                '#9ca3af',
                'primary',              '#8b949e',   // medium gray — primary
                'secondary',            '#7c838c',
                'tertiary',             '#6b7280',   // standard gray
                'residential',          '#5a616b',   // slightly darker for local
                'service',              '#555962',
                                        '#6b7280',   // fallback gray
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4.5, 20, 10],
              'line-blur': 0.4,
            },
          });
          // Highlight layer — rendered on top of fill, initially shows nothing
          map.addLayer({
            id: 'api-roads-highlight', type: 'line', source: 'api-roads',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            filter: ['==', ['get', 'name'], '__NONE__'],
            paint: {
              'line-color': '#FFD700',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 11, 20, 18],
              'line-opacity': 0.95,
              'line-blur': 2,
            },
          });
          groups['roads'] = ['api-roads-casing', 'api-roads-fill', 'api-roads-highlight'];

          // ── Road click: highlight full road + popup ─────────────────
          const roadPopupRef = new maplibregl.Popup({
            closeButton: true,
            maxWidth: '280px',
            className: 'dso-road-popup',
          });

          const HIGHWAY_LABELS: Record<string, string> = {
            motorway: 'Motorway', trunk: 'Trunk Road', primary: 'Primary Road',
            secondary: 'Secondary Road', tertiary: 'Tertiary Road',
            residential: 'Residential Street', service: 'Service Road',
            unclassified: 'Unclassified', cycleway: 'Cycle Way',
            footway: 'Footway', path: 'Path', pedestrian: 'Pedestrian',
          };

          map.on('click', 'api-roads-fill', (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties as Record<string, string | null>;
            const roadName = p.name ?? p.ref ?? 'Unnamed Road';
            const highway  = p.highway ?? '';

            // Filter highlight to full road by name (or osm_id if unnamed)
            if (p.name) {
              map.setFilter('api-roads-highlight', ['==', ['get', 'name'], p.name]);
            } else {
              map.setFilter('api-roads-highlight', ['==', ['to-string', ['get', 'osm_id']], String(p.osm_id)]);
            }

            // Build info rows
            const infoRow = (icon: string, label: string, val: string) =>
              `<div style="display:flex;gap:8px;align-items:flex-start;padding:3px 0">
                <span style="width:16px;text-align:center;flex-shrink:0">${icon}</span>
                <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">${label}</div>
                <div style="font-size:12px;font-weight:600;color:#ffffff">${val}</div></div></div>`;

            roadPopupRef
              .setLngLat(e.lngLat)
              .setHTML(
                `<div style="font-family:Inter,Segoe UI,sans-serif;padding:4px 2px">
                  <div style="font-weight:700;font-size:14px;color:#ffffff;margin-bottom:8px;line-height:1.3">${roadName}</div>
                  <div style="display:inline-block;background:#FF8C00;color:#ffffff;font-size:10px;font-weight:700;
                       padding:2px 8px;border-radius:10px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
                    ${HIGHWAY_LABELS[highway] ?? highway}
                  </div>
                  <div style="border-top:1px solid #4a5568;padding-top:6px;margin-top:2px">
                    ${p.ref      ? infoRow('🔢', 'Reference',    p.ref)        : ''}
                    ${p.maxspeed ? infoRow('🚗', 'Speed Limit',  p.maxspeed + ' km/h') : ''}
                    ${p.lanes    ? infoRow('🛣️', 'Lanes',        p.lanes)      : ''}
                    ${p.surface  ? infoRow('🪨', 'Surface',      p.surface.replace(/_/g,' ')) : ''}
                    ${p.oneway === 'yes' ? infoRow('↗️', 'Direction', 'One-way') : ''}
                    ${p.bridge === 'yes' ? infoRow('🌉', 'Structure', 'Bridge')  : ''}
                    ${p.tunnel === 'yes' ? infoRow('🚇', 'Structure', 'Tunnel')  : ''}
                  </div>
                </div>`,
              )
              .addTo(map);
          });

          map.on('mouseenter', 'api-roads-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', 'api-roads-fill', () => { map.getCanvas().style.cursor = ''; });
        }

        // ── Railways ─────────────────────────────────────────────────────
        if (railwaysData) {
          map.addSource('api-railways', { type: 'geojson', data: railwaysData });
          map.addLayer({
            id: 'api-railways-line', type: 'line', source: 'api-railways',
            layout: { 'line-cap': 'butt', 'line-join': 'miter' },
            paint: { 'line-color': '#3a4a6a', 'line-width': 2.5, 'line-dasharray': [5, 3] },
          });
          groups['railways'] = ['api-railways-line'];
        }

        // ── Buildings (3-D fill-extrusion) ───────────────────────────────
        if (buildingsData) {
          map.addSource('api-buildings', { type: 'geojson', data: buildingsData });
          // Cache the raw data so the BMS overlay effect can spatially match it
          apiBuildingsRef.current = buildingsData;

          // ── Neon footprint outline (gives the glowing border look) ──────
          map.addLayer({
            id: 'api-buildings-outline', type: 'line', source: 'api-buildings',
            paint: {
              'line-color': '#00E5FF',
              'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 1.2, 20, 2],
              'line-opacity': 0.6,
              'line-blur': 1,
            },
          });

          // ── Building highlight layer (neon amber, initially hidden) ──────
          map.addLayer({
            id: 'api-buildings-highlight', type: 'fill-extrusion', source: 'api-buildings',
            filter: ['==', ['to-string', ['get', 'osm_id']], '__NONE__'],
            paint: {
              'fill-extrusion-height': [
                'case',
                ['>', ['to-number', ['get', 'height'], 0], 0], ['to-number', ['get', 'height'], 0],
                ['>', ['to-number', ['get', 'levels'], 0], 0], ['*', ['to-number', ['get', 'levels'], 0], 3],
                15,
              ],
              'fill-extrusion-base': ['to-number', ['get', 'min_height'], 0],
              'fill-extrusion-color': '#FFD700',
              'fill-extrusion-opacity': 1,
              'fill-extrusion-vertical-gradient': true,
            },
          });
          map.addLayer({
            id: 'api-buildings-3d', type: 'fill-extrusion', source: 'api-buildings',
            paint: {
              'fill-extrusion-height': [
                'case',
                ['>', ['to-number', ['get', 'height'], 0], 0],
                  ['to-number', ['get', 'height'], 0],
                ['>', ['to-number', ['get', 'levels'], 0], 0],
                  ['*', ['to-number', ['get', 'levels'], 0], 3],
                15,
              ],
              'fill-extrusion-base': ['to-number', ['get', 'min_height'], 0],
              // Neon cyan → electric blue gradient; The NEST (osm_id -999001) → indigo
              'fill-extrusion-color': [
                'case',
                ['==', ['to-number', ['get', 'osm_id'], 0], -999001], '#6366F1',
                [
                  'step',
                  [
                    'case',
                    ['>', ['to-number', ['get', 'height'], 0], 0],
                      ['to-number', ['get', 'height'], 0],
                    ['>', ['to-number', ['get', 'levels'], 0], 0],
                      ['*', ['to-number', ['get', 'levels'], 0], 3],
                    15,
                  ],
                  '#00E5FF',    //  0 – 14 m : neon cyan
                  15, '#00BFFF', // 15 – 34 m : deep sky-blue
                  35, '#0099FF', // 35 – 59 m : electric blue
                  60, '#0066FF', // 60 – 99 m : vivid blue
                  100,'#4040FF', // 100 m+    : bright indigo
                ],
              ],
              'fill-extrusion-opacity': 0.92,
              'fill-extrusion-vertical-gradient': true,
            },
          });
          // ── Building name / code labels ──────────────────────────────────
          map.addLayer({
            id: 'api-buildings-label',
            type: 'symbol',
            source: 'api-buildings',
            minzoom: 15,
            layout: {
              // Show name if present; otherwise show housenumber (addr:housenumber)
              'text-field': ['coalesce', ['get', 'name'], ['get', 'housenumber'], ''],
              'text-size': [
                'interpolate', ['linear'], ['zoom'],
                15, 9,
                17, 11,
                19, 13,
              ],
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-anchor': 'center',
              'text-max-width': 8,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              // Lift labels above the 3-D extrusion so they're readable
              'symbol-z-order': 'auto',
            },
            paint: {
              'text-color': '#a0e8ff',
              'text-halo-color': 'rgba(0,20,50,0.9)',
              'text-halo-width': 1.5,
            },
          });
          groups['buildings'] = ['api-buildings-outline', 'api-buildings-highlight', 'api-buildings-3d', 'api-buildings-label'];

          // ── Click handler: highlight + pass building data to sidebar ─
          map.on('click', 'api-buildings-3d', (e) => {
            if (!e.features || e.features.length === 0) return;
            const p = e.features[0].properties as Record<string, string | number | null>;

            // Highlight this building (match by osm_id)
            map.setFilter('api-buildings-highlight',
              ['==', ['to-string', ['get', 'osm_id']], String(p.osm_id)]);

            const toStr = (v: unknown) =>
              v != null && String(v) !== 'null' && String(v) !== 'undefined' ? String(v) : null;
            onBuildingSelect({
              osm_id:       typeof p.osm_id === 'number' ? p.osm_id : null,
              name:         toStr(p.name),
              building:     toStr(p.building),
              amenity:      toStr(p.amenity),
              shop:         toStr(p.shop),
              tourism:      toStr(p.tourism),
              height:       toStr(p.height),
              levels:       toStr(p.levels),
              building_use: toStr(p.building_use),
              street:       toStr(p.street),
              housenumber:  toStr(p.housenumber),
              operator:     toStr(p.operator),
              website:      toStr(p.website),
              extra:        null,
              extraLoading: true,
            });
          });

          // Pointer cursor on hover
          map.on('mouseenter', 'api-buildings-3d', () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', 'api-buildings-3d', () => { map.getCanvas().style.cursor = ''; });
        }

        // ── Click empty map: clear road + building highlights ─────────────
        map.on('click', (e) => {
          // Only clear if the click was not handled by a feature layer
          const hit = map.queryRenderedFeatures(e.point, {
            layers: ['api-buildings-3d', 'api-roads-fill', 'api-pois-icon', 'api-infra-icon'].filter(id => !!map.getLayer(id)),
          });
          if (hit.length === 0) {
            if (map.getLayer('api-buildings-highlight'))
              map.setFilter('api-buildings-highlight', ['==', ['to-string', ['get', 'osm_id']], '__NONE__']);
            if (map.getLayer('api-roads-highlight'))
              map.setFilter('api-roads-highlight', ['==', ['get', 'name'], '__NONE__']);
            poiPopupRef.current?.remove();
            onBuildingSelect(null);
            onInfraSelect(null);
          }
        });

        // ── POIs / Signals / CCTV ─────────────────────────────────────────
        if (poisData) {
          map.addSource('api-pois', { type: 'geojson', data: poisData });

          // Symbol layer: one icon per POI category (icons already in sprite)
          map.addLayer({
            id: 'api-pois-icon',
            type: 'symbol',
            source: 'api-pois',
            layout: {
              'icon-image': poiIconImageExpression() as maplibregl.ExpressionSpecification,
              'icon-size': poiIconSizeExpression() as maplibregl.ExpressionSpecification,
              'icon-allow-overlap': true,
              'icon-ignore-placement': false,
              // Push name label below icon
              'text-field': ['coalesce', ['get', 'name'], ''],
              'text-size': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 10, 18, 12],
              'text-offset': [0, 1.6],
              'text-anchor': 'top',
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-optional': true,
              'text-max-width': 10,
            },
            paint: {
              'text-color': '#222222',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.5,
            },
          });

          groups['pois'] = ['api-pois-icon'];

          // ── POI click: info popup ────────────────────────────────────
          const POI_LABELS: Record<string, string> = {
            restaurant:'Restaurant',  food_court:'Food Court',  cafe:'Café',
            fast_food:'Fast Food',    canteen:'Canteen',        juice_bar:'Juice Bar',
            bar:'Bar',                pub:'Pub',                nightclub:'Nightclub',
            pharmacy:'Pharmacy',      hospital:'Hospital',      clinic:'Clinic',
            doctors:'Doctor',         dentist:'Dentist',        veterinary:'Veterinarian',
            physiotherapist:'Physiotherapist',                  optician:'Optician',
            parking:'Parking',        fuel:'Fuel Station',      car_wash:'Car Wash',
            bank:'Bank',              atm:'ATM',                bureau_de_change:'Currency Exchange',
            money_transfer:'Money Transfer',
            supermarket:'Supermarket',convenience:'Convenience Store',mall:'Shopping Mall',
            department_store:'Department Store',               marketplace:'Marketplace',
            school:'School',          college:'College',        university:'University',
            kindergarten:'Kindergarten',language_school:'Language School',
            mosque:'Mosque',          place_of_worship:'Place of Worship',church:'Church',
            hotel:'Hotel',            hostel:'Hostel',          motel:'Motel',
            guest_house:'Guest House',
            gym:'Gym',                sports_centre:'Sports Centre',fitness_centre:'Fitness Centre',
            swimming_pool:'Swimming Pool',
          };
          const POI_COLORS: Record<string, string> = {
            restaurant:'#e65100', food_court:'#e65100', cafe:'#6d4c41', fast_food:'#e65100',
            bar:'#c62828',        pub:'#c62828',
            pharmacy:'#2e7d32',   hospital:'#b71c1c',   clinic:'#b71c1c', doctors:'#b71c1c',
            veterinary:'#558b2f',
            parking:'#1565c0',    fuel:'#37474f',
            bank:'#e65100',       atm:'#e65100',
            supermarket:'#6a1b9a',convenience:'#6a1b9a',mall:'#6a1b9a',
            school:'#283593',     college:'#283593',    university:'#283593',
            mosque:'#00695c',     place_of_worship:'#00695c',
            hotel:'#ad1457',      gym:'#bf360c',        sports_centre:'#bf360c',
          };

          map.on('click', 'api-pois-icon', (e) => {
            if (!e.features?.length) return;
            const p   = e.features[0].properties as Record<string, string | null>;
            const cat  = p.amenity ?? p.shop ?? p.tourism ?? p.type ?? '';
            const title = p.name ?? POI_LABELS[cat] ?? (cat ? cat.replace(/_/g, ' ') : 'Point of Interest');
            const badge = POI_LABELS[cat] ?? (cat ? cat.replace(/_/g, ' ') : '');
            const color = POI_COLORS[cat] ?? '#546e7a';
            const row = (icon: string, lbl: string, val: string) =>
              `<div style="display:flex;gap:8px;align-items:flex-start;padding:3px 0">
                <span style="width:16px;text-align:center;flex-shrink:0">${icon}</span>
                <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">${lbl}</div>
                <div style="font-size:12px;font-weight:600;color:#111">${val}</div></div></div>`;
            const web = p.website ?? p['contact:website'] ?? null;
            localPoiPopup
              .setLngLat(e.lngLat)
              .setHTML(
                `<div style="font-family:Inter,'Segoe UI',sans-serif;padding:4px 2px">
                  <div style="font-weight:700;font-size:14px;color:#111;margin-bottom:6px;line-height:1.3">${title}</div>
                  ${badge ? `<div style="display:inline-block;background:${color}22;color:${color};
                    border:1px solid ${color}55;font-size:10px;font-weight:700;padding:2px 8px;
                    border-radius:10px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
                    ${badge}</div>` : ''}
                  <div style="border-top:1px solid #f3f4f6;padding-top:6px;margin-top:2px">
                    ${p.operator      ? row('🏢', 'Operator', p.operator) : ''}
                    ${p.phone         ? row('📞', 'Phone',    p.phone)    : ''}
                    ${p.opening_hours ? row('🕐', 'Hours',    p.opening_hours) : ''}
                    ${web ? `<div style="display:flex;gap:8px;align-items:flex-start;padding:3px 0">
                      <span style="width:16px;text-align:center;flex-shrink:0">🔗</span>
                      <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Website</div>
                      <a href="${web}" target="_blank" rel="noopener"
                        style="font-size:12px;font-weight:600;color:#0288d1;text-decoration:none">
                        ${web.replace(/^https?:\/\/(www\.)?/, '')}</a></div></div>` : ''}
                  </div>
                </div>`,
              )
              .addTo(map);
          });
          map.on('mouseenter', 'api-pois-icon', () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', 'api-pois-icon', () => { map.getCanvas().style.cursor = ''; });
        }

        // ── Infrastructure: signals, CCTV, bus stops, crossings, lamps ────
        {
          // Use backend data only (already contains all infra categories from the DB)
          const mergedFeatures: object[] = [...(infraData?.features ?? [])];

          // Show crossings only at zoom 15+ (713 of them → too dense at low zoom)
          const INFRA_FILTER: maplibregl.ExpressionSpecification = [
            'any',
            ['!=', ['get', 'category'], 'crossing'],
            ['>=', ['zoom'], 15],
          ];


          if (mergedFeatures.length > 0) {
            const combinedInfra = { type: 'FeatureCollection', features: mergedFeatures };
            map.addSource('api-infra', { type: 'geojson', data: combinedInfra as maplibregl.GeoJSONSourceSpecification['data'] });

            // ── Infrastructure structure-icon symbol layer ────────────────
            // Uses transparent-background canvas icons that look like real
            // physical structures (traffic lights, CCTV cameras, street lamps
            // etc.) with icon-anchor: 'bottom' so each structure stands on
            // its map coordinate.
            map.addLayer({
              id: 'api-infra-icon',
              type: 'symbol',
              source: 'api-infra',
              filter: INFRA_FILTER,
              layout: {
                'icon-image':            infraStructureImageExpression() as maplibregl.ExpressionSpecification,
                'icon-size':             infraStructureSizeExpression()  as maplibregl.ExpressionSpecification,
                'icon-anchor':           'bottom',
                'icon-allow-overlap':    false,
                'icon-ignore-placement': false,
                'text-field': [
                  'case',
                  ['has', 'name'], ['coalesce', ['get', 'name'], ''],
                  ['match', ['get', 'category'],
                    'traffic_signals',  'Signal',
                    'bus_stop',         'Bus Stop',
                    'crossing',         'Crossing',
                    'speed_camera',     'Speed Cam',
                    'cctv',             'CCTV',
                    'street_lamp',      'Lamp',
                    'roundabout',       'Roundabout',
                    'mast',             'Mast',
                    'flagpole',         'Flagpole',
                    'tower',            'Tower',
                    'water_tap',        'Water Tap',
                    'fire_hydrant',     'Hydrant',
                    'power_substation', 'Substation',
                    'ev_charging',      'EV Charge',
                    'recycling',        'Recycling',
                    'waste_basket',     'Bin',
                    'drinking_water',   'Water',
                    'toilets',          'WC',
                    'wastewater_plant', 'WWTP',
                    'pumping_station',  'Pump Stn',
                    ''],
                ] as maplibregl.ExpressionSpecification,
                'text-size':           ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 10, 18, 12] as maplibregl.ExpressionSpecification,
                'text-offset':         [0, 0.6],
                'text-anchor':         'top',
                'text-font':           ['Open Sans Semibold', 'Arial Unicode MS Regular'],
                'text-optional':       true,
                'text-max-width':      10,
                'text-allow-overlap':  false,
              },
              paint: {
                'text-color': ['match', ['get', 'category'],
                  'street_lamp', '#7B5E0A',
                  '#333333'] as maplibregl.ExpressionSpecification,
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.5,
              },
            });

            groups['infrastructure'] = ['api-infra-icon'];

            // ── Click → open InfraPanel ───────────────────────────────────
            map.on('click', 'api-infra-icon', (e) => {
              if (!e.features?.length) return;
              e.originalEvent.stopPropagation();
              const p = e.features[0].properties as Record<string, string | null>;
              const toS = (v: string | null | undefined) =>
                v && v !== 'null' && v !== 'undefined' ? v : null;
              onInfraSelect({
                osm_id:            p.osm_id ? Number(p.osm_id) : null,
                name:              toS(p.name),
                category:          p.category ?? '',
                highway:           toS(p.highway),
                man_made:          toS(p.man_made),
                amenity:           toS(p.amenity),
                power:             toS(p.power),
                ref:               toS(p.ref),
                operator:          toS(p.operator),
                description:       toS(p.description),
                height:            toS(p.height),
                surveillance_type: toS(p.surveillance_type),
                crossing_type:     toS(p.crossing_type),
                traffic_signals:   toS(p.traffic_signals),
                capacity:          toS(p.capacity),
                recycling_type:    toS(p.recycling_type),
                socket_type:       toS(p.socket_type),
                lngLat:            [e.lngLat.lng, e.lngLat.lat],
              });
            });
            map.on('mouseenter', 'api-infra-icon', () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'api-infra-icon', () => { map.getCanvas().style.cursor = ''; });
          }
        }

        // ── Incident overlay (empty until simulator activates) ――――――――――――――
        map.addSource('incident-zone', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'incident-zone-fill', type: 'fill', source: 'incident-zone',
          paint: { 'fill-color': '#FF0000', 'fill-opacity': 0 },
        });
        map.addLayer({
          id: 'incident-zone-stroke', type: 'line', source: 'incident-zone',
          paint: { 'line-color': '#FF0000', 'line-width': 2, 'line-opacity': 0, 'line-blur': 2 },
        });

          // ── DSO district boundary (native MapLibre) ──────────────────────
        map.addSource('dso-boundary', {
          type: 'geojson',
          data: DSO_BOUNDARY_GEOJSON as maplibregl.GeoJSONSourceSpecification['data'],
        });
        map.addLayer({
          id: 'dso-boundary-fill',
          type: 'fill',
          source: 'dso-boundary',
          paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.03 },
        });
        map.addLayer({
          id: 'dso-boundary-line',
          type: 'line',
          source: 'dso-boundary',
          paint: {
            'line-color': '#00E5FF',
            'line-width': 2.5,
            'line-opacity': 0.85,
            'line-blur': 1,
          },
        });
        groups['boundary'] = ['dso-boundary-fill', 'dso-boundary-line'];

        // ── Technician route (native MapLibre, updated by visibility effect) ──
        map.addSource('tech-route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'tech-route-line',
          type: 'line',
          source: 'tech-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#00E5FF',
            'line-width': 4,
            'line-opacity': 0.9,
            'line-blur': 0.5,
          },
        });

        // ── Traffic Signals & Road Congestion layers ───────────────────────
        // Signal HTML markers (react-icons) are created in the trafficState
        // useEffect.  Here we only add the GeoJSON sources + non-HTML layers.

        // Register canvas-drawn images
        if (!map.hasImage('intersection-dot')) {
          map.addImage('intersection-dot', drawIntersectionNodeImage());
        }
        registerSignalIcons(map);

        // GeoJSON source for signal icon positions (updated in trafficState effect)
        map.addSource('traffic-signals', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // Glow halo ring around each signal
        map.addLayer({
          id: 'traffic-signal-halo', type: 'circle', source: 'traffic-signals',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 16,
            'circle-color': 'transparent',
            'circle-stroke-width': 2,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-opacity': 0.45,
            'circle-blur': 0.5,
          },
        });
        // Canvas-drawn 3-light signal icon
        map.addLayer({
          id: 'traffic-signal-icon', type: 'symbol', source: 'traffic-signals',
          layout: {
            'icon-image':        ['concat', 'signal-', ['get', 'state']] as maplibregl.ExpressionSpecification,
            'icon-size':         1,
            'icon-anchor':       'bottom',
            'icon-allow-overlap': true,
            'visibility':        'none',
          },
        });

        // Detected OSM intersection nodes (small white dots at road junctions)
        map.addSource('traffic-intersections', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'traffic-intersections-halo', type: 'circle', source: 'traffic-intersections',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 9,
            'circle-color': 'transparent',
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(200,220,255,0.25)',
          },
        });
        map.addLayer({
          id: 'traffic-intersections-dot', type: 'circle', source: 'traffic-intersections',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 3.5,
            'circle-color': 'rgba(200,220,255,0.55)',
            'circle-stroke-color': 'rgba(255,255,255,0.7)',
            'circle-stroke-width': 0.8,
          },
        });

        // ── Simulation road overlay (hardcoded coords — works without API) ──────
        // Two-layer approach like Google Maps:
        //  1. Solid glow layer  — wide semi-transparent color band
        //  2. Flow layer        — animated moving white dashes on top
        map.addSource('traffic-roads-sim', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // Solid color background band
        map.addLayer({
          id: 'traffic-roads-sim-layer', type: 'line', source: 'traffic-roads-sim',
          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: {
            'line-color': ['get', 'cong_color'],
            'line-width': 10,
            'line-opacity': 0.55,
            'line-blur': 3,
          },
        });
        // Animated moving-dot flow overlay (white dashes crawl forward like Google Maps)
        map.addLayer({
          id: 'traffic-roads-sim-flow', type: 'line', source: 'traffic-roads-sim',
          layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 3.5,
            'line-opacity': 0.55,
            'line-dasharray': [0, 4, 3],
          },
        });

        // Real OSM road network source – populated & congestion-colored by trafficState effect
        // Always-on baseline: roads start green (LOW) and update when simulation activates
        map.addSource('traffic-roads-api', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'traffic-roads-api-layer', type: 'line', source: 'traffic-roads-api',
          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
          paint: {
            'line-color': ['get', 'cong_color'],
            'line-width': 5,
            'line-opacity': 0.85,
            'line-blur': 1.2,
          },
        });
        // Populate with baseline green immediately from cached road data
        if (roadsData) {
          const baselineRoads: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: (roadsData as GeoJSON.FeatureCollection).features.map((f) => ({
              ...f,
              properties: { ...(f.properties as object), cong_color: '#4ade8030' },
            })),
          };
          (map.getSource('traffic-roads-api') as maplibregl.GeoJSONSource | undefined)?.setData(baselineRoads);
        }

        // ── Emergency vehicle route lines ─────────────────────────────────
        map.addSource('emergency-routes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'emergency-routes-layer', type: 'line', source: 'emergency-routes',
          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 4,
            'line-opacity': 0.88,
            'line-dasharray': [6, 3],
            'line-blur': 0.8,
          },
        });

        // ── Task route lines (AccidentResponsePanel dispatched responders) ─────
        map.addSource('task-routes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // Glow halo — only for real road routes
        map.addLayer({
          id: 'task-routes-glow', type: 'line', source: 'task-routes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['*', ['get', 'lineWidth'], 3],
            'line-opacity': ['*', ['get', 'lineOpacity'], 0.25],
            'line-blur': 6,
          },
        });
        // Main route line
        map.addLayer({
          id: 'task-routes-layer', type: 'line', source: 'task-routes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'lineOpacity'],
          },
        });
        // Dashed overlay for straight-line fallback routes only
        map.addLayer({
          id: 'task-routes-dash', type: 'line', source: 'task-routes',
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          filter: ['==', ['get', 'hasRoute'], 0],
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 1.5,
            'line-opacity': 0.6,
            'line-dasharray': [6, 5],
          },
        });

        // ── Accident marker source ─────────────────────────────────────────
        map.addSource('traffic-accident', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // Wide halo glow (outermost)
        map.addLayer({
          id: 'traffic-accident-halo', type: 'circle', source: 'traffic-accident',
          paint: {
            'circle-radius': 52,
            'circle-color': '#ff2200',
            'circle-opacity': 0.08,
            'circle-stroke-color': '#ff3b3b',
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.25,
          },
          layout: { visibility: 'none' },
        });
        // Mid pulse ring
        map.addLayer({
          id: 'traffic-accident-pulse', type: 'circle', source: 'traffic-accident',
          paint: {
            'circle-radius': 34,
            'circle-color': 'transparent',
            'circle-stroke-color': '#ff3b3b',
            'circle-stroke-width': 3,
            'circle-stroke-opacity': 0.55,
          },
          layout: { visibility: 'none' },
        });
        // Core filled circle
        map.addLayer({
          id: 'traffic-accident-circle', type: 'circle', source: 'traffic-accident',
          paint: {
            'circle-radius': 20,
            'circle-color': '#ff2200',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
            'circle-opacity': 1.0,
            'circle-blur': 0,
          },
          layout: { visibility: 'none' },
        });
        // ⚠ label text above the dot
        map.addLayer({
          id: 'traffic-accident-label', type: 'symbol', source: 'traffic-accident',
          layout: {
            visibility: 'none',
            'text-field': '⚠ ACCIDENT',
            'text-size': 12,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-offset': [0, -3.2],
            'text-anchor': 'bottom',
            'text-allow-overlap': true,
            'icon-allow-overlap': true,
          },
          paint: {
            'text-color': '#ff3b3b',
            'text-halo-color': '#0d1117',
            'text-halo-width': 2.5,
          },
        });

        // Save groups so visibility effect can reference them
        layerGroupsRef.current = groups;

        // ── Initialize deck.gl overlay for environment visualization ──────
        const overlay = new MapboxOverlay({
          interleaved: true,
          layers: [],
        });
        map.addControl(overlay as any);
        deckOverlayRef.current = overlay;

        setMapLoaded(true);

      }).catch((err) => {
        console.error('[DSOMap] API layer error:', err);
        layerGroupsRef.current = groups;
        setMapLoaded(true);
      });
    });

    mapRef.current = map;
    // Expose map instance to parent component if ref provided
    if (externalMapRef) {
      externalMapRef.current = map;
    }

    return () => {
      if (incidentMarkerRef.current)      { incidentMarkerRef.current.remove();  incidentMarkerRef.current  = null; }
      if (techMarkerRef.current)          { techMarkerRef.current.remove();       techMarkerRef.current      = null; }
      if (schneiderMarkerRef.current)     { schneiderMarkerRef.current.remove();  schneiderMarkerRef.current = null; }
      if (schneiderPopupRef.current)      { schneiderPopupRef.current.remove();   schneiderPopupRef.current  = null; }
      // BMS overlay layers are removed by map.remove() below
      signalMarkersRef.current.forEach((m) => m.remove()); signalMarkersRef.current  = [];
      cctvMarkersRef.current.forEach((m) => m.remove());   cctvMarkersRef.current    = [];
      vehicleMarkersRef.current.forEach((m) => m.remove()); vehicleMarkersRef.current = [];
      if (vehicleAnimRef.current) { clearInterval(vehicleAnimRef.current); vehicleAnimRef.current = null; }
      if (deckOverlayRef.current) { deckOverlayRef.current.finalize(); deckOverlayRef.current = null; }
      map.remove();
      mapRef.current = null;
      if (externalMapRef) {
        externalMapRef.current = null;
      }
      setMapLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync API layer visibility whenever toggles change ─────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const groups = layerGroupsRef.current;
    (Object.keys(visibility) as (keyof typeof visibility)[]).forEach((key) => {
      const vis = visibility[key] ? 'visible' : 'none';
      if (key === 'boundary') {
        ['dso-boundary-fill', 'dso-boundary-line'].forEach(id => {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
        });
        return;
      }
      const ids = groups[key] ?? [];
      ids.forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      });
      // Close POI popup whenever the pois layer is turned off
      if (key === 'pois' && !visibility[key]) {
        poiPopupRef.current?.remove();
      }
    });
  }, [visibility, mapLoaded]);

  // ── Environment visualization layers (deck.gl) ─────────────────────────────

  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay || !mapLoaded) return;

    // Only show environment layers when environment module is active
    const isEnvActive = visibility.environment;
    const showHeatmap = isEnvActive && (envLayers?.heatmap ?? false);
    const showSensors = isEnvActive && (envLayers?.sensors ?? false);
    const showWind = isEnvActive && (envLayers?.wind ?? false);
    const showSources = isEnvActive && (envLayers?.sources ?? false);

    const layers = createEnvironmentLayers(
      {
        heatmap: { 
          visible: showHeatmap, 
          opacity: 0.6 
        },
        sensors: { 
          visible: showSensors, 
          showLabels: true, 
          showOnlyWarnings: false 
        },
        wind: { 
          visible: showWind 
        },
        sources: { 
          visible: showSources, 
          showLabels: true, 
          showOnlyCritical: false,
          showPlumes: true 
        },
      },
      {
        onSensorClick: (sensor) => {
          console.log('[DSOMap] Sensor clicked:', sensor);
          setSelectedSensor(sensor);
        },
        onSourceClick: (source) => {
          console.log('[DSOMap] Pollution source clicked:', source);
          setSelectedSource(source);
        },
        onSensorHover: (sensor, x, y) => {
          if (sensor) {
            setEnvTooltip({ type: 'sensor', data: sensor, x, y });
          } else {
            setEnvTooltip(null);
          }
        },
        onSourceHover: (source, x, y) => {
          if (source) {
            setEnvTooltip({ type: 'source', data: source, x, y });
          } else {
            setEnvTooltip(null);
          }
        },
      }
    );

    overlay.setProps({ layers });
  }, [visibility.environment, mapLoaded, envLayers]);

  // ── Sync technician route (native MapLibre GeoJSON) ────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const routePath = activeIncident?.routePath;
    const src = map.getSource('tech-route') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (routePath && routePath.length >= 2) {
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: routePath },
          properties: {},
        }],
      });
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [mapLoaded, activeIncident?.routePath]);

  // ── Incident overlay ──────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Always close popup when incident state changes
    setAlertPopupOpen(false);

    // Remove previous markers
    if (incidentMarkerRef.current) { incidentMarkerRef.current.remove(); incidentMarkerRef.current = null; }
    if (techMarkerRef.current)     { techMarkerRef.current.remove();     techMarkerRef.current     = null; }

    if (!activeIncident) {
      const src = map.getSource('incident-zone') as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features: [] });
      if (map.getLayer('incident-zone-fill'))   map.setPaintProperty('incident-zone-fill',   'fill-opacity', 0);
      if (map.getLayer('incident-zone-stroke'))  map.setPaintProperty('incident-zone-stroke', 'line-opacity', 0);
      if (map.getLayer('incident-zone-stroke'))  map.setPaintProperty('incident-zone-stroke', 'line-width', 2);
      if (map.getLayer('api-roads-highlight'))   map.setFilter('api-roads-highlight', ['==', ['get', 'name'], '__NONE__']);
      return;
    }

    const { mapEffect } = activeIncident.incident;
    const color = EFFECT_COLOR[mapEffect.type] ?? '#00E5FF';
    const zoneData = makeCircleGeoJSON(mapEffect.epicenter, mapEffect.radius);

    const src = map.getSource('incident-zone') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [zoneData] });

    if (map.getLayer('incident-zone-fill')) {
      map.setPaintProperty('incident-zone-fill',   'fill-color',   color);
      map.setPaintProperty('incident-zone-fill',   'fill-opacity',
        activeIncident.status === 'alert' ? 0.18 : 0.25);
    }
    if (map.getLayer('incident-zone-stroke')) {
      map.setPaintProperty('incident-zone-stroke', 'line-color',   color);
      map.setPaintProperty('incident-zone-stroke', 'line-opacity', 1.0);
      map.setPaintProperty('incident-zone-stroke', 'line-width',   activeIncident.status === 'alert' ? 3 : 4);
    }

    // Traffic: highlight affected road (only when running/resolved)
    if (activeIncident.status !== 'alert' &&
        mapEffect.type === 'traffic' && mapEffect.roadName &&
        map.getLayer('api-roads-highlight')) {
      map.setFilter('api-roads-highlight', ['==', ['get', 'name'], mapEffect.roadName]);
    }

    // ── Pulsing epicenter marker ────────────────────────────────────────
    const el = document.createElement('div');
    el.className = activeIncident.status === 'alert'
      ? 'incident-pulse incident-pulse--alert'
      : 'incident-pulse';

    const sev = (activeIncident.incident as { severity?: string }).severity ?? '';
    const sevBadge = sev === 'HIGH'   ? `<span class="incident-pulse__sev incident-pulse__sev--high">HIGH</span>`
                   : sev === 'MEDIUM' ? `<span class="incident-pulse__sev incident-pulse__sev--med">MED</span>`
                   : '';
    el.innerHTML = [
      // Outer slow ring
      `<div class="incident-pulse__ring incident-pulse__ring--outer" style="border-color:${color}40"></div>`,
      // Main fast ring
      `<div class="incident-pulse__ring" style="border-color:${color};box-shadow:0 0 10px ${color}"></div>`,
      // Centre warning icon
      `<div class="incident-pulse__icon" style="background:${color};box-shadow:0 0 18px ${color}99">⚠</div>`,
      // Floating label chip
      `<div class="incident-pulse__label" style="border-color:${color}88;color:${color}">
        ${activeIncident.incident.title} ${sevBadge}
      </div>`,
    ].join('');

    // Only alert-status markers are clickable (open popup)
    if (activeIncident.status === 'alert') {
      el.style.cursor = 'pointer';
      el.title = `Click to respond: ${activeIncident.incident.title}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const pt = map.project(mapEffect.epicenter);
        const cw = containerRef.current?.offsetWidth  ?? 800;
        const ch = containerRef.current?.offsetHeight ?? 600;
        const PW = 316; // popup width + margin
        const PH = 450; // popup height estimate
        let left = pt.x + 32;
        let top  = pt.y - PH / 2;
        if (left + PW > cw) left = pt.x - PW - 8;
        left = Math.max(8, left);
        top  = Math.max(8, Math.min(top, ch - PH - 8));
        setAlertPopupPos({ x: left, y: top });
        setAlertPopupOpen(true);
      });
    }

    incidentMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(mapEffect.epicenter)
      .addTo(map);

    // ── Technician vehicle marker (when enroute = on-site) ──────────────────
    if (activeIncident.workflowStage === 'enroute' && activeIncident.assignedTechnician) {
      const tech   = activeIncident.assignedTechnician;
      const techEl = document.createElement('div');
      techEl.className = 'tech-marker';
      techEl.innerHTML = '<span class="tech-marker__icon">🚐</span>';
      techMarkerRef.current = new maplibregl.Marker({ element: techEl, anchor: 'center' })
        .setLngLat(tech.coordinates)
        .addTo(map);
    }
  }, [activeIncident, mapLoaded]);

  // ── Traffic signal & congestion map layers ────────────────────────────────
  // Fetches real OSM roads from the FastAPI /roads endpoint on first activation,
  // detects actual intersection nodes, snaps hardcoded signal positions to them,
  // and colours road geometries by the current simulation congestion state.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const signalSrc   = map.getSource('traffic-signals')    as maplibregl.GeoJSONSource | undefined;
    const roadSrc     = map.getSource('traffic-roads-api')  as maplibregl.GeoJSONSource | undefined;
    const accidentSrc = map.getSource('traffic-accident')   as maplibregl.GeoJSONSource | undefined;

    const vis = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };

    const active = !!trafficState;

    // Toggle layer visibility — traffic-roads-api-layer stays always visible (baseline green)
    vis('traffic-signal-halo',           active);
    vis('traffic-signal-icon',           active);
    vis('traffic-intersections-halo',    active);
    vis('traffic-intersections-dot',     active);
    vis('traffic-accident-circle',       active && trafficState?.mode === 'accident');
    vis('traffic-accident-pulse',        active && trafficState?.mode === 'accident');

    // ── Stop any existing dash animation ──────────────────────────────────────
    if (dashAnimRef.current !== null) { cancelAnimationFrame(dashAnimRef.current); dashAnimRef.current = null; }

    // ── Simulation road overlay (real OSRM routes, cached after first fetch) ─
    // We immediately paint straight-line fallbacks, then replace each segment
    // with the real road geometry once OSRM responds (cached per road_id so
    // subsequent re-renders are instant).
    const simRoadSrc = map.getSource('traffic-roads-sim') as maplibregl.GeoJSONSource | undefined;
    if (trafficState) {
      // Show ALL roads coloured by live congestion level (LOW = green — DSO is mostly clear)
      const activeRoads = trafficState.roads;
      const isIdle = trafficState.mode === 'idle';

      // Helper: build GeoJSON features from the route cache (or straight-line fallback)
      const buildSimFeatures = () =>
        activeRoads.map((r) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: simRoadRoutesRef.current.get(r.road_id) ?? [r.start, r.end],
          },
          properties: {
            road_id:    r.road_id,
            name:       r.name,
            cong_color: CONGESTION_COLOR[r.congestion_level] ?? '#6b7280',
          },
        }));

      // Immediately show with straight lines (or cached OSRM geometry)
      simRoadSrc?.setData({ type: 'FeatureCollection', features: buildSimFeatures() });

      // Only fetch OSRM real road geometry in simulation mode (not idle — avoids 429 spam)
      if (!isIdle) {
        const missing = activeRoads.filter((r) => !simRoadRoutesRef.current.has(r.road_id));
        if (missing.length > 0) {
          Promise.all(
            missing.map((r) =>
              fetchRoadRoute(r.start, r.end).then((coords) => ({ road_id: r.road_id, coords })),
            ),
          ).then((results) => {
            results.forEach(({ road_id, coords }) => simRoadRoutesRef.current.set(road_id, coords));
            const src = mapRef.current?.getSource('traffic-roads-sim') as maplibregl.GeoJSONSource | undefined;
            src?.setData({ type: 'FeatureCollection', features: buildSimFeatures() });
          });
        }
      }

      vis('traffic-roads-sim-layer', true);
      vis('traffic-roads-sim-flow',  true);

      // Start Google Maps–style animated dash flow
      const DASH_SEQ: [number, number, number][] = [
        [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5],
        [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [3.5, 3.5, 0.5],
      ];
      let dashStep = 0;
      let lastDashTime = 0;
      const animateDash = (ts: number) => {
        if (ts - lastDashTime > 80) {
          dashStep = (dashStep + 1) % DASH_SEQ.length;
          const lyr = 'traffic-roads-sim-flow';
          if (map.getLayer(lyr)) map.setPaintProperty(lyr, 'line-dasharray', DASH_SEQ[dashStep]);
          lastDashTime = ts;
        }
        dashAnimRef.current = requestAnimationFrame(animateDash);
      };
      dashAnimRef.current = requestAnimationFrame(animateDash);
    } else {
      simRoadSrc?.setData({ type: 'FeatureCollection', features: [] });
      vis('traffic-roads-sim-layer', false);
      vis('traffic-roads-sim-flow',  false);
    }

    // ── Clear signal / CCTV HTML markers (always rebuild) ─────────────────
    signalMarkersRef.current.forEach((m) => m.remove());
    signalMarkersRef.current = [];
    cctvMarkersRef.current.forEach((m) => m.remove());
    cctvMarkersRef.current = [];
    cctvPopupRef.current?.remove();
    // NOTE: signalInfoPopupRef is intentionally NOT removed here — the popup
    // should stay open across trafficState updates (it updates its own DOM internally)

    if (!trafficState) {
      // Reset road layer to baseline green when simulation stops
      if (roadSrc && apiRoadsFcRef.current) {
        const baseline: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: apiRoadsFcRef.current.features.map((f) => ({
            ...f,
            properties: { ...(f.properties as object), cong_color: '#4ade8030' },
          })),
        };
        roadSrc.setData(baseline);
      }
      return;
    }

    // ── Fetch real road network once and cache ─────────────────────────────
    const applyRoads = (fc: GeoJSON.FeatureCollection) => {
      const intersections = detectIntersections(fc);

      // Snap each hardcoded signal to its nearest OSM intersection node
      const newPositions = new Map<string, [number, number]>();
      for (const sig of trafficState.signals) {
        newPositions.set(sig.signal_id, snapSignalToIntersection(sig, intersections));
      }
      snappedPositionsRef.current = newPositions;

      // Colour road geometries by simulation congestion state
      const enriched = enrichRoadsWithCongestion(fc, trafficState.roads);
      roadSrc?.setData(enriched);

      // Update signal positions (snapped to real intersections)
      signalSrc?.setData(buildSignalGeoJSON(trafficState.signals, newPositions));
    };

    // ── Stop any previous idle cycling timer ─────────────────────────────
    if (signalCycleTimerRef.current) {
      clearInterval(signalCycleTimerRef.current);
      signalCycleTimerRef.current = null;
    }

    // ── Helper: build signal markers for given signal-states ─────────────
    const buildSignalMarkers = (
      displaySignals: typeof trafficState.signals,
      positions: Map<string, [number, number]>,
    ) => {
      // Remove previous signal + CCTV markers
      signalMarkersRef.current.forEach((m) => m.remove()); signalMarkersRef.current = [];
      cctvMarkersRef.current.forEach((m) => m.remove());   cctvMarkersRef.current   = [];

      displaySignals.forEach((sig, idx) => {
        const pos       = positions.get(sig.signal_id) ?? sig.location;
        const sigColor  = SIGNAL_COLOR[sig.state] ?? '#888';
        const videoSrc  = SIGNAL_VIDEOS[idx % SIGNAL_VIDEOS.length];

        // ── Signal marker — clickable, shows full info popup ──────────────
        const sigEl = document.createElement('div');
        sigEl.innerHTML = signalMarkerHTML(sigColor, sig.signal_id, sig.state);
        sigEl.addEventListener('click', (e) => {
          e.stopPropagation();
          // Close any other open popups
          cctvPopupRef.current?.remove();
          signalInfoPopupRef.current?.remove();
          // Compute initial remaining BEFORE setHTML so we can pass it in
          const YELLOW_SEC_PRE = 3;
          const initialRemainingSec = sig.phaseRemainingSec ?? (
            sig.state === 'YELLOW' ? YELLOW_SEC_PRE :
            sig.state === 'RED'    ? sig.red_time : sig.green_time
          );
          signalInfoPopupRef.current = new maplibregl.Popup({
            closeButton:  true,
            closeOnClick: false,
            closeOnMove:  false,
            maxWidth: '260px',
            className: 'dso-signal-popup',
            offset: [0, -38],
          })
            .setLngLat(pos)
            .setHTML(signalInfoPopupHTML(
              sig.signal_id, sig.name, sig.state, sigColor,
              sig.cycle_time, sig.vehicle_density,
              sig.connected_roads, sig.green_time, sig.red_time,
              videoSrc,
              initialRemainingSec,
            ))
            .addTo(map);

          // ── Live countdown: tick every second, flip phase at boundaries ─
          const uid      = sig.signal_id.replace(/[^a-z0-9]/gi, '');
          const YELLOW_SEC = 3;
          // Start from the SAME value already rendered in the popup HTML
          let remaining = initialRemainingSec;
          let curPhase  = (sig.state || 'GREEN') as 'GREEN' | 'YELLOW' | 'RED';
          const PHASE_BG: Record<string, string> = { GREEN:'#14532d', RED:'#450a0a', YELLOW:'#422006' };
          const PHASE_COLOR: Record<string, string> = { GREEN:'#22c55e', RED:'#ef4444', YELLOW:'#f59e0b' };

          const popupTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
              // Advance phase
              if (curPhase === 'GREEN')  { curPhase = 'YELLOW'; remaining = YELLOW_SEC; }
              else if (curPhase === 'YELLOW') { curPhase = 'RED'; remaining = sig.red_time; }
              else                       { curPhase = 'GREEN';  remaining = sig.green_time; }
            }
            const glow = PHASE_COLOR[curPhase];
            const pct  = curPhase === 'GREEN'
              ? Math.round((remaining / sig.green_time) * 100)
              : curPhase === 'RED'
              ? Math.round((remaining / sig.red_time) * 100)
              : Math.round((remaining / YELLOW_SEC) * 100);

            const cntEl   = document.getElementById(`sp-cnt-${uid}`);
            const stateEl = document.getElementById(`sp-state-${uid}`);
            const hdrEl   = document.getElementById(`sp-hdr-${uid}`);
            const barEl   = document.getElementById(`sp-bar-${uid}`);
            const pctEl   = document.getElementById(`sp-pct-${uid}`);
            if (!cntEl) { clearInterval(popupTimer); return; } // popup closed
            cntEl.innerHTML   = `${remaining}<span style="font-size:8px;font-weight:400">s</span>`;
            cntEl.style.color = glow;
            if (stateEl) {
              stateEl.textContent = curPhase;
              stateEl.style.color = glow;
              stateEl.style.background = `${glow}22`;
              stateEl.style.borderColor = `${glow}55`;
            }
            if (hdrEl) {
              hdrEl.style.background = PHASE_BG[curPhase];
              hdrEl.style.borderBottomColor = `${glow}33`;
            }
            if (barEl) { barEl.style.width = `${pct}%`; barEl.style.background = glow; }
            if (pctEl) { pctEl.textContent = `${pct}%`; pctEl.style.color = glow; }
          }, 1000);

          // Clear timer when popup is closed
          signalInfoPopupRef.current.on('close', () => clearInterval(popupTimer));
        });
        const sigMkr = new maplibregl.Marker({ element: sigEl, anchor: 'bottom' })
          .setLngLat(pos).addTo(map);
        signalMarkersRef.current.push(sigMkr);
        // No separate CCTV marker per signal — CCTV feed is inside the signal popup
      });

      // ── CCTV at accident scene (uses traffic_accident_cctv.mp4) ──────────
      if (trafficState.mode === 'accident' && trafficState.accidentLocation) {
        const accPos = trafficState.accidentLocation;
        const accCctvEl = document.createElement('div');
        accCctvEl.innerHTML = cctvMarkerHTML('Accident Scene', true);
        accCctvEl.addEventListener('click', (e) => {
          e.stopPropagation();
          signalInfoPopupRef.current?.remove();
          cctvPopupRef.current?.remove();
          cctvPopupRef.current = new maplibregl.Popup({
            closeButton: true, maxWidth: '250px', className: 'dso-cctv-popup',
          })
            .setLngLat(accPos)
            .setHTML(cctvPopupHTML('Accident Scene — Live Feed', 'ACC-CAM-001', '/traffic_accident_cctv.mp4'))
            .addTo(map);
        });
        const accMkr = new maplibregl.Marker({ element: accCctvEl, anchor: 'center' })
          .setLngLat(accPos).addTo(map);
        cctvMarkersRef.current.push(accMkr);
      }
    };

    // ── Helper: rebuild HTML markers after roads are processed ────────────
    const rebuildHTMLMarkers = (positions: Map<string, [number, number]>) => {
      // Use trafficState.signals directly — TrafficSignalManager is the single source of
      // truth for phase cycling (idleSignals useMemo), so no separate cycling needed here.
      buildSignalMarkers(trafficState.signals, positions);
    };

    if (apiRoadsFcRef.current) {
      // Already fetched – just re-colour and re-snap
      applyRoads(apiRoadsFcRef.current);
      rebuildHTMLMarkers(snappedPositionsRef.current);
    } else {
      fetch('https://dso_api.astrikos.xyz:8443/roads')
        .then((r) => r.json())
        .then((fc: GeoJSON.FeatureCollection) => {
          apiRoadsFcRef.current = fc;
          applyRoads(fc);
          rebuildHTMLMarkers(snappedPositionsRef.current);
        })
        .catch((err) => {
          console.warn('[DSOMap] /roads fetch failed – falling back to signal positions as-is:', err);
          signalSrc?.setData(buildSignalGeoJSON(trafficState.signals));
          rebuildHTMLMarkers(snappedPositionsRef.current);
        });
    }

    // ── Accident marker ────────────────────────────────────────────────────
    if (trafficState.mode === 'accident' && trafficState.incidents.length > 0) {
      const accInc = trafficState.incidents.find((i) => i.type === 'accident');
      if (accInc) {
        accidentSrc?.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: accInc.location },
            properties: { id: accInc.id },
          }],
        });
        // Show all accident layers including new label & halo
        (['traffic-accident-halo', 'traffic-accident-pulse', 'traffic-accident-circle', 'traffic-accident-label'] as const)
          .forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible'); });
      }
    } else {
      accidentSrc?.setData({ type: 'FeatureCollection', features: [] });
      (['traffic-accident-halo', 'traffic-accident-pulse', 'traffic-accident-circle', 'traffic-accident-label'] as const)
        .forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
    }
  }, [trafficState, mapLoaded]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // ── Tear down previous overlay ──────────────────────────────────────────
    if (bmsClickHandlerRef.current) {
      map.off('click', 'bms-overlay-layer', bmsClickHandlerRef.current);
      bmsClickHandlerRef.current = null;
    }
    if (map.getLayer('bms-overlay-layer'))  map.removeLayer('bms-overlay-layer');
    if (map.getLayer('bms-overlay-hover'))  map.removeLayer('bms-overlay-hover');
    if (map.getSource('bms-overlay-src'))   map.removeSource('bms-overlay-src');

    if (!bmsActive) return;

    const fc = apiBuildingsRef.current;
    if (!fc || !fc.features.length) {
      // API buildings not loaded yet — nothing to color
      return;
    }

    const mode = bmsLayerMode ?? 'status';

    // ── Assign every API polygon to its nearest BMS building (no distance cap) ──
    // Pre-compute BMS building centroid-equivalent (their location coords)
    // so the inner loop is just distance comparisons.
    const coloredFeatures: GeoJSON.Feature[] = [];

    for (const feature of fc.features) {
      const centroid = featureCentroid(feature);
      let nearestBms = bmsBuildings[0];
      let nearestDist = approxDistM(centroid, bmsBuildings[0].location);
      for (let j = 1; j < bmsBuildings.length; j++) {
        const d = approxDistM(centroid, bmsBuildings[j].location);
        if (d < nearestDist) { nearestDist = d; nearestBms = bmsBuildings[j]; }
      }
      const [r, g, b_] = getBuildingColor(nearestBms, mode);
      // Keep the real API name; fall back to BMS name when OSM has none
      const apiProps = feature.properties as Record<string, unknown>;
      const toStr = (v: unknown) => (v != null && String(v) !== 'null' && String(v) !== '' ? String(v) : null);
      const realName = toStr(apiProps.name) ?? toStr(apiProps.housenumber) ?? nearestBms.name;
      coloredFeatures.push({
        ...feature,
        properties: {
          ...(apiProps),
          bms_color:    rgbToHex(r, g, b_),
          bms_status:   nearestBms.status,
          bms_id:       nearestBms.id,
          bms_name:     nearestBms.name,
          bms_api_name: realName,
        },
      });
    }

    if (!coloredFeatures.length) return;

    map.addSource('bms-overlay-src', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: coloredFeatures },
    });

    // Glow outline
    map.addLayer({
      id: 'bms-overlay-hover',
      type: 'fill-extrusion',
      source: 'bms-overlay-src',
      filter: ['==', ['get', 'bms_status'], '__NONE__'],   // hidden until hover
      paint: {
        'fill-extrusion-color': '#ffffff',
        'fill-extrusion-height': [
          'case',
          ['>', ['to-number', ['get', 'height'], 0], 0], ['to-number', ['get', 'height'], 0],
          ['>', ['to-number', ['get', 'levels'], 0], 0], ['*', ['to-number', ['get', 'levels'], 0], 3],
          15,
        ],
        'fill-extrusion-base': ['to-number', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.6,
      },
    }, 'api-buildings-label');

    // Colored BMS overlay on top of default building layer
    map.addLayer({
      id: 'bms-overlay-layer',
      type: 'fill-extrusion',
      source: 'bms-overlay-src',
      paint: {
        'fill-extrusion-color': ['get', 'bms_color'],
        'fill-extrusion-height': [
          'case',
          ['>', ['to-number', ['get', 'height'], 0], 0], ['to-number', ['get', 'height'], 0],
          ['>', ['to-number', ['get', 'levels'], 0], 0], ['*', ['to-number', ['get', 'levels'], 0], 3],
          15,
        ],
        'fill-extrusion-base': ['to-number', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.82,
        'fill-extrusion-vertical-gradient': true,
      },
    }, 'api-buildings-label');

    // Pointer cursor
    map.on('mouseenter', 'bms-overlay-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'bms-overlay-layer', () => { map.getCanvas().style.cursor = ''; });

    // Click: open BMS popup for the clicked building
    const clickHandler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const bmsId  = feat.properties?.bms_id as string;
      const bmsBld = bmsBuildings.find((b) => b.id === bmsId);
      if (!bmsBld) return;
      // Highlight hovered building
      map.setFilter('bms-overlay-hover', ['==', ['get', 'bms_id'], bmsId]);
      setTimeout(() => map.setFilter('bms-overlay-hover', ['==', ['get', 'bms_status'], '__NONE__']), 800);

      // Use the real API name (OSM) if available, otherwise keep BMS name
      const apiName = feat.properties?.bms_api_name as string | undefined;
      const resolved: typeof bmsBld = apiName && apiName !== bmsBld.name
        ? { ...bmsBld, name: apiName }
        : bmsBld;

      if (resolved.id === 'BLD_001') {
        _onSchneiderBuildingClick?.();
      } else {
        onBMSBuildingClick?.(resolved);
      }
    };
    map.on('click', 'bms-overlay-layer', clickHandler);
    bmsClickHandlerRef.current = clickHandler;

  }, [bmsActive, bmsLayerMode, mapLoaded]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Emergency vehicle animation ───────────────────────────────────────────
  // Reacts to emergencyResponders list changes — fetches real road routes via
  // OSRM then animates vehicles along those routes to the accident location.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const responders = trafficState?.emergencyResponders ?? [];

    // Clear previous animation + markers
    if (vehicleAnimRef.current) { clearInterval(vehicleAnimRef.current); vehicleAnimRef.current = null; }
    vehicleMarkersRef.current.forEach((m) => m.remove());
    vehicleMarkersRef.current = [];

    const routeSrc = map.getSource('emergency-routes') as maplibregl.GeoJSONSource | undefined;

    if (!trafficState?.accidentLocation || responders.length === 0) {
      routeSrc?.setData({ type: 'FeatureCollection', features: [] });
      if (map.getLayer('emergency-routes-layer'))
        map.setLayoutProperty('emergency-routes-layer', 'visibility', 'none');
      return;
    }

    // Show route-line layer
    if (map.getLayer('emergency-routes-layer'))
      map.setLayoutProperty('emergency-routes-layer', 'visibility', 'visible');

    // Async bootstrap: fetch all OSRM road routes in parallel then animate
    let cancelled = false;
    (async () => {
      // Fetch all road routes in parallel
      const paths = await Promise.all(
        responders.map((r) => fetchRoadRoute(r.origin, r.target)),
      );
      if (cancelled) return;

      // Paint dashed road-following route lines on the map
      const routeFeatures = responders.map((r, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: paths[i] },
        properties: { color: VEHICLE_COLOR[r.type] ?? '#ffffff', id: r.id },
      }));
      routeSrc?.setData({ type: 'FeatureCollection', features: routeFeatures });

      // Build path+step state per responder
      type VehState = { path: [number, number][]; step: number; marker: maplibregl.Marker; arrived: boolean };
      const vehMap = new Map<string, VehState>();

      responders.forEach((r, i) => {
        const path = paths[i];
        const el   = document.createElement('div');
        el.innerHTML = vehicleMarkerHTML(r.type, r.arrived);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(r.arrived ? r.target : path[0]).addTo(map);
        vehicleMarkersRef.current.push(marker);
        vehMap.set(r.id, { path, step: r.arrived ? path.length - 1 : 0, marker, arrived: r.arrived });
      });

      // Animate — step size targets ~20 s total travel time (was ~8 s)
      vehicleAnimRef.current = setInterval(() => {
        let allDone = true;
        vehMap.forEach((vs, id) => {
          if (vs.arrived) return;
          allDone = false;
          // Advance ~0.5% of route per 100 ms tick → full route in ~20 s
          const step = Math.max(1, Math.round(vs.path.length / 200));
          vs.step = Math.min(vs.step + step, vs.path.length - 1);
          vs.marker.setLngLat(vs.path[vs.step]);
          if (vs.step >= vs.path.length - 1) {
            vs.arrived = true;
            const responder = responders.find((r) => r.id === id);
            if (responder) {
              vs.marker.getElement().innerHTML = vehicleMarkerHTML(responder.type, true);
            }
          }
        });
        if (allDone) { clearInterval(vehicleAnimRef.current!); vehicleAnimRef.current = null; }
      }, 100);   // 100 ms tick × ~200 steps ≈ 20 s journey
    })();

    return () => { cancelled = true; };
  }, [trafficState?.emergencyResponders, trafficState?.accidentLocation, mapLoaded]);

  // ── AccidentTask live responder tracking markers ───────────────────────────
  // Renders position markers for tasks dispatched from AccidentResponsePanel.
  // Updates every render cycle based on task.currentPos (interpolated in the panel).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const rawAccident = accidentTasks ?? [];
    const rawWater = (waterTasks ?? []).map(wt => ({
      taskId:        wt.taskId,
      responderId:   wt.responderId,
      responderName: wt.responderName,
      role:          'maintenance' as const,
      status:        wt.status,
      origin:        wt.origin,
      destination:   wt.destination,
      currentPos:    wt.currentPos,
      distKm:        wt.distKm,
      etaSec:        wt.etaSec,
      sentAt:        wt.sentAt,
      acceptedAt:    wt.acceptedAt,
      arrivedAt:     wt.arrivedAt,
      resolvedAt:    wt.resolvedAt,
      routeCoords:   wt.routeCoords,
    }));
    const rawWaste = (wasteTasks ?? []).map(wt => ({
      taskId:        wt.taskId,
      responderId:   wt.responderId,
      responderName: wt.responderName,
      role:          'maintenance' as const,
      status:        wt.status,
      origin:        wt.origin,
      destination:   wt.destination,
      currentPos:    wt.currentPos,
      distKm:        wt.distKm,
      etaSec:        wt.etaSec,
      sentAt:        wt.sentAt,
      acceptedAt:    wt.acceptedAt,
      arrivedAt:     wt.arrivedAt,
      resolvedAt:    wt.resolvedAt,
      routeCoords:   wt.routeCoords,
    }));
    const tasks = [...rawAccident, ...rawWater, ...rawWaste];
    const existing = taskMarkersRef.current;

    // Track which taskIds are still present
    const activeIds = new Set(tasks.map(t => t.taskId));

    // Remove markers for tasks that no longer exist
    existing.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    });

    // Add or update markers for active tasks
    tasks.forEach(t => {
      if (t.status === 'RESOLVED') {
        // Remove resolved task markers
        existing.get(t.taskId)?.remove();
        existing.delete(t.taskId);
        return;
      }

      const vType = t.role === 'traffic_police' ? 'police'
        : t.role === 'fire'        ? 'fire'
        : t.role === 'ambulance'   ? 'ambulance'
        : t.role === 'maintenance' ? 'maintenance'
        : 'police';
      const arrived = t.status === 'ARRIVED';

      if (existing.has(t.taskId)) {
        // Update position of existing marker
        const marker = existing.get(t.taskId)!;
        marker.setLngLat(t.currentPos);
        if (arrived) {
          marker.getElement().innerHTML = vehicleMarkerHTML(vType, true);
        }
      } else if (t.status !== 'PENDING') {
        // Create new marker
        const el = document.createElement('div');
        el.innerHTML = vehicleMarkerHTML(vType, arrived);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(t.currentPos).addTo(map);
        existing.set(t.taskId, marker);
      }
    });
    // Update task-routes GeoJSON
    const taskRouteSrc = map.getSource('task-routes') as maplibregl.GeoJSONSource | undefined;
    if (taskRouteSrc) {
      const routeFeatures = tasks
        .filter(t => t.status === 'EN_ROUTE' || t.status === 'ACCEPTED')
        .filter(t => t.currentPos && t.destination)
        .map(t => {
          const hasRoute = t.routeCoords && t.routeCoords.length >= 2 ? 1 : 0;
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: hasRoute
                ? trimRoute(t.routeCoords!, t.currentPos)  // remaining road portion only
                : [t.currentPos, t.destination],
            },
            properties: {
              color:       ROLE_COLORS[t.role as keyof typeof ROLE_COLORS] ?? '#ffffff',
              hasRoute,
              lineWidth:   hasRoute ? 4.5 : 2,
              lineOpacity: hasRoute ? 0.9  : 0.45,
            },
          };
        });
      taskRouteSrc.setData({ type: 'FeatureCollection', features: routeFeatures });
    }
  }, [accidentTasks, waterTasks, wasteTasks, mapLoaded]);

  // ── Waste bin IoT markers ───────────────────────────────────────────────────
  // Shows a coloured marker for each IoT bin when wasteActive is true.
  // The overflowing bin gets a bold red highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    wasteBinMarkersRef.current.forEach(m => m.remove());
    wasteBinMarkersRef.current = [];

    if (!wasteActive) return;

    WASTE_BINS.forEach(bin => {
      const isOverflow = bin.id === overflowBinId;
      const level      = isOverflow ? 96 : bin.fillLevel;
      const color      = fillColor(level);
      const label      = fillLabel(level);
      const typeIcon   = BIN_TYPE_ICON[bin.binType];

      const el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;display:flex;flex-direction:column;align-items:center;';
      const shadow = isOverflow
        ? '0 0 0 3px #ef535099, 0 0 16px #ef535088'
        : '0 2px 6px #00000055';
      el.innerHTML = `
        <div style="
          background:${color}22;border:2px solid ${color};border-radius:8px;
          padding:3px 7px;font-size:10px;font-weight:700;color:${color};
          white-space:nowrap;box-shadow:${shadow};
          display:flex;align-items:center;gap:4px;
        ">
          ${typeIcon}
          <span style="font-size:9px;opacity:0.8">${bin.id}</span>
          <span>${level}%</span>
          <span style="font-size:8px;opacity:0.7">${label}</span>
        </div>
        <div style="width:2px;height:6px;background:${color};"></div>
      `;

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(bin.location)
        .addTo(map);

      wasteBinMarkersRef.current.push(marker);
    });

    return () => {
      wasteBinMarkersRef.current.forEach(m => m.remove());
      wasteBinMarkersRef.current = [];
    };
  }, [wasteActive, overflowBinId, mapLoaded]);

  // ── Water Pipeline Network layers ──────────────────────────────────────────
  const waterMarkersRef = useRef<maplibregl.Marker[]>([]);
  const waterDashRef    = useRef<number | null>(null);
  const waterAlertRef   = useRef<number | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Cleanup previous water layers
    const removeLayers = ['water-pipes-main', 'water-pipes-dist', 'water-pipes-svc',
                          'water-pipes-main-glow', 'water-pipes-burst',
                          'water-pipes-closed-glow', 'water-pipes-backup-glow',
                          'water-pipe-flow-main', 'water-pipe-flow-dist', 'water-pipe-flow-svc',
                          'water-node-markers', 'water-node-labels',
                          'water-spill-alert', 'water-spill-circle'];
    for (const lid of removeLayers) {
      if (map.getLayer(lid)) map.removeLayer(lid);
    }
    const removeSources = ['water-pipes', 'water-nodes', 'water-spill'];
    for (const sid of removeSources) {
      if (map.getSource(sid)) map.removeSource(sid);
    }
    // Remove markers
    waterMarkersRef.current.forEach(m => m.remove());
    waterMarkersRef.current = [];
    if (waterDashRef.current) { cancelAnimationFrame(waterDashRef.current); waterDashRef.current = null; }
    if (waterAlertRef.current) { cancelAnimationFrame(waterAlertRef.current); waterAlertRef.current = null; }

    if (!waterActive || !waterPipelines?.length || !waterNodes?.length) return;

    // ── Build pipeline GeoJSON ──
    const pipeFeatures: GeoJSON.Feature[] = waterPipelines.map((p: any) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: p.coordinates },
      properties: {
        id: p.id,
        type: p.type,
        status: p.status,
        pressure: p.pressure,
        flowRate: p.flowRate,
      },
    }));

    map.addSource('water-pipes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: pipeFeatures },
    });

    // ── Pipeline layers by type ──
    // Main pipelines — thick blue
    map.addLayer({
      id: 'water-pipes-main-glow',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'type'], 'main'],
      paint: {
        'line-color': '#1565C0',
        'line-width': 6,
        'line-opacity': 0.25,
        'line-blur': 4,
      },
    });
    map.addLayer({
      id: 'water-pipes-main',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'type'], 'main'],
      paint: {
        'line-color': ['case',
          ['==', ['get', 'status'], 'burst'],        '#ef5350',
          ['==', ['get', 'status'], 'leak'],         '#FF8A65',
          ['==', ['get', 'status'], 'low_pressure'], '#FFB74D',
          ['==', ['get', 'status'], 'closed'],       '#FF8C00',  // upstream valve closed → orange
          ['==', ['get', 'status'], 'backup'],       '#00E676',  // backup route → bright green
          '#42A5F5'
        ],
        'line-width': ['case',
          ['==', ['get', 'status'], 'burst'],  5,
          ['==', ['get', 'status'], 'closed'], 4,
          ['==', ['get', 'status'], 'backup'], 4,
          3.5,
        ],
        'line-opacity': 0.9,
      },
    });

    // Upstream (closed) glow layer — orange
    map.addLayer({
      id: 'water-pipes-closed-glow',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'status'], 'closed'],
      paint: {
        'line-color': '#FF8C00',
        'line-width': 10,
        'line-opacity': 0.18,
        'line-blur': 5,
      },
    });

    // Backup route glow layer — green
    map.addLayer({
      id: 'water-pipes-backup-glow',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'status'], 'backup'],
      paint: {
        'line-color': '#00E676',
        'line-width': 10,
        'line-opacity': 0.2,
        'line-blur': 5,
      },
    });

    // Distribution pipelines — green
    map.addLayer({
      id: 'water-pipes-dist',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'type'], 'distribution'],
      paint: {
        'line-color': ['case',
          ['==', ['get', 'status'], 'burst'],  '#ef5350',
          ['==', ['get', 'status'], 'leak'],   '#FF8A65',
          ['==', ['get', 'status'], 'closed'], '#FF8C00',
          ['==', ['get', 'status'], 'backup'], '#00E676',
          '#66BB6A'
        ],
        'line-width': 2.2,
        'line-opacity': 0.75,
      },
    });

    // Service pipelines — purple/thin
    map.addLayer({
      id: 'water-pipes-svc',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'type'], 'service'],
      paint: {
        'line-color': ['case',
          ['==', ['get', 'status'], 'burst'],  '#ef5350',
          ['==', ['get', 'status'], 'closed'], '#FF8C00',
          ['==', ['get', 'status'], 'backup'], '#00E676',
          '#AB47BC'
        ],
        'line-width': 1.4,
        'line-opacity': 0.55,
      },
    });

    // ── Animated flow dashes ──
    map.addLayer({
      id: 'water-pipe-flow-main',
      type: 'line',
      source: 'water-pipes',
      filter: ['all', ['==', ['get', 'type'], 'main'], ['!=', ['get', 'status'], 'burst']],
      paint: {
        'line-color': '#90CAF9',
        'line-width': 1.6,
        'line-dasharray': [0, 4, 3],
        'line-opacity': 0.6,
      },
    });
    map.addLayer({
      id: 'water-pipe-flow-dist',
      type: 'line',
      source: 'water-pipes',
      filter: ['all', ['==', ['get', 'type'], 'distribution'], ['!=', ['get', 'status'], 'burst']],
      paint: {
        'line-color': '#A5D6A7',
        'line-width': 1.2,
        'line-dasharray': [0, 4, 3],
        'line-opacity': 0.45,
      },
    });
    map.addLayer({
      id: 'water-pipe-flow-svc',
      type: 'line',
      source: 'water-pipes',
      filter: ['all', ['==', ['get', 'type'], 'service'], ['!=', ['get', 'status'], 'burst']],
      paint: {
        'line-color': '#CE93D8',
        'line-width': 0.9,
        'line-dasharray': [0, 4, 3],
        'line-opacity': 0.35,
      },
    });

    // ── Burst pipeline blinking ──
    map.addLayer({
      id: 'water-pipes-burst',
      type: 'line',
      source: 'water-pipes',
      filter: ['==', ['get', 'status'], 'burst'],
      paint: {
        'line-color': '#ef5350',
        'line-width': 5,
        'line-opacity': 0.7,
      },
    });

    // Animate flow dashes
    let dashStep = 0;
    const animateDash = () => {
      dashStep = (dashStep + 1) % 24;
      const d = dashStep / 6;
      try {
        if (map.getLayer('water-pipe-flow-main'))
          map.setPaintProperty('water-pipe-flow-main', 'line-dasharray', [d, 4, 3]);
        if (map.getLayer('water-pipe-flow-dist'))
          map.setPaintProperty('water-pipe-flow-dist', 'line-dasharray', [d, 4, 3]);
        if (map.getLayer('water-pipe-flow-svc'))
          map.setPaintProperty('water-pipe-flow-svc', 'line-dasharray', [d, 4, 3]);
        // Blink burst
        if (map.getLayer('water-pipes-burst')) {
          const op = 0.4 + Math.abs(Math.sin(dashStep * 0.3)) * 0.55;
          map.setPaintProperty('water-pipes-burst', 'line-opacity', op);
        }
      } catch { /* layer removed mid-animation */ }
      waterDashRef.current = requestAnimationFrame(animateDash);
    };
    waterDashRef.current = requestAnimationFrame(animateDash);

    // ── Node markers (HTML) ──
    const nodeIcons: Record<string, string> = {
      source: '💧',
      treatment: '🏭',
      storage: '🏢',
      pump: '⚙️',
      tap: '🚰',
      hydrant: '🚒',
      drinking: '🥤',
      building: '🏠',
    };
    const nodeColors: Record<string, string> = {
      source: '#4FC3F7',
      treatment: '#81C784',
      storage: '#4DD0E1',
      pump: '#FFB74D',
      tap: '#90CAF9',
      hydrant: '#ef5350',
      drinking: '#80DEEA',
      building: '#CE93D8',
    };

    for (const node of waterNodes as any[]) {
      const icon = nodeIcons[node.type] ?? '📍';
      const color = nodeColors[node.type] ?? '#fff';
      const isAffected = waterIncident?.affectedNodes?.includes(node.id);
      const el = document.createElement('div');
      el.style.cssText = `
        width: 26px; height: 26px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; cursor: pointer;
        background: ${isAffected ? 'rgba(239,83,80,0.3)' : `${color}22`};
        border: 2px solid ${isAffected ? '#ef5350' : color};
        box-shadow: 0 0 8px ${isAffected ? '#ef535088' : `${color}55`};
        ${isAffected ? 'animation: wpp-blink 1s ease infinite;' : ''}
      `;
      el.innerHTML = icon;
      el.title = `${node.name} (${node.type})`;

      const popup = new maplibregl.Popup({ offset: 18, closeButton: true, maxWidth: '220px' })
        .setHTML(`
          <div style="font-family:Inter,sans-serif;font-size:11px;color:#ccc;line-height:1.4">
            <b style="color:${color}">${node.name}</b><br/>
            Type: ${node.type}<br/>
            ${node.pressure != null ? `Pressure: ${node.pressure} PSI<br/>` : ''}
            ${node.flowRate != null ? `Flow: ${node.flowRate} L/min<br/>` : ''}
            ${node.population != null ? `Users: ${node.population}<br/>` : ''}
            ${node.capacity != null ? `Capacity: ${(node.capacity / 1000).toFixed(0)}k L<br/>` : ''}
            Status: <span style="color:${node.status === 'active' ? '#81C784' : '#ef5350'}">${node.status}</span>
            ${isAffected ? '<br/><span style="color:#ef5350">⚠ AFFECTED BY INCIDENT</span>' : ''}
          </div>
        `);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(node.location)
        .setPopup(popup)
        .addTo(map);
      waterMarkersRef.current.push(marker);
    }

    // ── Water spill effect + pulsing alert radius at incident location ──
    if (waterIncident?.location) {
      map.addSource('water-spill', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: waterIncident.location },
          properties: {},
        },
      });

      // Outer pulsing alert radius (animated)
      map.addLayer({
        id: 'water-spill-alert',
        type: 'circle',
        source: 'water-spill',
        paint: {
          'circle-radius': 50,
          'circle-color': '#ef5350',
          'circle-opacity': 0.08,
          'circle-blur': 1,
          'circle-stroke-color': '#ef5350',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.35,
        },
      });

      // Inner spill pool
      map.addLayer({
        id: 'water-spill-circle',
        type: 'circle',
        source: 'water-spill',
        paint: {
          'circle-radius': 22,
          'circle-color': '#42A5F5',
          'circle-opacity': 0.25,
          'circle-blur': 1,
          'circle-stroke-color': '#ef5350',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.7,
        },
      });

      // Add break icon marker
      const breakEl = document.createElement('div');
      breakEl.style.cssText = `
        font-size: 26px; cursor: pointer;
        animation: wpp-blink 0.7s ease infinite;
        filter: drop-shadow(0 0 8px rgba(239,83,80,0.9));
        transform-origin: center;
      `;
      breakEl.innerHTML = '💥';
      breakEl.title = `Pipeline Break — ${waterIncident.pipelineId}`;
      const breakMarker = new maplibregl.Marker({ element: breakEl, anchor: 'center' })
        .setLngLat(waterIncident.location)
        .addTo(map);
      waterMarkersRef.current.push(breakMarker);

      // Animate pulsing radius
      let alertRadius = 50;
      let alertGrow = true;
      const animateAlert = () => {
        alertRadius += alertGrow ? 0.7 : -0.7;
        if (alertRadius > 70) alertGrow = false;
        if (alertRadius < 40) alertGrow = true;
        try {
          if (map.getLayer('water-spill-alert')) {
            map.setPaintProperty('water-spill-alert', 'circle-radius', alertRadius);
            const alertOp = 0.04 + (alertRadius - 40) / 30 * 0.08;
            map.setPaintProperty('water-spill-alert', 'circle-opacity', alertOp);
          }
        } catch { /* layer removed */ }
        waterAlertRef.current = requestAnimationFrame(animateAlert);
      };
      // Start alert animation after dash animation setup
      setTimeout(() => {
        waterAlertRef.current = requestAnimationFrame(animateAlert);
      }, 100);
    }

    // Add CSS animation for blinking
    if (!document.getElementById('wpp-blink-style')) {
      const style = document.createElement('style');
      style.id = 'wpp-blink-style';
      style.textContent = `@keyframes wpp-blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`;
      document.head.appendChild(style);
    }

  }, [waterActive, waterNodes, waterPipelines, waterIncident, mapLoaded]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dso-map-wrapper">
      {/* Map container */}
      <div ref={containerRef} className="dso-map-container" />

      {/* Building / landmark tooltip */}
      <BuildingTooltip info={tooltip} />

      {/* Environment layer hover tooltip */}
      {envTooltip && (() => {
        const isRight = envTooltip.x > (containerRef.current?.clientWidth ?? 800) / 2;
        const style: React.CSSProperties = {
          position: 'absolute',
          top: envTooltip.y + 12,
          left: isRight ? 'auto' : envTooltip.x + 12,
          right: isRight ? ((containerRef.current?.clientWidth ?? 800) - envTooltip.x + 12) : 'auto',
          zIndex: 800,
          pointerEvents: 'none',
          background: 'rgba(8, 15, 28, 0.96)',
          border: '1px solid rgba(0, 229, 255, 0.22)',
          borderRadius: '10px',
          padding: '12px 14px',
          color: '#e0eaf5',
          fontFamily: 'Inter, sans-serif',
          fontSize: '12px',
          lineHeight: '1.6',
          minWidth: '230px',
          maxWidth: '290px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
        };

        if (envTooltip.type === 'sensor') {
          const s = envTooltip.data as EnvironmentSensor;
          const aqiColor = s.status === 'critical' ? '#ff4444' : s.status === 'warning' ? '#ff9900' : '#22c55e';
          const aqiLabel = s.aqi > 200 ? 'Very Unhealthy' : s.aqi > 150 ? 'Unhealthy' : s.aqi > 100 ? 'Sensitive Groups' : s.aqi > 50 ? 'Moderate' : 'Good';
          return (
            <div style={style}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                <span style={{ fontSize:'16px' }}>📡</span>
                <div>
                  <div style={{ fontWeight:700, fontSize:'13px', color:'#ffffff' }}>{s.name}</div>
                  <div style={{ color:'#aab8cc', fontSize:'11px' }}>{s.zone} · {s.type.toUpperCase()}</div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'8px',
                background:'rgba(255,255,255,0.06)', borderRadius:'6px', padding:'6px 8px' }}>
                <span style={{ fontSize:'22px', fontWeight:800, color: aqiColor }}>{s.aqi}</span>
                <div>
                  <div style={{ color: aqiColor, fontWeight:600, fontSize:'12px' }}>AQI · {aqiLabel}</div>
                  <div style={{ color:'#aab8cc', fontSize:'10px' }}>Air Quality Index</div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 12px', fontSize:'11px', color:'#c8d8e8' }}>
                <span>PM2.5</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.pm25} µg/m³</span>
                <span>PM10</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.pm10} µg/m³</span>
                <span>CO₂</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.co2} ppm</span>
                <span>NO₂</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.no2} µg/m³</span>
                <span>O₃</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.o3} µg/m³</span>
                <span>Temp</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.temperature}°C</span>
                <span>Humidity</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.humidity}%</span>
                <span>Wind</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{s.windSpeed} km/h</span>
              </div>
              <div style={{ marginTop:'8px', paddingTop:'6px', borderTop:'1px solid rgba(255,255,255,0.08)',
                color:'#8898aa', fontSize:'10px' }}>
                Last calibrated: {s.lastCalibration}
              </div>
            </div>
          );
        }

        // Pollution source tooltip
        const src = envTooltip.data as PollutionSource;
        const emColor = src.emissionRate === 'critical' ? '#ff4444' : src.emissionRate === 'high' ? '#ff9900'
          : src.emissionRate === 'medium' ? '#f59e0b' : '#22c55e';
        const typeIcon: Record<string, string> = {
          traffic:'🚦', industrial:'🏭', construction:'🏗️', hvac:'❄️', other:'🔴',
        };
        const mitigBadge: Record<string, string> = {
          none:'⚫ No Mitigation', monitoring:'🔵 Monitoring', active:'🟡 Active Response', resolved:'🟢 Resolved',
        };
        return (
          <div style={style}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
              <span style={{ fontSize:'18px' }}>{typeIcon[src.type] ?? '🔴'}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:'13px', color:'#ffffff' }}>{src.name}</div>
                <div style={{ color:'#aab8cc', fontSize:'11px' }}>
                  {src.type.charAt(0).toUpperCase() + src.type.slice(1)} Source · {src.activeHours}
                </div>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px',
              background:'rgba(255,255,255,0.06)', borderRadius:'6px', padding:'6px 8px' }}>
              <span style={{ fontWeight:700, fontSize:'13px', color: emColor,
                textTransform:'uppercase', letterSpacing:'0.5px' }}>{src.emissionRate}</span>
              <span style={{ color:'#aab8cc', fontSize:'11px' }}>emission rate · {src.contributionPercent}% of DSO pollution</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 12px', fontSize:'11px', color:'#c8d8e8' }}>
              <span>PM2.5</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.pollutants.pm25} µg/m³</span>
              <span>PM10</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.pollutants.pm10} µg/m³</span>
              <span>NO₂</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.pollutants.no2} µg/m³</span>
              <span>CO₂</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.pollutants.co2} ppm</span>
              <span>VOC</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.pollutants.voc} ppb</span>
              <span>Radius</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.affectedRadius} m</span>
              {src.trafficDensity != null && <><span>Traffic</span><span style={{ color:'#e0eaf5', fontWeight:600 }}>{src.trafficDensity} veh/h</span></>}
            </div>
            <div style={{ marginTop:'8px', paddingTop:'6px', borderTop:'1px solid rgba(255,255,255,0.08)',
              fontSize:'11px', color:'#aab8cc' }}>
              {mitigBadge[src.mitigationStatus] ?? src.mitigationStatus}
            </div>
            <div style={{ marginTop:'4px', fontSize:'10px', color:'#8898aa', lineHeight:'1.4' }}>
              {src.description}
            </div>
          </div>
        );
      })()}

      {/* Incident alert popup — shown when user clicks blinking marker */}
      {alertPopupOpen && activeIncident?.status === 'alert' && (
        <IncidentAlertPopup
          incident={activeIncident.incident}
          pos={alertPopupPos}
          onBeginResponse={() => {
            setAlertPopupOpen(false);
            onAlertAcknowledged?.();
          }}
          onClose={() => setAlertPopupOpen(false)}
        />
      )}

      {/* Compass & attribution branding */}
      <div className="dso-map-badge">
        <span className="dso-map-badge__dot" />
        Dubai Silicon Oasis
      </div>
    </div>
  );
}