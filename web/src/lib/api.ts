/**
 * The REST client. EVERY call to the backend goes through this module.
 *
 * Shared by both surfaces — the console and the mobile app cannot drift on what an
 * Incident is, because they call the same functions and import the same types.
 *
 * Rule from docs/02-ARCHITECTURE §6: writes go over REST, fan-out over the socket, and
 * every screen must render correctly from REST alone.
 */

import type { GeoSurface } from '../shared/map/geo/hexbin';
import type {
  Bootstrap, SessionUser, Zone, Agency, Station, Hospital, MakaniPoint, Aed,
  Incident, Unit, Assignment, Advisory, Paged, ApiErrorShape, GeoJSONFeatureCollection,
  AgencyNotification, Patient, IncidentDetail, Recommendation, Correlation, HospitalRanking,
  KpiToday, CreateIncidentResult, TransitionResult, AssignmentAction, AgencyCode,
  SimState, SimIntensity, LiveAssignments, LiveSummary, FeedItem, AlertItem, Priority, SosStatus,
  AlmanacResult, MonthlyResult, DailyResult, CallTypesResult, RadialResult, CompareResult,
  CallCentreResult, PerformanceResult, EtaAccuracyResult, ReplayableItem, ReplayResult,
  FilterOptions, Camera, Detection,
  DecisionTrace, AutoDispatchReport, UnitDetail, DispatchRules, DispatchRulesState,
} from './types';
import { getToken } from './authToken';

/** In dev, Vite proxies /api to the backend so the browser sees ONE origin — cookies
 *  and CORS then behave exactly as they do behind nginx in production. */
const BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * A fresh Idempotency-Key — one per user intent (one click), reused if that click is
 * retried. crypto.randomUUID is absent on a plain-http LAN origin, hence the fallback.
 */
