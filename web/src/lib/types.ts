/**
 * The domain model in TypeScript.
 *
 * RULE: the SQL is the source of truth and this file follows it, never the reverse.
 * The union types below mirror the enums in server/db/schema.sql exactly.
 *
 * This module is imported by BOTH surfaces (console and mobile). Neither surface
 * imports from the other — see docs/02-ARCHITECTURE §2 rule 1.
 */

// ── Enums (mirror schema.sql) ────────────────────────────────────────────────

export type AgencyCode =
  | 'DCAS' | 'POLICE' | 'CIVIL_DEFENCE' | 'COASTGUARD'
  | 'RTA' | 'MUNICIPALITY' | 'DEWA' | 'DHA' | 'NCEMA';

export type ZoneLevel = 'emirate' | 'sector' | 'community' | 'beat';

export type ZoneClass = 'urban' | 'suburban' | 'industrial' | 'freezone' | 'coastal' | 'desert';

export type UnitKind =
  | 'ALS' | 'BLS' | 'MICU' | 'MRU' | 'MCU' | 'SUPERCAR'
  | 'PRV' | 'FIRE' | 'RESCUE' | 'MARINE' | 'SUPERVISOR' | 'AIR';

export type UnitStatus =
  | 'off_duty' | 'available' | 'standby' | 'relocating' | 'assigned'
  | 'responding' | 'on_scene' | 'transporting' | 'at_hospital' | 'out_of_service';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export type IncidentState =
  | 'reported' | 'triaged' | 'dispatched' | 'responding' | 'on_scene'
  | 'transporting' | 'at_hospital' | 'resolved_on_scene' | 'cancelled'
  | 'non_emergency' | 'closed';

export type AssignState =
  | 'offered' | 'acknowledged' | 'declined' | 'timed_out' | 'enroute'
  | 'onscene' | 'transporting' | 'at_hospital' | 'resolved_on_scene'
  | 'cleared' | 'cancelled';

export type AdvisorySeverity = 'emergency' | 'warning' | 'alert' | 'info';

export type AdvisoryState = 'open' | 'analysing' | 'acted' | 'verifying' | 'closed' | 'dismissed';

export type IncidentSource =
  | 'call_998' | 'call_999' | 'call_997' | 'call_996' | 'app_sos'
  | 'aed_activation' | 'cad_feed' | 'sensor' | 'field_unit' | 'transfer';

export type EscalationLevel = 'LOCAL' | 'EMIRATE' | 'NRF_L1' | 'NRF_L2';

export type Role =
  | 'admin' | 'dispatcher' | 'duty_officer' | 'service_lead' | 'crisis_centre'
  | 'police_command' | 'hospital_coord' | 'infra_operator' | 'analyst'
  | 'responder' | 'citizen';

export type TriageTag = 'red' | 'yellow' | 'green' | 'black';

// ── The explainability envelope ──────────────────────────────────────────────

/**
 * Every engine output travels in this shape. The advisory and analytics components
 * take this type and CANNOT render without `factors` and `window` — which is how the
 * explainability requirement is made structural rather than aspirational.
 *
 * `confidence` is null when the engine cannot justify one. The UI then shows
 * "not enough data", which is more useful than a fabricated number.
 */
export interface EngineResult<T = number> {
  value: T | null;
  unit: string | null;
  confidence: number | null;
  window: { from: string; to: string };
  inputs: Array<{ source: string; rows: number; asOf?: string }>;
  factors: Array<{
    name: string;
    contribution: number;
    direction?: 'up' | 'down';
    detail?: string;
  }>;
  method: string;
  caveats: string[];
  meta: Record<string, unknown> & { insufficient?: boolean };
  computedAt: string;
}

// ── Core entities ────────────────────────────────────────────────────────────

export interface Agency {
  code: AgencyCode;
  name: string;
  short_name: string;
  emergency_no: string | null;
  glyph: string;
  series_slot: number;
  is_responder: boolean;
  sla_ack_sec: number;
  sla_scene_sec: number | null;
}

export interface Zone {
  ref: string;
  name: string;
  nameAr?: string | null;
  level: ZoneLevel;
  class: ZoneClass;
  parentRef?: string | null;
  population?: number | null;
  /** Dubai's daytime population exceeds its resident population by ~1.8M. */
  populationDaytime?: number | null;
  areaKm2?: number | null;
  highriseCount?: number;
}

export interface Station {
  ref: string;
  name: string;
  kind: string | null;
  /** false for Dubai's 33 unmanned Smart Police Stations — never a dispatch origin. */
  dispatchable: boolean;
  agencyCode: AgencyCode | null;
  zoneRef: string | null;
  makani: string | null;
  bays: number | null;
  lng: number;
  lat: number;
}

export type HospitalCapability =
  | 'trauma_l1' | 'stroke' | 'cath_lab' | 'burns' | 'paeds' | 'obstetric'
  | 'hyperbaric' | 'toxicology' | 'neurosurgery' | 'general';

export interface Hospital {
  ref: string;
  name: string;
  area: string | null;
  operatorClass: 'public' | 'private';
  zoneRef: string | null;
  makani: string | null;
  edBeds: number;
  edOccupied: number;
  edLoadPct: number | null;
  onDiversion: boolean;
  capabilities: HospitalCapability[];
  lng: number;
  lat: number;
}

export interface MakaniPoint {
  makani: string;
  /** Two groups of five, as the plaques show it. */
  formatted: string;
  buildingName: string | null;
  address: string | null;
  entranceNo: number;
  /** A building with many entrances gets a separate Makani number for EACH — which is
   *  the whole point of the system for emergency response. */
  entranceCount: number;
  entranceRole: string | null;
  floors: number | null;
  zoneRef: string | null;
  zoneName: string | null;
  lng: number;
  lat: number;
  otherEntrances?: Array<{ makani: string; entranceNo: number; entranceRole: string | null; lng: number; lat: number }>;
  simulated?: boolean;
}

export interface Aed {
  ref: string;
  siteName: string;
  siteKind: string | null;
  makani: string | null;
  /** DCAS runs a telemetry-enabled PAD network: opening a cabinet transmits to the
   *  control room and auto-generates a high-acuity incident. */
  telemetry: boolean;
  available: boolean;
  lng: number;
  lat: number;
  distanceM?: number;
}

