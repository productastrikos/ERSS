export interface Landmark {
  id: string;
  name: string;
  coordinates: [number, number]; // [lng, lat]
  description: string;
  category: string;
}

export interface BuildingProperties {
  name?: string;
  height?: number;
  levels?: number;
  building?: string;
  amenity?: string;
}

export interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: BuildingProperties;
}

export interface TooltipInfo {
  x: number;
  y: number;
  object: BuildingFeature | null;
}

export interface LayerVisibility {
  boundary:       boolean;
  buildings:      boolean;
  roads:          boolean;
  parks:          boolean;
  water:          boolean;
  railways:       boolean;
  pois:           boolean;
  infrastructure: boolean;
  environment:    boolean;
}

// Environment sub-layer visibility controls
export interface EnvironmentLayerVisibility {
  heatmap:  boolean;
  sensors:  boolean;
  wind:     boolean;
  sources:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BMS — Building Management System types
// ─────────────────────────────────────────────────────────────────────────────

export type BMSSubView = 'overview' | 'energy' | 'hvac' | 'fire' | 'occupancy' | 'water' | 'alerts';
export type BMSLayerMode = 'status' | 'power' | 'hvac' | 'occupancy' | 'water';

// Water Pipeline Management views
export type WaterView = 'network' | 'monitoring' | 'incident';

// Smart Waste Management views
export type WasteView = 'bins' | 'monitoring' | 'incident';

export interface MapState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

// Rich building info passed from map click → sidebar panel
export interface SelectedBuilding {
  // Core OSM fields (always present from API)
  osm_id:       number | null;
  name:         string | null;
  building:     string | null;
  amenity:      string | null;
  shop:         string | null;
  tourism:      string | null;
  height:       string | null;
  levels:       string | null;
  building_use: string | null;
  street:       string | null;
  housenumber:  string | null;
  operator:     string | null;
  website:      string | null;
  // Extra tags loaded from Overpass API after click
  extra:        Record<string, string> | null;
  extraLoading: boolean;
}

// ── Incident Simulator types ────────────────────────────────────────────────

export interface IncidentStep {
  label: string;
  icon:  string;
}

export interface IncidentRole {
  role:           string;
  responsibility: string;
}

export type IncidentEffectType =
  | 'fire' | 'power_outage' | 'streetlight' | 'waste'
  | 'water' | 'drone' | 'traffic' | 'irrigation' | 'cyber' | 'ev_fault'
  | 'hvac' | 'air_pollution' | 'aqi_alert' | 'heat_zone' | 'pollution_plume'
  | 'pollution_spread' | 'heat_island';

export interface IncidentMapEffect {
  type:      IncidentEffectType;
  epicenter: [number, number];    // [lng, lat]
  radius:    number;              // metres for zone circle
  roadName?: string;              // for traffic highlighting
}

/** How the incident is categorised by the AI classification engine */
export interface IncidentClassification {
  type:     string;   // e.g. "Infrastructure Failure"
  category: string;   // e.g. "Power Grid"
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  score:    number;   // 0-100 priority score
}

/** AI-generated advisory for this incident type */
export interface AIAdvisory {
  riskLevel:  'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  impacts:    string[];   // potential consequences
  actions:    string[];   // recommended steps (shown as numbered list)
  etaMinutes: number;     // estimated resolution time
  confidence: number;     // AI confidence % (0-100)
}

/** Summary data shown in the post-incident analytics panel */
export interface IncidentAnalytics {
  cause:           string;
  impact:          string;
  responseMinutes: number;
  recommendation:  string;
  priorityScore:   number;
}

export interface Incident {
  id:             string;
  title:          string;
  shortTitle:     string;
  icon:           string;
  severity:       'critical' | 'high' | 'medium' | 'low';
  category:       string;
  zone:           string;
  description:    string;
  steps:          IncidentStep[];
  roles:          IncidentRole[];
  mapEffect:      IncidentMapEffect;
  sensors:        string[];
  classification: IncidentClassification;
  aiAdvisory:     AIAdvisory;
  analytics:      IncidentAnalytics;
}

/** Live telemetry / work-order data fetched per incident (API-first, JSON fallback) */
export interface IncidentLiveData {
  incident_id:   string;
  sensor_id:     string;
  sensor_value:  number;
  sensor_unit:   string;
  threshold:     number;
  work_order_id: string;
  assigned_team: string;
  timestamp:     string;
}

/** 8-stage operational workflow — mirrors real smart-city command-centre process */
export type WorkflowStage =
  | 'detected'    // sensor alert deployed on map, operator clicks marker
  | 'validated'   // anomaly confirmed against secondary sensors
  | 'classified'  // incident classified by AI engine (type / category / priority)
  | 'advisory'    // AI advisory generated — operator reviewing recommendations
  | 'dispatched'  // team selected and dispatched, technician auto-assigned + route set
  | 'enroute'     // technician on site — field status sub-steps active
  | 'repairing'   // active repair in progress
  | 'resolved';   // incident closed — post-incident analytics shown

/** Simulated on-site technician / response team member */
export interface TechnicianProfile {
  id:          string;
  name:        string;
  role:        string;
  phone:       string;
  coordinates: [number, number]; // [lng, lat]
}

/** Single entry in the incident timeline log */
export interface TimelineEvent {
  time:  string; // HH:MM
  label: string;
  icon:  string;
}

export interface ActiveIncidentState {
  incident:            Incident;
  /** alert    = marker placed on map, waiting for user to click & open popup
   *  running  = command-center panel open, user steps through workflow
   *  resolved = all stages completed */
  status:              'alert' | 'running' | 'resolved';
  workflowStage:       WorkflowStage;
  /** Telemetry / work-order data loaded on incident start */
  liveData?:           IncidentLiveData;
  /** Auto-assigned technician (set at dispatched stage) */
  assignedTechnician?: TechnicianProfile;
  /** [lng, lat] waypoints for deck.gl PathLayer (set when dispatched) */
  routePath?:          [number, number][];
  /** Live incident timeline events */
  timeline:            TimelineEvent[];
  /** Field sub-step index within enroute stage: 0=en-route, 1=arrived, 2=inspecting */
  fieldStatusStep:     number;
  /** Date.now() when workflow starts (for analytics duration calc) */
  startedAt:           number;
}

// Infrastructure element selected on the map
export interface SelectedInfra {
  osm_id:            number | null;
  name:              string | null;
  category:          string;
  highway:           string | null;
  man_made:          string | null;
  amenity:           string | null;
  power:             string | null;
  ref:               string | null;
  operator:          string | null;
  description:       string | null;
  height:            string | null;
  surveillance_type: string | null;
  crossing_type:     string | null;
  traffic_signals:   string | null;
  capacity:          string | null;
  recycling_type:    string | null;
  socket_type:       string | null;
  lngLat:            [number, number];
}

// ─────────────────────────────────────────────────────────────────────────────
//  TRAFFIC SIGNAL MANAGEMENT — types
// ─────────────────────────────────────────────────────────────────────────────

export type SignalState      = 'RED' | 'YELLOW' | 'GREEN' | 'FLASHING';
export type CongestionLevel  = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TrafficSimMode   = 'idle' | 'congestion' | 'accident';
export type TrafficView      = 'live' | 'congestion' | 'accident';

export interface TrafficSignal {
  signal_id:          string;
  name:               string;
  location:           [number, number]; // [lng, lat]
  connected_roads:    number;
  state:              SignalState;
  cycle_time:         number;
  vehicle_density:    number;
  green_time:         number;
  red_time:           number;
  status:             'ACTIVE' | 'FAULT' | 'OFFLINE';
  /** Seconds remaining in the CURRENT phase — computed per-tick by TrafficSignalManager */
  phaseRemainingSec?: number;
}

export interface RoadSegment {
  road_id:          string;
  name:             string;
  start:            [number, number];
  end:              [number, number];
  vehicle_count:    number;
  avg_speed:        number;
  congestion_level: CongestionLevel;
  congestion_index: number;
}

export interface TrafficIncident {
  id:          string;
  type:        'accident' | 'congestion' | 'roadwork';
  location:    [number, number];
  name:        string;
  description: string;
  severity:    'LOW' | 'MEDIUM' | 'HIGH';
  timestamp:   number;
  resolved:    boolean;
}

/** Emergency responder dispatched to an accident scene */
export interface EmergencyResponder {
  id:           string;
  type:         'ambulance' | 'fire' | 'police';
  poiName:      string;
  origin:       [number, number]; // [lng, lat] — POI location
  target:       [number, number]; // [lng, lat] — accident location
  dispatchedAt: number;           // Date.now()
  etaSec:       number;           // seconds to arrival
  arrived:      boolean;
}

export interface TrafficState {
  mode:                TrafficSimMode;
  activeView:          TrafficView;
  signals:             TrafficSignal[];
  roads:               RoadSegment[];
  incidents:           TrafficIncident[];
  predictionPct:       number;
  aiAdvisory:          AiAdvisory | null;
  emergencyResponders: EmergencyResponder[];
  accidentLocation:    [number, number] | null;
}

export interface AiAdvisory {
  title:       string;
  subtitle:    string;
  items:       string[];
  metric?:     string;
  clearTime?:  string;
}