export function idempotencyKey(): string {
  const c = globalThis.crypto as Partial<Crypto> | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ApiError extends Error {
  code: string;
  status: number;
  detail?: unknown;
  hint?: string;
  constructor(status: number, body: ApiErrorShape | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.detail = body?.error?.detail;
    this.hint = body?.error?.hint;
  }
  get isAuth() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isOffline() { return this.status === 0; }
  get isDbDown() { return this.code === 'db_unavailable'; }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(
  path: string,
  init: RequestInit & { query?: Query; idempotencyKey?: string } = {},
): Promise<T> {
  const { query, idempotencyKey, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(query)}`, {
      ...rest,
      headers,
      // The session travels as this tab's Bearer token (lib/authToken.ts). Cookies are
      // deliberately NOT sent: one shared cookie would make every tab the same user.
      credentials: 'omit',
    });
  } catch {
    // Network failure, not an HTTP error. Status 0 lets callers distinguish
    // "offline" from "the server said no".
    throw new ApiError(0, null, 'Cannot reach the server');
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) throw new ApiError(res.status, body, res.statusText || 'Request failed');
  return body as T;
}

const get  = <T>(p: string, query?: Query) => request<T>(p, { method: 'GET', query });
const post = <T>(p: string, data?: unknown, opts: { idempotencyKey?: string } = {}) =>
  request<T>(p, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data), ...opts });
const patch = <T>(p: string, data?: unknown) =>
  request<T>(p, { method: 'PATCH', body: data === undefined ? undefined : JSON.stringify(data) });
const put = <T>(p: string, data?: unknown) =>
  request<T>(p, { method: 'PUT', body: data === undefined ? undefined : JSON.stringify(data) });
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' });

// ═══════════════════════════════════════════════════════════════════════════════

export const api = {
  // ── Meta ──────────────────────────────────────────────────────────────────
  health: () => get<{ status: string; database: string; target: string; postgis: string | null }>('/health'),
  version: () => get<{ name: string; version: string; node: string; env: string }>('/version'),
  /** Everything a surface needs on load, in ONE round trip. */
  bootstrap: () => get<Bootstrap>('/api/bootstrap'),

  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    login: (identifier: string, password: string) =>
      post<{ user: SessionUser; expiresAt: string; token: string }>('/api/auth/login', { identifier, password }),
    logout: () => post<{ ok: true }>('/api/auth/logout'),
    me: () => get<{ user: SessionUser }>('/api/auth/me'),
  },

  // ── Reference ─────────────────────────────────────────────────────────────
  zones: (q?: { level?: string; parent?: string; geometry?: 'full' | 'centroid' | 'none' }) =>
    get<GeoJSONFeatureCollection>('/api/zones', q),
  zone: (ref: string) => get<Zone & { geometry: unknown; children: Zone[] }>(`/api/zones/${ref}`),
  agencies: () => get<Agency[]>('/api/agencies'),
  /** dispatchable defaults to true — Dubai's 33 Smart Police Stations are unmanned and
   *  must never appear as a dispatch origin. */
  stations: (q?: { agency?: string; dispatchable?: boolean }) => get<Station[]>('/api/stations', q),
  hospitals: (q?: { capability?: string }) => get<Hospital[]>('/api/hospitals', q),
  makani: (code: string) => get<MakaniPoint>(`/api/makani/${code.replace(/\s/g, '')}`),
  makaniReverse: (lng: number, lat: number, limit = 5) =>
    get<MakaniPoint[]>('/api/makani/reverse/search', { lng, lat, limit }),
  aeds: (q?: { lng?: number; lat?: number; radius?: number }) => get<Aed[]>('/api/aeds', q),
  /** The camera estate the detection engine watches — drawn on the live map whether or
   *  not anything is happening on it. */
  cameras: () => get<Camera[]>('/api/cameras'),

  // ── Map layers (ported from the retired FastAPI) ──────────────────────────
  layers: {
    roads: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/roads', { bbox }),
    buildings: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/buildings', { bbox }),
    pois: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/pois', { bbox }),
    parks: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/parks', { bbox }),
    water: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/water', { bbox }),
    railways: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/railways', { bbox }),
    infrastructure: (bbox?: string) => get<GeoJSONFeatureCollection>('/api/layers/infrastructure', { bbox }),
    all: (bbox?: string) => get<{ bbox: number[]; source: string; layers: Record<string, GeoJSONFeatureCollection> }>('/api/layers/all', { bbox }),
  },

  // ── Incidents ─────────────────────────────────────────────────────────────
  incidents: {
    /** `active` — everything not closed, priority then longest waiting. `all` — today,
     *  newest first, keyset-paged. */
    list: (q?: {
      status?: 'active' | 'all'; priority?: string; kind?: string; zone?: string;
      from?: string; to?: string; bbox?: string; limit?: number; cursor?: string;
    }) => get<Paged<Incident>>('/api/incidents', q),

    get: (ref: string) => get<IncidentDetail>(`/api/incidents/${ref}`),

    /** Returns the incident with its dispatch recommendation already attached. */
    create: (data: {
      kind: string; priority?: string | null; lng?: number; lat?: number; makani?: string;
      floor?: number | null; unitNo?: string; accessNote?: string; source: string;
      callerName?: string; callerPhone?: string; callerRole?: string;
      chiefComplaint?: string; patientsCount?: number;
    }, idempotencyKey?: string) =>
      post<CreateIncidentResult>('/api/incidents', data, { idempotencyKey }),

    update: (ref: string, data: Partial<{
      priority: string; kind: string; accessNote: string | null; floor: number | null; unitNo: string | null;
      patientsCount: number; chiefComplaint: string | null; lng: number; lat: number; makani: string;
    }>) => patch<Incident>(`/api/incidents/${ref}`, data),

    triage: (ref: string, data: { triageCode?: string; acuity?: number; priority?: string }) =>
      post<Incident>(`/api/incidents/${ref}/triage`, data),

    close: (ref: string, outcome: string) => post<Incident>(`/api/incidents/${ref}/close`, { outcome }),

    note: (ref: string, body: string) => post<{ id: string; createdAt: string }>(`/api/incidents/${ref}/notes`, { body }),

    /** Re-run the dispatch engine WITHOUT committing. Ranked units, each with the full
     *  factor breakdown the dispatcher sees before approving. */
    recommendation: (ref: string, exclude?: string[]) =>
      get<Recommendation>(`/api/incidents/${ref}/recommendation`, { exclude: exclude?.join(',') }),

    /** Commit the dispatch. One call creates the assignment, pushes the offer to the
     *  unit, notifies the agencies correlation selects and starts their SLA clocks. */
    dispatch: (ref: string, data: { unitRef: string; overrideReason?: string }, idempotencyKey?: string) =>
      post<TransitionResult>(`/api/incidents/${ref}/assignments`, data, { idempotencyKey }),

    correlation: (ref: string) => get<Correlation>(`/api/incidents/${ref}/correlation`),

    notify: (ref: string, agencies: AgencyCode[]) =>
      post<AgencyNotification[]>(`/api/incidents/${ref}/notify`, { agencies }),

    acknowledgeNotification: (ref: string, agency: AgencyCode) =>
      post<AgencyNotification[]>(`/api/incidents/${ref}/notifications/${agency}/acknowledge`),

    aar: (ref: string) => get<Record<string, unknown>>(`/api/incidents/${ref}/aar`),
  },

  /** Today's KPI strip, from v_incident_response — the same definition every screen uses. */
  kpiToday: () => get<KpiToday>('/api/kpi/today'),

  // ── Units & assignments ───────────────────────────────────────────────────
  units: {
    list: (q?: { status?: string; agency?: string; kind?: string; bbox?: string }) =>
      get<Unit[]>('/api/units', q),
    get: (ref: string) => get<Unit & { assignment: Assignment | null }>(`/api/units/${ref}`),
    setStatus: (ref: string, status: string, reason?: string) =>
      patch<Unit>(`/api/units/${ref}/status`, { status, reason }),
    standby: (ref: string, lng: number, lat: number, reason: string) =>
      post<Unit>(`/api/units/${ref}/standby`, { lng, lat, reason }),
    track: (ref: string, from: string, to: string) =>
      get<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }>(`/api/units/${ref}/track`, { from, to }),
  },

  assignments: {
    get: (ref: string) => get<Assignment>(`/api/assignments/${ref}`),
    /**
     * Move an assignment through its lifecycle. On-scene is stamped by the SERVER, from
     * its own clock and the unit's last position — a responder's device clock must not
     * corrupt the one metric the whole product is judged on.
     */
    act: (ref: string, action: AssignmentAction, body?: { reason?: string; hospitalRef?: string; floor?: number; liftUsed?: boolean }, idempotencyKey?: string) =>
      post<TransitionResult>(`/api/assignments/${ref}/${action.replace('_', '-')}`, body ?? {}, { idempotencyKey }),
    route: (ref: string) => get<{
      proposed: Array<[number, number]> | null; taken: Array<[number, number]> | null;
      proposedSec: number | null; takenSec: number | null; deltaSec: number | null;
      proposedM: number | null; takenM: number | null; deltaM: number | null;
    }>(`/api/assignments/${ref}/route`),
  },

  // ── Clinical ──────────────────────────────────────────────────────────────
  patients: {
    create: (incidentRef: string, data: { seq?: number; chiefComplaint?: string; ageBand?: string; sex?: string }) =>
      post<Patient>(`/api/incidents/${incidentRef}/patients`, data),
    /** The raw Emirates ID never reaches storage — it is hashed server-side. This call
     *  is audited as a clinical-data access. */
    identify: (id: string, emiratesId: string) => post<Patient>(`/api/patients/${id}/identify`, { emiratesId }),
    vitals: (id: string, sample: Record<string, number | string | null>) =>
      post<{ ok: true }>(`/api/patients/${id}/vitals`, sample),
    triageTag: (id: string, tag: string) => post<Patient>(`/api/patients/${id}/triage-tag`, { tag }),
    prealert: (id: string, hospitalRef: string) => post<Patient>(`/api/patients/${id}/prealert`, { hospitalRef }),
  },

  /** Ranked destinations with the clinical reasoning for each. */
  hospitalRecommend: (incidentRef: string) => get<HospitalRanking>('/api/hospitals/recommend', { incident: incidentRef }),

  // ── Advisories & action engine ────────────────────────────────────────────
  advisories: {
    list: (q?: { severity?: string; state?: string; category?: string; zone?: string }) =>
      get<Advisory[]>('/api/advisories', q),
    get: (ref: string) => get<Advisory & { actions: Array<{ ts: string; action: string; note: string | null; actorName: string | null }> }>(`/api/advisories/${ref}`),
    analyse: (ref: string) => post<Advisory>(`/api/advisories/${ref}/analyse`),
    act: (ref: string, data: { agencyCode: string; ownerRef?: string; action: string; slaHours: number }) =>
      post<Advisory>(`/api/advisories/${ref}/act`, data),
    measure: (ref: string, value: number) => post<Advisory>(`/api/advisories/${ref}/measure`, { value }),
    close: (ref: string) => post<Advisory>(`/api/advisories/${ref}/close`),
    dismiss: (ref: string, reason: string) => post<Advisory>(`/api/advisories/${ref}/dismiss`, { reason }),
    generate: () => post<{ created: number }>('/api/advisories/generate'),
  },

  whatIf: (scenario: Record<string, unknown>) => post<Record<string, unknown>>('/api/whatif', scenario),

  // ── Collaborate — response-time decomposition (docs/08 §2.1) ─────────────
  /** Takes the universal filter; `days`/`ahead` are its own knobs. The pre-filter
   *  single-value keys (zoneRef, priority, hourBand, …) still work — the server folds
   *  them into the filter — so old deep links keep resolving. */
  responseTime: (q: { days?: number; ahead?: number } = {}, filters?: Query) =>
    get<Record<string, unknown>>('/api/analytics/response-time', { ...filters, ...q }),

  // ── Ranking (docs/08 §2.3) ────────────────────────────────────────────────
  ranking: {
    get: (q: { level?: string; from: string; to: string; weights?: Record<string, number> }) =>
      get<Record<string, unknown>>('/api/ranking', { level: q.level, from: q.from, to: q.to, weights: q.weights ? JSON.stringify(q.weights) : undefined }),
    rebaseline: (data: { level?: string; from: string; to: string; zoneId: string; overrides: Record<string, number>; weights?: Record<string, number> }) =>
      post<Record<string, unknown>>('/api/ranking/rebaseline', data),
  },

  // ── The Phase 6 raw engines (docs/08 §3) ─────────────────────────────────
  //
  // Each takes the universal filter too, and honours the part of it that is meaningful for
  // that engine — a coverage computation is about the fleet NOW, so a historical window
  // means nothing to it. Every response reports `filters.honoured` and `filters.ignored`
  // so the bar can grey out what a tab cannot slice by, instead of appearing to apply it.
  analytics: {
    demand: (q?: { hours?: number; days?: number }, filters?: Query) =>
      get<Record<string, unknown>>('/api/analytics/demand', { ...filters, ...q }),
    risk: (q?: { limit?: number; hourBand?: number }, filters?: Query) =>
      get<{ cells: Array<Record<string, unknown>>; filters?: Record<string, unknown> }>('/api/analytics/risk', { ...filters, ...q }),
    anomaly: (q?: { hours?: number; ahead?: number }, filters?: Query) =>
      get<Record<string, unknown>>('/api/analytics/anomaly', { ...filters, ...q }),
    equity: (filters?: Query) => get<Record<string, unknown>>('/api/analytics/equity', filters),
    coverage: (filters?: Query) => get<Record<string, unknown>>('/api/analytics/coverage', filters),
    crowd: (filters?: Query) => get<Record<string, unknown>>('/api/analytics/crowd', filters),
    preempt: (filters?: Query) => get<Record<string, unknown>>('/api/analytics/preempt', filters),
  },

  // ── Intelligence — KPI library and data quality (docs/08, docs/06 §7) ────
  kpiLibrary: () => get<Array<Record<string, unknown>>>('/api/kpi/library'),
  dataQuality: () => get<Array<Record<string, unknown>>>('/api/data-quality'),

  // ── Scenarios ─────────────────────────────────────────────────────────────
  scenarios: {
    list: () => get<Array<{ ref: string; name: string; summary: string; tier: number; duration_sec: number }>>('/api/scenarios'),
    start: (ref: string, force = false) => post<{ ref: string }>(`/api/scenarios/${ref}/start${force ? '?force=true' : ''}`),
    pause: (runRef: string) => post<unknown>(`/api/runs/${runRef}/pause`),
    resume: (runRef: string) => post<unknown>(`/api/runs/${runRef}/resume`),
    stop: (runRef: string) => post<unknown>(`/api/runs/${runRef}/stop`),
    seek: (runRef: string, toSec: number) => post<unknown>(`/api/runs/${runRef}/seek`, { toSec }),
    speed: (runRef: string, speed: number) => post<unknown>(`/api/runs/${runRef}/speed`, { speed }),
    reset: (runRef: string) => post<{ removed: number }>(`/api/runs/${runRef}/reset`),
  },

  // ── The live picture ──────────────────────────────────────────────────────
  sim: {
    get: () => get<SimState>('/api/sim'),
    start: (settings?: { intensity?: SimIntensity; autoDispatch?: boolean; pace?: 'real' | 'brisk' }) =>
      post<SimState>('/api/sim/start', settings ?? {}),
    stop: () => post<SimState>('/api/sim/stop'),
    update: (changes: { intensity?: SimIntensity; autoDispatch?: boolean; pace?: 'real' | 'brisk' }) =>
      patch<SimState>('/api/sim', changes),
    /** One call now — a chosen kind, priority or community, or the demand model's pick. */
    inject: (data: { kind?: string; priority?: Priority; zoneRef?: string } = {}) =>
      post<{ ref: string; kind: string; priority: Priority; zone: string }>('/api/sim/inject', data),
    /** Take a call back from the AI's countdown. */
    hold: (incidentRef: string) => post<SimState>(`/api/sim/hold/${incidentRef}`),
    reset: () => post<{ removed: number; state: SimState }>('/api/sim/reset'),
  },
  /** Camera detections — the floor under the `detection:stage` socket stream, for a
   *  console that has just loaded or just reconnected. */
  detections: {
    list: () => get<Detection[]>('/api/detections'),
    one: (id: string) => get<Detection>(`/api/detections/${id}`),
    forIncident: (ref: string) => get<Detection>(`/api/incidents/${encodeURIComponent(ref)}/detection`),
  },
  live: {
    assignments: () => get<LiveAssignments>('/api/live/assignments'),
    summary: () => get<LiveSummary>('/api/live/summary'),
    /** The AI's reasoning on one incident, step by step. */
    decision: (ref: string) => get<DecisionTrace>(`/api/live/decisions/${encodeURIComponent(ref)}`),
    /** The Automatic dispatch card in full. */
    autoDispatch: () => get<AutoDispatchReport>('/api/live/autodispatch'),
    unit: (ref: string) => get<UnitDetail>(`/api/live/units/${encodeURIComponent(ref)}`),
    /** Send the AI's choice now (or release a hold). */
    dispatchNow: (ref: string) => post<SimState>(`/api/live/dispatch-now/${encodeURIComponent(ref)}`),
  },
  /** The automatic-dispatch policy: set by the AI, or fixed by a duty officer. */
  dispatchRules: {
    get: () => get<DispatchRulesState>('/api/dispatch/rules'),
    set: (rules: Partial<DispatchRules>) => put<DispatchRulesState>('/api/dispatch/rules', rules),
    reset: () => post<DispatchRulesState>('/api/dispatch/rules/reset'),
  },
  feed: (limit = 60) => get<FeedItem[]>('/api/feed', { limit }),

  // ── Insights — every chart's data, filtered and forecast ──────────────────
  //
  // Each call takes its OWN knobs (window length, how many rows, how far ahead) plus the
  // universal filter as a flat `filters` query object (lib/filters.ts → toQuery). The two
  // are merged here rather than at each call site, so no page can forget the filter and
  // silently render an unfiltered chart.
  insights: {
    /** Every value the filter bar offers, counted. Cached for 5 minutes server-side. */
    filterOptions: (q?: { days?: number }) => get<FilterOptions>('/api/insights/filter-options', q),
    almanac: (q?: { weeks?: number; ahead?: number }, filters?: Query) =>
      get<AlmanacResult>('/api/insights/almanac', { ...filters, ...q }),
    monthly: (q?: { months?: number; ahead?: number }, filters?: Query) =>
      get<MonthlyResult>('/api/insights/monthly', { ...filters, ...q }),
    daily: (q?: { days?: number; ahead?: number }, filters?: Query) =>
      get<DailyResult>('/api/insights/daily', { ...filters, ...q }),
    callTypes: (q?: { days?: number; limit?: number }, filters?: Query) =>
      get<CallTypesResult>('/api/insights/call-types', { ...filters, ...q }),
    /** The demand surface behind the radial search: every call in the window on a fine
     *  grid, re-binned into hexagons in the browser. `hours` adds the time-lapse. */
    geo: (q?: { months?: number; cell?: number; hours?: boolean }, filters?: Query) =>
      get<GeoSurface>('/api/insights/geo', { ...filters, ...q }),
    /** The radial search (Concept Note §07): everything within a radius of a point. */
    radial: (q: { lng: number; lat: number; radius?: number; months?: number; ahead?: number }, filters?: Query) =>
      get<RadialResult>('/api/insights/radial', { ...filters, ...q }),
    compare: (q?: { days?: number }, filters?: Query) =>
      get<CompareResult>('/api/insights/compare', { ...filters, ...q }),
    callCentre: (q?: { days?: number; ahead?: number }, filters?: Query) =>
      get<CallCentreResult>('/api/insights/call-centre', { ...filters, ...q }),
    performance: (q?: { days?: number; ahead?: number }, filters?: Query) =>
      get<PerformanceResult>('/api/insights/performance', { ...filters, ...q }),
    etaAccuracy: (q?: { days?: number; ahead?: number }, filters?: Query) =>
      get<EtaAccuracyResult>('/api/insights/eta-accuracy', { ...filters, ...q }),
    /** The recorded corpus and how complete it is — what the models learn from. */
    playbook: (q?: { limit?: number }, filters?: Query) =>
      get<Record<string, unknown>>('/api/insights/playbook', { ...filters, ...q }),
    replayable: (limit?: number, filters?: Query) =>
      get<ReplayableItem[]>('/api/insights/replayable', { ...filters, limit }),
    replay: (ref: string) => get<ReplayResult>(`/api/insights/replay/${ref}`),
  },
  alerts: {
    list: (limit = 60) => get<AlertItem[]>('/api/alerts', { limit }),
    ack: (id: string) => post<{ ok: true }>(`/api/alerts/${id}/ack`),
  },

  // ── Citizen ───────────────────────────────────────────────────────────────
  sos: {
    create: (data: { kind?: string; lng: number; lat: number; accuracy?: number; silent?: boolean; note?: string }, idempotencyKey?: string) =>
      post<{ ref: string; state: string }>('/api/sos', data, { idempotencyKey }),
    cancel: (ref: string) => post<{ ok: true }>(`/api/sos/${ref}/cancel`),
    /** A deliberately narrow projection: never the unit's position history, never
     *  another caller's incident. */
    status: (ref: string) => get<SosStatus>(`/api/sos/${ref}/status`),
  },

  me: {
    medicalProfile: () => get<Record<string, unknown>>('/api/me/medical-profile'),
    setMedicalProfile: (data: Record<string, unknown>) => request<Record<string, unknown>>('/api/me/medical-profile', { method: 'PUT', body: JSON.stringify(data) }),
    /** The responder app's own unit and current assignment, if any. */
    unit: () => get<{ unit: Unit; assignment: Assignment | null; incident: Incident | null }>('/api/me/unit'),
    setUnitStatus: (status: 'available' | 'off_duty') => patch<Unit>('/api/me/unit/status', { status }),
  },

  // ── Assistant ─────────────────────────────────────────────────────────────
  assistant: {
    ask: (question: string, context?: Record<string, unknown>) =>
      post<{ answer: string; path: 'rules' | 'llm' | 'none'; evidence?: unknown[] }>('/api/assistant/ask', { question, context }),
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  admin: {
    users: (q?: { role?: string; limit?: number }) => get<Paged<SessionUser>>('/api/admin/users', q),
    createUser: (data: Record<string, unknown>) => post<SessionUser>('/api/admin/users', data),
    updateUser: (ref: string, data: Record<string, unknown>) => patch<SessionUser>(`/api/admin/users/${ref}`, data),
    archiveUser: (ref: string) => del<{ ok: true }>(`/api/admin/users/${ref}`),
    audit: (q?: { entity?: string; entityId?: string; actor?: string; from?: string; limit?: number; cursor?: number }) =>
      get<Paged<Record<string, unknown>>>('/api/admin/audit', q),
    verifyAudit: () => get<{ ok: boolean; checked: number; brokenAt: number | null; reason?: string }>('/api/admin/audit/verify'),
  },
};

export { get, post, patch, del, request };