export interface Unit {
  ref: string;
  callsign: string;
  kind: UnitKind;
  agencyCode: AgencyCode;
  homeStationRef: string | null;
  capabilities: string[];
  crewSize: number;
  status: UnitStatus;
  shiftStart: string | null;
  shiftEnd: string | null;
  lng: number | null;
  lat: number | null;
  heading: number | null;
  speed: number | null;
  lastSeenAt: string | null;
  standby?: { lng: number; lat: number; reason: string | null } | null;
  currentAssignmentRef?: string | null;
  currentAssignmentState?: AssignState | null;
  currentIncidentRef?: string | null;
}

/** The incident as the queue, the map and every socket event carry it. */
export interface Incident {
  ref: string;
  kind: string;
  subkind: string | null;
  priority: Priority;
  state: IncidentState;
  outcome: string | null;

  lng: number;
  lat: number;
  makani: string | null;
  zoneRef: string | null;
  zoneName: string | null;
  sectorRef: string | null;
  /** The vertical-city problem, first class. */
  floor: number | null;
  unitNo: string | null;
  accessNote: string | null;
  /** The Makani entrance the incident is attached to — never minted, always an existing one. */
  building: {
    name: string | null;
    entranceNo: number;
    entranceCount: number;
    entranceRole: string | null;
    floors: number | null;
  } | null;

  source: IncidentSource;
  callerName: string | null;
  callerPhone: string | null;
  callerRole: string | null;

  chiefComplaint: string | null;
  triageCode: string | null;
  acuity: number | null;
  patientsCount: number;

  reportedAt: string;
  triagedAt: string | null;
  dispatchedAt: string | null;
  /** Ambulance at the ENTRANCE. */
  firstOnsceneAt: string | null;
  /** Crew at the PATIENT. In a 163-floor tower these are not the same event, and the
   *  standard response clock stops at the wrong one. */
  firstAtPatientAt: string | null;
  closedAt: string | null;

  leadAgencyCode: AgencyCode | null;
  agenciesInvolved: AgencyCode[];
  escalationLevel: EscalationLevel;

  /** reported → first on scene, seconds. The same definition as v_incident_response. */
  responseSec: number | null;

  /** The unit carrying the incident now, if any. */
  primary: {
    assignmentRef: string;
    unitRef: string;
    callsign: string;
    unitKind: UnitKind;
    state: AssignState;
    offeredAt: string;
    etaPredictedAt: string | null;
    etaMethod: string | null;
  } | null;
  activeUnits: number;

  isSeed: boolean;
  /** Part of the demo resting state — synthesised, and marked as such on screen. */
  isResting: boolean;
  runRef: string | null;
}

export interface IncidentTimelineEntry {
  id: number;
  ts: string;
  stage: string;
  label: string;
  actorKind: string | null;
  actorId: string | null;
  agencyCode: AgencyCode | null;
  detail: Record<string, unknown>;
}

export interface DispatchFactor {
  key: 'travel' | 'capability' | 'coverage' | 'crew' | 'equity';
  name: string;
  weight: number;
  score: number;
  contribution: number;
  detail: string;
}

export interface DispatchRationale {
  score: number;
  factors: DispatchFactor[];
  capabilityMatch: string[];
  coverageCostPct: number;
  crewHoursOnShift: number | null;
  equityAdjustment: number;
  travel: { method: string; confidence: number | null; factors: EngineResult['factors']; caveats: string[] };
}

export interface DispatchRecommendation {
  rank: number;
  unitRef: string;
  callsign: string;
  kind: UnitKind;
  agencyCode: AgencyCode;
  status: UnitStatus;
  distanceM: number;
  straightM: number;
  travelSec: number;
  /** Now → at the entrance, including acknowledge and turnout. */
  arrivalSec: number;
  etaSec: number;
  etaInterval: { p25: number; p75: number };
  etaConfidence: number | null;
  etaMethod: string;
  /** A motorcycle can be first to a cardiac arrest and still not carry the patient. */
  canTransport: boolean;
  /** Why this unit — shown to the dispatcher BEFORE they approve, and stored forever. */
  rationale: DispatchRationale;
}

export type Recommendation = EngineResult<{
  recommendations: DispatchRecommendation[];
  excluded: Array<{ unitRef: string; callsign: string; kind: UnitKind; straightM: number; reason: string }>;
  requirement: { kind: string; required: string[]; preferred: UnitKind[]; notes: string[] };
  weights: Record<DispatchFactor['key'], number>;
  transport: { unitRef: string; rank: number; arrivalSec: number } | null;
  /** The vertical stage, predicted separately — never folded into travel. */
  vrt: EngineResult<{ seconds: number; p25: number; p75: number; band: string }> | null;
}>;

/** What was decided, kept on the assignment forever. */
export interface StoredRationale {
  engine: string;
  computedAt: string;
  selected: (Partial<DispatchRationale> & { rank: number | null; of: number; note?: string });
  recommendedTop: { unitRef: string; score: number; arrivalSec: number } | null;
  override: { reason: string; by: string } | null;
  redispatch: { after: string; reason: 'decline' | 'timeout'; attempt: number } | null;
  excluded: Array<{ unitRef: string; reason: string }>;
  caveats: string[];
  resting?: boolean;
}

export type AssignmentAction =
  | 'acknowledge' | 'decline' | 'enroute' | 'onscene' | 'at_patient'
  | 'transporting' | 'resolve' | 'at_hospital' | 'clear' | 'cancel';

export interface Assignment {
  ref: string;
  incidentRef: string;
  unitRef: string;
  callsign: string;
  unitKind: UnitKind;
  agencyCode: AgencyCode;
  state: AssignState;
  isPrimary: boolean;

  offeredAt: string;
  acknowledgedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  enrouteAt: string | null;
  onsceneAt: string | null;
  atPatientAt: string | null;
  transportingAt: string | null;
  atHospitalAt: string | null;
  clearedAt: string | null;

  hospitalRef: string | null;
  hospitalName: string | null;

  vrtSec: number | null;
  vrtBreakdown: { floor: number | null; liftUsed: boolean | null; predictedSec: number | null } | null;

  routeProposedSec: number | null;
  routeProposedM: number | null;
  routeTakenSec: number | null;
  routeTakenM: number | null;
  routeProposed: Array<[number, number]> | null;
  routeTaken: Array<[number, number]> | null;

  etaPredictedAt: string | null;
  etaMethod: string | null;
  /** Predicted vs actual — the model held to account. */
  etaErrorSec: number | null;

  dispatchRationale: StoredRationale | null;
  unitPosition: { lng: number; lat: number } | null;

  /** Rendered as buttons — the UI cannot offer what the server would refuse. */
  allowedActions: AssignmentAction[];
  canTransport: boolean;
}

export interface AgencyNotification {
  agencyCode: AgencyCode;
  agencyName: string;
  notifiedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  slaSec: number;
  channel: string;
  elapsedSec: number;
  /** null while unacknowledged and still inside the SLA — pending, not yet a breach. */
  met: boolean | null;
}

export interface IncidentNote {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  authorName: string;
  authorRef: string;
  agencyCode: AgencyCode | null;
}

export interface IncidentDetail {
  incident: Incident;
  timeline: IncidentTimelineEntry[];
  assignments: Assignment[];
  notifications: AgencyNotification[];
  notes: IncidentNote[];
  patients: Array<Pick<Patient, 'id' | 'seq' | 'eidLast3' | 'ageBand' | 'sex' | 'chiefComplaint' | 'triageTag' | 'gcs' | 'interventions' | 'outcome'>>;
  acknowledgeTimeoutSec: number;
  serverTime: string;
}

export type Correlation = EngineResult<{
  wind: {
    fromDeg: number; towardDeg: number; speedKph: number; tempC: number | null; condition: string | null;
    asOf: string; plume: { fromDeg: number; toDeg: number } | null;
  } | null;
  populationWithin: Array<{ radiusM: number; estimate: number; basis: string }>;
  sensitiveSites: Array<{ kind: string; label: string; name: string; distanceM: number }>;
  feeds: Array<{ key: string; name: string; agencyCode: AgencyCode; isSimulated: boolean; relevance: string }>;
  recommendedAgencies: Array<{ code: AgencyCode; reasons: string[] }>;
}>;

export interface HospitalChoice {
  ref: string;
  name: string;
  capabilities: string[];
  etaSec: number;
  etaConfidence: number | null;
  distanceM: number;
  edLoadPct: number;
  inbound: number;
  onDiversion: boolean;
  meetsRequirement: boolean;
  score: number;
  reasoning: string;
}

export type HospitalRanking = EngineResult<{
  hospitals: HospitalChoice[];
  excluded: Array<{ ref: string; name: string; reason: string }>;
  requirement: { capability: string; why: string } | null;
}>;

export interface KpiToday {
  window: { from: string; to: string };
  source: string;
  calls: number;
  responded: number;
  responseP50Sec: number | null;
  responseP90Sec: number | null;
  withinTargetPct: number | null;
  acknowledgeP50Sec: number | null;
  turnoutMeanSec: number | null;
  vrtP50Sec: number | null;
  vrtSamples: number;
  unitsOnDuty: number;
  unitsAvailable: number;
  unitsTotal: number;
  targetSec: number;
}

export type TriageResult = EngineResult<{ priority: Priority; code: string }>;

export interface CreateIncidentResult {
  incident: Incident;
  recommendation: Recommendation | null;
  recommendationError: string | null;
  triage: TriageResult | null;
}

export interface TransitionResult {
  assignment: Assignment;
  incident: Incident;
}

// ── Socket events (docs/04 §10) ──────────────────────────────────────────────

export interface UnitFrame {
  unitRef: string;
  lng: number;
  lat: number;
  heading: number | null;
  speed: number | null;
  status?: UnitStatus | null;
}

// ── The live picture: simulation, dashboard, feed, alerts ────────────────────

export type SimIntensity = 'quiet' | 'normal' | 'busy' | 'surge';

export interface SimState {
  running: boolean;
  intensity: SimIntensity;
  callsPerHour: number;
  autoDispatch: boolean;
  pace: 'real' | 'brisk';
  startedAt: string | null;
  startedBy: string | null;
  runRef: string | null;
  generated: number;
  autoDispatched: number;
  crews: { active: number; moving: number };
  /** The two scripted camera detections the simulation always opens with. There is one
   *  simulation control in the product; this is its progress, not a second thing to run. */
  opening: { crash: OpeningState };
  /** Calls the AI will dispatch by itself when the countdown ends. */
  pending: Array<{ incidentRef: string; dueAt: string; windowSec: number | null; priority: Priority; kind: string; zoneName: string | null }>;
  intensities: Array<{ key: SimIntensity; perHour: number }>;
}

export type OpeningState = 'idle' | 'running' | 'done' | 'failed';

// ── Camera detection ─────────────────────────────────────────────────────────

export type DetectionType = 'rta_junction';
export type DetectionStage = 'sensor' | 'validate' | 'confirm' | 'alert' | 'incident';

export interface Camera {
  id: string;
  name: string;
  kind: 'junction' | 'indoor';
  agencyCode: string;
  lng: number;
  lat: number;
  /** Compass degrees the camera LOOKS along; the map draws its view cone from this. */
  bearing: number;
  fovDeg: number;
  rangeM: number;
  signalId: string | null;
  buildingId: string | null;
  floor: number | null;
  roomId: string | null;
  analytics: string[];
  clipUrl: string;
  idleClipUrl: string;
}

export interface SopStep {
  id: string;
  label: string;
  owner: string;
  /** The platform has already done this by the time the operator reads the row. */
  auto: boolean;
  action: string | null;
}

export interface Detection {
  id: string;
  type: DetectionType;
  sop: {
    key: string;
    title: string;
    leadAgency: string;
    supportingAgencies: string[];
    advisory: { headline: string; clearTimeEstMin: number | null; signalPlan: string; diversion: string };
    steps: SopStep[];
  } | null;
  stage: DetectionStage | null;
  stageIndex: number;
  stageCount: number;
  detectedAt: string;
  cameras: Array<{
    id: string; name: string; kind: 'junction' | 'indoor';
    lng: number; lat: number; bearing: number;
    floor: number | null; roomId: string | null;
    clipUrl: string; primary: boolean;
  }>;
  place: {
    name: string; lng: number; lat: number;
    floor: number | null; roomName: string | null; buildingName: string | null;
    detail?: string;
    /** Present for an indoor detection: enough of the building to draw which floor of
     *  what, because a floor number on its own is not a place anyone can be sent to. */
    building?: {
      id: string; name: string; floors: number;
      rooms: Array<{ id: string; name: string; floor: number }>;
      roomId: string;
    };
  };
  evidence: Array<{ label: string; value: string; anomalous: boolean }>;
  corroboration: Array<{ source: string; result: string }>;
  verdict: {
    label: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; confidence: number;
    ruledOut: Array<{ label: string; answer: boolean }>;
  } | null;
  /** Calls received about this at the moment the camera raised it. The number the whole
   *  feature exists to make visible. */
  callsReceived: number;
  incidentRef: string | null;
  alertId: string | null;
  error: string | null;
}

export interface LiveAssignment {
  ref: string;
  state: AssignState;
  /** Which way the ambulance is driving: to the patient, or to hospital. */
  leg: 'scene' | 'hospital' | null;
  unitRef: string;
  callsign: string;
  unitKind: UnitKind;
  unitPosition: [number, number] | null;
  incidentRef: string;
  priority: Priority;
  kind: string;
  zoneName: string | null;
  incidentPosition: [number, number];
  hospital: { ref: string; name: string; position: [number, number] } | null;
  reportedAt: string;
  onsceneAt: string | null;
  etaPredictedAt: string | null;
  /** The road still ahead of the ambulance. */
  path: Array<[number, number]> | null;
  simulated: boolean;
  /** The congested stretches of the road ahead — SIMULATED in this build (server/sim/traffic.js). */
  traffic?: TrafficStretch[];
  trafficDelaySec?: number;
  remainingM?: number | null;
  speedKmh?: number | null;
}

/** One congested stretch of a route. Simulated in this build, and labelled so on screen. */
export interface TrafficStretch {
  level: 'moderate' | 'heavy';
  cause: 'traffic' | 'collision';
  /** Metres from the vehicle to the start of the stretch (0 when already in it). */
  inM?: number;
  lengthM: number;
  delaySec: number;
  path: Array<[number, number]>;
}

export interface LiveAssignments {
  at: string;
  assignments: LiveAssignment[];
  /** Units driving back to station or into a relocation post. */
  legs: Array<{ unitId: string; unitRef: string; leg: 'return' | 'relocate'; path: Array<[number, number]> }>;
}

export interface LiveSummary {
  at: string;
  kpi: KpiToday;
  targets: Record<Priority, number>;
  fleet: {
    available: number; standby: number; relocating: number; assigned: number; responding: number;
    onScene: number; transporting: number; atHospital: number; offDuty: number; outOfService: number; total: number;
  };
  active: { total: number; waiting: number; P1: number; P2: number; P3: number; P4: number };
  aiDispatch: { dispatches: number; savedSec: number; faster: number; avgSavedSec: number | null; basis: string };
  hospitals: Array<{ ref: string; name: string; edBeds: number; edOccupied: number; onDiversion: boolean; occupancyPct: number | null; inbound: number }>;
  trend: Array<{ hour: number; p50Sec: number | null; n: number }>;
  sim: SimState;
}

export interface FeedItem {
  id: number;
  ts: string;
  stage: string;
  label: string;
  incidentRef: string;
  priority: Priority | null;
  kind: string | null;
  zoneName: string | null;
  unitRef: string | null;
}

export type AlertActionKind = 'open_incident' | 'dispatch_recommended' | 'relocate';

export interface AlertItem {
  id: string;
  at: string;
  level: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  body: string | null;
  incidentRef: string | null;
  unitRef: string | null;
  zoneRef: string | null;
  priority: Priority | null;
  actions: Array<{ kind: AlertActionKind; label: string; payload?: Record<string, unknown> }>;
  popup: boolean;
  speech: string;
  acknowledged?: boolean;
}

// ── Insights — the Concept Note's demonstration screens ──────────────────────

/**
 * What every filtered response says about its own slice. `describe` is what a card prints
 * under its title, so a chart is never an anonymous subset of the data.
 */
export interface FilterEnvelope {
  describe: Array<{ label: string; value: string }>;
  active: boolean;
  summary: string;
  /** Engines that can only honour part of the filter name the rest here. */
  honoured?: string[];
  ignored?: string[];
}

/**
 * The provenance of a prediction. Rendered next to every forecast — a forecast without
 * its method and its measured error is a decoration (docs/00 D-09).
 */
export interface ForecastMeta {
  method: string;
  /** Walk-forward one-step error over the tail of the same series. */
  mae: number | null;
  mape: number | null;
  /** How often the 80% band actually contained the next observation. */
  coverage80Pct: number | null;
  sigma?: number | null;
  season?: number;
  n?: number;
  caveats: string[];
}

/** One forecast step: the point estimate and both prediction intervals. */
export interface Band {
  lower80: number;
  upper80: number;
  lower95?: number;
  upper95?: number;
}

/** What the universal filter bar offers, counted so a dead option never appears. */
export interface FilterOptions {
  window: { days: number; to: string };
  kinds: Array<{ value: string; label: string | null; n: number | null }>;
  priorities: Array<{ value: string; label: string | null; n: number | null }>;
  sources: Array<{ value: string; label: string | null; n: number | null }>;
  outcomes: Array<{ value: string; label: string | null; n: number | null }>;
  zones: Array<{ value: string; label: string; level: string; class: string; n: number }>;
  zoneClasses: Array<{ value: string; label: string | null; n: number | null }>;
  unitKinds: Array<{ value: string; label: string | null; n: number | null }>;
  agencies: Array<{ value: string; label: string | null; n: number | null }>;
  stations: Array<{ value: string; label: string; agency: string }>;
  complaints: Array<{ value: string; label: string | null; n: number | null }>;
  escalation: Array<{ value: string; label: string | null; n: number | null }>;
  dow: Array<{ value: number; label: string }>;
  floorMax: number | null;
}

export interface AlmanacCell {
  dow: number; hour: number; calls: number;
  /** Calls per week over the window — the comparable rate. */
  perWeek: number;
  /** Next week, empirical-Bayes shrunk towards weekday × hour independence. */
  predicted: number;
  p50Sec: number | null;
  p90Sec: number | null;
  withinTargetPct: number | null;
}
export interface AlmanacResult {
  window: { weeks: number; to: string };
  source: string;
  filters: FilterEnvelope;
  grid: AlmanacCell[];
  peak: number;
  predictedPeakValue: number;
  busiest: AlmanacCell | null;
  predictedBusiest: AlmanacCell | null;
  weeks: number;
  total: number;
  cellsWithData: number;
  forecast: { horizonWeeks: number; method: string; caveats: string[] };
}

export interface MonthlyResult {
  window: { months: number; to: string };
  source: string;
  filters: FilterEnvelope;
  actual: Array<{ month: string; calls: number; urgent: number; p50Sec: number | null }>;
  partialMonth: { month: string; calls: number; urgent: number; p50Sec: number | null; elapsedDays: number; daysInMonth: number; projectedCalls: number | null } | null;
  /** Starts at the CURRENT month, so it lines up with the seasonal-naive comparison. */
  forecast: Array<{ month: string; calls: number | null } & Partial<Band>>;
  forecastUrgent: Array<{ month: string; urgent: number } & Band>;
  forecastP50: Array<{ month: string; p50Sec: number } & Band>;
  forecastMeta: ForecastMeta;
  /** The Concept Note's simple rule, kept visible beside the fitted model. */
  seasonalNaive: Array<{ month: string; calls: number | null }>;
  method: string;
  yoy: number;
}

export interface DailyResult {
  window: { days: number; to: string };
  source: string;
  filters: FilterEnvelope;
  /** Completed days only — today is never plotted as a finished day. */
  series: Array<{ day: string; calls: number; p1: number; urgent: number; p50Sec: number | null; mean7: number }>;
  /** Today so far, reported separately so no forecast is ever fitted on a part-day. */
  partialDay: { day: string; calls: number; p1: number; urgent: number; p50Sec: number | null } | null;
  forecast: Array<{ day: string; calls: number } & Band>;
  forecastP1: Array<{ day: string; p1: number } & Band>;
  forecastP50: Array<{ day: string; p50Sec: number } & Band>;
  forecastMeta: ForecastMeta;
}

export interface CallTypeRow {
  kind: string; calls: number; priorCalls: number; sharePct: number; urgent: number;
  p50Sec: number | null; p90Sec: number | null; withinTargetPct: number | null;
  predictedCalls: number; predictedChangePct: number | null;
}
export interface CallTypesResult {
  window: { days: number; to: string };
  source: string;
  filters: FilterEnvelope;
  total: number;
  priorTotal: number;
  top: CallTypeRow[];
  bottom: CallTypeRow[];
  all: CallTypeRow[];
  forecast: { horizonDays: number; predictedTotal: number; predictedChangePct: number | null; method: string; caveats: string[] };
}

/**
 * One priority inside the circle: how many calls, how fast they were reached, and how
 * often that beat the priority's own target — with the same priority across the rest of
 * the filtered emirate, so "is it us or is it here" has an answer.
 */
export interface RadialPriority {
  priority: Priority;
  /** What the priority means, from the jurisdiction pack. */
  label: string;
  /** The response target this priority is held to, in seconds. */
  targetSec: number;
  calls: number;
  /** Calls an ambulance actually reached — the denominator of the timings. */
  reached: number;
  p50Sec: number | null;
  p90Sec: number | null;
  withinTargetPct: number | null;
  emirate: { calls: number; p50Sec: number | null; withinTargetPct: number | null };
}

export interface RadialResult {
  at: string;
  centre: { lng: number; lat: number };
  radiusM: number;
  window: { months: number; to: string };
  source: string;
  filters: FilterEnvelope;
  totals: {
    calls: number; perWeek: number; p50Sec: number | null; p90Sec: number | null;
    withinTargetPct: number | null; highriseCalls: number;
  };
  /** The same filtered slice WITHOUT the circle: this address against the rest of it. */
  emirate: { calls: number; p50Sec: number | null; p90Sec: number | null; withinTargetPct: number | null };
  /** Every priority, measured against its own target — see RadialPriority. */
  byPriority: RadialPriority[];
  byKind: Array<{ kind: string; calls: number }>;
  bySource: Array<{ source: IncidentSource; calls: number }>;
  hourly: Array<{ hour: number; calls: number }>;
  trend: Array<{ month: string; calls: number }>;
  forecast: Array<{ month: string; calls: number } & Band>;
  forecastMeta: ForecastMeta;
  buildings: Array<{ name: string; calls: number; urgent: number; floors: number | null; lng: number; lat: number }>;
  incidents: Array<{ ref: string; kind: string; priority: Priority; floor: number | null; reportedAt: string; lng: number; lat: number }>;
  nearestStations: Array<{ ref: string; name: string; distanceM: number; lng: number; lat: number }>;
}

export interface CompareTotals {
  calls: number; p1: number; p2: number; p3: number; p4: number;
  p50Sec: number | null; p90Sec: number | null; withinTargetPct: number | null;
}
export interface CompareRow {
  key: string; calls: number; priorCalls: number; delta: number; deltaPct: number | null;
  p50Sec: number | null; priorP50Sec: number | null;
  withinTargetPct: number | null; priorWithinTargetPct: number | null;
  /** The next window of the same length, from this row's own damped growth. */
  predictedCalls: number; predictedChangePct: number | null;
}
/** One extrapolated metric for the window after this one. */
export interface CompareNext { predicted: number; lower80: number; upper80: number; method: string }
export interface CompareResult {
  at: string;
  window: { days: number };
  source: string;
  filters: FilterEnvelope;
  current: CompareTotals;
  prior: CompareTotals;
  /** The window before the prior one: the third point the extrapolation needs. */
  before: CompareTotals;
  delta: { calls: number; callsPct: number | null; p50Sec: number | null; p90Sec: number | null; withinTargetPp: number | null };
  next: {
    calls: CompareNext | null; p1: CompareNext | null;
    p50Sec: CompareNext | null; withinTargetPct: CompareNext | null;
    method: string;
  };
  byKind: CompareRow[];
  byZone: CompareRow[];
  byHour: CompareRow[];
  byUnitKind: CompareRow[];
}

export interface CallCentreResult {
  window: { days: number; to: string };
  source: string;
  filters: FilterEnvelope;
  totals: {
    calls: number; dispatched: number; untriaged: number; perDay: number;
    callHandlingP50Sec: number | null; callHandlingP90Sec: number | null;
  };
  hourly: Array<{
    hour: number; calls: number; urgent: number;
    /** Per day — what the chart plots, so the measured profile and a one-day forecast
     *  share a scale. `calls` is the window total behind it. */
    callsPerDay: number; urgentPerDay: number;
    handlingP50Sec: number | null;
    /** Tomorrow's expectation for the same hour, where the horizon reaches it. */
    predictedCalls: number | null; lower80: number | null; upper80: number | null;
  }>;
  sources: Array<{ source: IncidentSource; calls: number }>;
  classes: Array<{ bucket: string; calls: number }>;
  complaints: Array<{ complaint: string; calls: number; urgent: number }>;
  daily: Array<{ day: string; calls: number }>;
  partialDay: { day: string; calls: number } | null;
  forecastDaily: Array<{ day: string; calls: number } & Band>;
  /** The next 24 hourly steps: what a roster is actually built against. */
  forecastHourly: Array<{ hour: number; dayOffset: number; calls: number } & Band>;
  forecastMeta: ForecastMeta & { daily: { method: string; mae: number | null; mape: number | null; coverage80Pct: number | null } };
  predictedPeakHour: { hour: number; dayOffset: number; calls: number } | null;
}

export interface EtaAccuracyResult {
  window: { days: number; to: string };
  source: string;
  filters: FilterEnvelope;
  samples: number;
  maeSec: number | null;
  medianErrorSec: number | null;
  within60Pct: number | null;
  within120Pct: number | null;
  earlyPct: number | null;
  histogram: Array<{ fromSec: number; toSec: number; n: number }>;
  trend: Array<{ day: string; maeSec: number | null; samples: number }>;
  forecast: Array<{ day: string; maeSec: number; lower80: number; upper80: number }>;
  forecastMeta: ForecastMeta;
}

export interface PerformanceResult {
  window: { days: number; to: string };
  source: string;
  filters: FilterEnvelope;
  totals: { calls: number; responded: number; p50Sec: number | null; p90Sec: number | null; withinTargetPct: number | null };
  stages: Array<{ key: string; label: string; meanSec: number | null }>;
  closeMeanSec: number | null;
  byZoneClass: Array<{ class: ZoneClass; calls: number; p50Sec: number | null; p90Sec: number | null; withinTargetPct: number | null }>;
  byPriority: Array<{ priority: Priority; calls: number; p50Sec: number | null; withinTargetPct: number | null }>;
  byUnitKind: Array<{ unitKind: UnitKind; calls: number; p50Sec: number | null; withinTargetPct: number | null }>;
  byHour: Array<{ hour: number; calls: number; p50Sec: number | null; withinTargetPct: number | null }>;
  byStation: Array<{ stationRef: string; station: string; calls: number; p50Sec: number | null; withinTargetPct: number | null }>;
  trend: Array<{ day: string; calls: number; p50Sec: number | null; withinTargetPct: number | null }>;
  partialDay: { day: string; calls: number; p50Sec: number | null; withinTargetPct: number | null } | null;
  forecast: {
    p50Sec: Array<{ day: string; p50Sec: number; lower80: number; upper80: number }>;
    withinTargetPct: Array<{ day: string; withinTargetPct: number; lower80: number; upper80: number }>;
    calls: Array<{ day: string; calls: number; lower80: number; upper80: number }>;
    meta: ForecastMeta;
  };
  preempt: { requests: number; granted: number; grantPct: number | null; meanSavedSec: number | null; totalSavedSec: number };
  eta: EtaAccuracyResult;
}

export interface ReplayableItem {
  ref: string; kind: string; priority: Priority; reportedAt: string; zoneName: string | null;
  responseSec: number | null; deltaSec: number | null; unitRef: string;
}

export interface ReplayAssignment {
  ref: string; state: AssignState; unitRef: string; callsign: string; unitKind: UnitKind;
  isPrimary: boolean; hospitalName: string | null;
  offeredAt: string; acknowledgedAt: string | null; enrouteAt: string | null; onsceneAt: string | null;
  atPatientAt: string | null; transportingAt: string | null; atHospitalAt: string | null; clearedAt: string | null;
  routeProposed: Array<[number, number]> | null; routeTaken: Array<[number, number]> | null;
  /** The road driven on the transport leg — the second half of the job. */
  routeHospital: Array<[number, number]> | null;
  routeProposedSec: number | null; routeTakenSec: number | null;
  routeHospitalSec: number | null; routeHospitalM: number | null;
  routeProposedM: number | null; routeTakenM: number | null;
  hospital: { name: string | null; lng: number; lat: number } | null;
  etaPredictedAt: string | null; etaErrorSec: number | null; vrtSec: number | null;
}

export interface ReplayResult {
  incident: {
    ref: string; kind: string; priority: Priority; state: IncidentState; outcome: string | null;
    lng: number; lat: number; floor: number | null; makani: string | null;
    buildingName: string | null; buildingFloors: number | null; zoneName: string | null; chiefComplaint: string | null;
    reportedAt: string; triagedAt: string | null; dispatchedAt: string | null;
    firstOnsceneAt: string | null; firstAtPatientAt: string | null; closedAt: string | null;
    responseSec: number | null;
  };
  assignments: ReplayAssignment[];
  route: {
    unitRef: string; proposedSec: number | null; takenSec: number | null;
    proposedM: number | null; takenM: number | null; savedSec: number | null;
    predictedAt: string | null; actualAt: string | null; errorSec: number | null;
  } | null;
  timeline: Array<{ ts: string; stage: string; label: string; detail: Record<string, unknown> }>;
  agencySla: Array<{ agencyCode: AgencyCode; agencyName: string; notifiedAt: string; acknowledgedAt: string | null; ackSec: number | null; slaSec: number; met: boolean | null }>;
  track: Array<{ unitRef: string; ts: string; lng: number; lat: number; speed: number | null; status: UnitStatus }>;
}

/** What a citizen watching their own SOS is shown — never another caller's, never history. */
export interface SosStatus {
  ref: string;
  state: IncidentState;
  assignmentState: AssignState | null;
  unitKind: UnitKind | null;
  unitCallsign: string | null;
  unitRef: string | null;
  etaSec: number | null;
  distanceM: number | null;
  assignedAt: string | null;
  onsceneAt: string | null;
  reportedAt: string;
  unitLng: number | null;
  unitLat: number | null;
  unitHeading: number | string | null;
  incidentLng: number | null;
  incidentLat: number | null;
  /** The road still between the ambulance and the caller, while it is on its way. */
  route: Array<[number, number]> | null;
  timeline: Array<{ ts: string; label: string }>;
}

export interface ServerEvents {
  'incident:new': Incident;
  'incident:update': { ref: string; patch: Incident };
  'incident:timeline': { ref: string; row: IncidentTimelineEntry };
  'incident:closed': { ref: string; outcome: string | null };
  'assignment:offer': { assignment: Assignment; incident: Incident; route: Array<[number, number]> | null; acknowledgeBy: string };
  'assignment:update': { ref: string; incidentRef: string; unitRef: string; state: AssignState; at: string };
  'unit:position': UnitFrame[];
  'units:snapshot': { at: string; units: Unit[] };
  'agency:notified': { incidentRef: string; agency: AgencyCode; at: string; slaSec: number };
  'kpi:tick': { at: string };
  'run:clock': ClockSnapshot;
  'feed:item': FeedItem;
  'alert:new': AlertItem;
  'sim:state': SimState;
  'detection:stage': Detection;
  'decision:update': DecisionPreview;
  'dispatch:rules': DispatchRulesState;
  notify: { level: 'info' | 'warning' | 'danger' | 'success'; title: string; body: string; link?: string };
}

export interface Patient {
  id: string;
  seq: number;
  eidLast3: string | null;
  ageBand: string | null;
  sex: string | null;
  chiefComplaint: string | null;
  triageTag: TriageTag | null;
  gcs: number | null;
  nabidhPulledAt: string | null;
  nabidhSummary: NabidhSummary | null;
  interventions: string[];
  destinationRef: string | null;
  prealertSentAt: string | null;
  prealertAckAt: string | null;
  outcome: string | null;
}

export interface NabidhSummary {
  allergies: Array<{ substance: string; severity: string; reaction?: string }>;
  conditions: Array<{ code: string; display: string; onset?: string }>;
  medications: Array<{ name: string; dose?: string; route?: string }>;
  encounters: Array<{ date: string; facility: string; reason: string }>;
  simulated: boolean;
}

export interface TelemetrySample {
  ts: string;
  hr: number | null;
  spo2: number | null;
  bpSys: number | null;
  bpDia: number | null;
  respRate: number | null;
  tempC: number | null;
  etco2: number | null;
  rhythm: string | null;
  ecgWaveform?: number[];
}

export interface Advisory {
  ref: string;
  severity: AdvisorySeverity;
  category: string;
  title: string;
  body: string;
  state: AdvisoryState;
  /** The explainability payload, rendered verbatim by the drill-down. */
  evidence: {
    method: string;
    window: { from: string; to: string };
    inputs: Array<{ source: string; rows: number; asOf?: string }>;
    factors: Array<{ name: string; contribution: number; direction?: 'up' | 'down'; detail?: string }>;
    confidence: number | null;
    sampleSize?: number;
    baseline?: number;
    target?: number;
  };
  zoneRefs: string[];
  incidentRef: string | null;
  recommendedAction: string | null;
  assignedAgencyCode: AgencyCode | null;
  ownerRef: string | null;
  actedAt: string | null;
  slaDueAt: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  measuredValue: number | null;
  detector: string;
  createdAt: string;
}

// ── Session & bootstrap ──────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  ref: string;
  name: string;
  role: Role;
  roleLabel: string;
  surface: 'console' | 'mobile';
  agencyCode: AgencyCode | null;
  zoneScope: string[];
  unitId: string | null;
  locale: string;
  capabilities: string[];
}

export interface ClockSnapshot {
  runRef: string | null;
  state: 'idle' | 'running' | 'paused';
  speed: number;
  cursorSec: number;
  now: string;
  isScenario: boolean;
}

export interface IntegrationStatus {
  live: boolean;
  label: string;
}

/**
 * What this build is scoped to. With `enabled`, the console is the agreed trial: a small
 * ambulance fleet, road incidents only, raised by cameras and dispatched automatically.
 */
export interface PocScope {
  enabled: boolean;
  /** Ambulances in the trial — quoted, not counted, so the agreed number is the one shown. */
  fleetSize: number;
  camerasPerUnit: number;
  /** No floors, rooms or buildings: every incident is on the carriageway. */
  roadOnly: boolean;
  /** False: no 998 call stream and no manual call-taking — cameras raise the work. */
  calls: boolean;
}

export interface Bootstrap {
  user: SessionUser | null;
  jurisdiction: {
    code: string;
    name: string;
    country: string;
    timezone: string;
    locale: string;
    bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
    centre: { lng: number; lat: number };
    hierarchy: { levels: ZoneLevel[]; labels: Record<ZoneLevel, string>; sectorCount: number };
    priorities: Array<{ code: Priority; label: string; targetSec: number; share: number }>;
    targets: Record<string, number | string>;
    population: { resident: number; daytime: number; daytimeWindow: { fromHour: number; toHour: number } };
    escalationLevels: Array<{ code: EscalationLevel; label: string; authority: string }>;
    dataClassification: string[];
  };
  /** The proof-of-concept scope (server/config/poc.js). */
  poc: PocScope;
  agencies: Agency[];
  feeds: Array<{
    key: string; name: string; kind: string; classification: string;
    is_simulated: boolean; last_update: string | null; agency_code: AgencyCode;
  }>;
  scenarios: Array<{ ref: string; name: string; summary: string; tier: number; duration_sec: number; grounding: Record<string, unknown> }>;
  activeRun: { ref: string; state: string; speed: number; cursor_sec: number; scenario_ref: string; name: string } | null;
  clock: ClockSnapshot;
  /** Which integrations are LIVE and which are mocked — drives the permanent
   *  "simulated source" chips. Being visibly honest about this is worth more in a
   *  tender demo than appearing to have every integration. */
  integrations: Record<'makani' | 'nabidh' | 'cad' | 'rta' | 'push' | 'llm', IntegrationStatus>;
  audit: { seq: number; ts: string } | null;
  serverTime: string;
}

// ── API helpers ──────────────────────────────────────────────────────────────

export interface Paged<T> {
  items: T[];
  nextCursor: string | number | null;
}

export interface ApiErrorShape {
  error: { code: string; message: string; detail?: unknown; hint?: string };
}

export type GeoJSONFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }>;
  meta?: Record<string, unknown>;
};


// ── The AI's reasoning, and the detail behind the dashboard's cards ─────────
//
// server/services/decisions.js, dispatchRules.js, liveDetail.js.

export interface DecisionFactor { key: string; name?: string; weight: number; score: number; contribution: number; detail?: string }

export interface DecisionCandidate {
  unitRef: string;
  callsign: string;
  kind: UnitKind;
  rank: number;
  score: number;
  arrivalSec: number;
  travelSec: number;
  distanceM: number;
  straightM: number;
  trafficDelaySec: number;
  canTransport: boolean;
  position?: [number, number] | null;
  route?: { path: Array<[number, number]>; distanceM: number; delaySec: number; congestedM: number; traffic: TrafficStretch[] } | null;
  factors: DecisionFactor[];
}

/** What the AI is weighing for an incident, pushed the moment it knows (socket `decision:update`). */
export interface DecisionPreview {
  incidentRef: string;
  status: 'thinking' | 'ready' | 'no_unit' | 'failed';
  startedAt: string;
  readyAt: string | null;
  thinkMs: number | null;
  fleet: Array<{ ref: string; callsign: string; kind: UnitKind; status: UnitStatus; position: [number, number] | null; onIncident: string | null }>;
  candidates: DecisionCandidate[];
  chosen: string | null;
  firstChoice: string | null;
  notes: Array<{ key: string; text: string; tone: string; at: string }>;
}

export type StepTone = 'info' | 'ai' | 'good' | 'warn' | 'bad' | 'muted';

export interface DecisionStep {
  key: string;
  at: string;
  state: 'done' | 'active';
  tone: StepTone;
  title: string;
  detail?: string | null;
  items: Array<{ label: string; value: string; tone?: StepTone }>;
  /** Which ambulance(s) this step concerns — the whole scanned fleet, the top routed/
   *  scored candidates, or the one chosen/assigned unit. Lets the live map highlight the
   *  ambulances a step is talking about as the AI log advances. */
  unitRefs?: string[];
}

export interface CrewMember { name: string; role: 'driver' | 'lead' | 'physician'; title: string; staffId: string; yearsService: number; certs: string[] }

export interface UnitProfile {
  demo: true;
  plate: string;
  vehicle: string;
  year: number;
  equipment: string[];
  crew: CrewMember[];
  driver: CrewMember | null;
  lead: CrewMember | null;
  cameras: Array<{ id: string; name: string; facing: 'road' | 'cab'; note: string }>;
}

export interface LiveDrive {
  remainingM: number;
  speedKmh: number | null;
  trafficAhead: Array<Omit<TrafficStretch, 'path'>>;
}

export type DecisionPhase = 'detected' | 'thinking' | 'decided' | 'dispatched' | 'enroute' | 'onscene' | 'transport' | 'closed';

export interface DecisionTrace {
  at: string;
  incident: {
    ref: string; kind: string; kindLabel: string; priority: Priority; state: IncidentState;
    place: string; zoneName: string | null; position: [number, number]; reportedAt: string; targetSec: number;
    source: string; detectedBy: string | null; patients: number; complaint: string | null;
    firstOnsceneAt: string | null; closedAt: string | null; detectionId: string | null;
  };
  phase: DecisionPhase;
  steps: DecisionStep[];
  candidates: DecisionCandidate[];
  chosenRef: string | null;
  preview: { status: DecisionPreview['status']; startedAt: string; readyAt: string | null; thinkMs: number | null; trafficApplied: boolean; mode: 'ai' | 'custom' | null } | null;
  pending: { dueAt: string; windowSec: number | null; held: boolean } | null;
  assignment: {
    ref: string; state: AssignState; unitRef: string; callsign: string; unitKind: UnitKind;
    etaPredictedAt: string | null; hospital: { ref: string; name: string } | null;
    profile: UnitProfile | null; live: LiveDrive | null;
  } | null;
}

export interface DispatchRules {
  autoDispatch: Record<Priority, boolean>;
  windowSec: Record<Priority, number>;
  weights: { travel: number; capability: number; coverage: number; crew: number };
  requireAlsForP1: boolean;
  reserveMin: number;
  escalateArrivalSec: number;
  avoidTraffic: boolean;
}

export interface DispatchRulesState {
  mode: 'ai' | 'custom';
  rules: DispatchRules;
  notes: string[];
  fleet: { free: number | null; total: number };
  updatedBy: string | null;
  updatedAt: string | null;
  aiDefaults: DispatchRules;
  custom: DispatchRules | null;
  limits: { windowSec: [number, number]; reserveMin: [number, number]; escalateArrivalSec: [number, number] };
}

export interface AutoDispatchReport {
  at: string;
  rules: DispatchRulesState;
  outlook: {
    units: Array<{ ref: string; callsign: string; kind: UnitKind; status: UnitStatus; free: boolean; state: AssignState | null; incidentRef: string | null; priority: Priority | null; position: [number, number] | null; freeInSec: number | null }>;
    freeNow: number; freeIn10: number; freeIn20: number; basis: string;
  };
  demand: { perHour: number; samples: number; basis: string } | null;
  stats: {
    dispatches: number; medianDecisionSec: number | null; medianResponseSec: number | null; savedSec: number;
    fasterThanNearest: number; medianAbsEtaErrorSec: number | null; overrides: number; manual: number;
  };
  decisions: Array<{
    assignmentRef: string; incidentRef: string; priority: Priority; kind: string; zoneName: string | null;
    unitRef: string; callsign: string; byAi: boolean; rank: number | null; of: number | null;
    decisionSec: number; responseSec: number | null; savedSec: number; nearest: string | null;
    etaErrorSec: number | null; trafficApplied: boolean; override: { reason: string; by: string } | null; offeredAt: string;
  }>;
  findings: Array<{ severity: 'high' | 'medium' | 'info' | 'good'; title: string; detail: string }>;
}

export interface UnitDetail {
  at: string;
  unit: Unit & { stationName: string | null };
  profile: UnitProfile | null;
  telemetry: { speedKmh: number; heading: number | null; lightsAndSiren: boolean; lastFixSecAgo: number | null; position: [number, number] | null };
  job: {
    assignmentRef: string; state: AssignState; incidentRef: string; kind: string; priority: Priority; zoneName: string | null;
    hospitalName: string | null; reportedAt: string; etaPredictedAt: string | null; remainingM: number | null;
    trafficAhead: LiveDrive['trafficAhead'];
  } | null;
  today: {
    jobs: number; completed: number; medianResponseSec: number | null; distanceKm: number; busyPct: number | null; onShiftSec: number | null;
    recent: Array<{ assignmentRef: string; incidentRef: string; kind: string; priority: Priority; zoneName: string | null; state: AssignState; offeredAt: string; responseSec: number | null }>;
  };
}
