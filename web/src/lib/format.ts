/**
 * Formatting. The server sends raw values — durations in integer SECONDS, timestamps
 * as ISO 8601 with offset — and formatting is entirely the client's job. The API never
 * sends "4m 12s".
 *
 * Every number rendered by this module carries a unit. Every timestamp carries GST.
 */

const TZ = 'Asia/Dubai';

// ── Durations ────────────────────────────────────────────────────────────────

/** 252 → "4:12". The canonical response-time format. */
export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * The unit a `duration()` value is in: "min" for m:ss, "h" once it runs past the hour.
 *
 * A KPI prints the two side by side — "4:12 min" — because a bare "4:12" is a clock time
 * to half the room. Kept separate from `duration` so a tile can set the unit smaller than
 * the figure, which is how the eye reads "number, then what it counts".
 */
export function durationUnit(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '';
  return Math.max(0, Math.round(sec)) >= 3600 ? 'h' : 'min';
}

/** 252 → "4:12 min". `duration` with its unit, for anywhere a figure stands alone. */
export function durationWithUnit(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  return `${duration(sec)} ${durationUnit(sec)}`;
}

/** 252 → "4m 12s". For prose and tooltips, where a colon reads as a time of day. */
export function durationLong(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return r ? `${h}h ${m}m` : `${h}h ${m}m`;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** Signed delta, for "12s faster than baseline". */
export function durationDelta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const sign = sec < 0 ? '−' : '+';
  return `${sign}${durationLong(Math.abs(sec))}`;
}

/** Live elapsed seconds since an ISO instant. */
export function elapsedSec(fromIso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

// ── Time ─────────────────────────────────────────────────────────────────────

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
});
const timeSecFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ,
});
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ,
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
});

export const time = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '—');
export const timeSec = (iso: string | null | undefined) => (iso ? timeSecFmt.format(new Date(iso)) : '—');
export const date = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const dateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');

/** Always says GST — a control room reading a timestamp must never have to guess. */
export const timeGst = (iso: string | null | undefined) => (iso ? `${timeSecFmt.format(new Date(iso))} GST` : '—');

export function relative(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '—';
  const diff = Math.round((Date.parse(iso) - nowMs) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? 'just now' : 'in a moment';
  if (abs < 3600) return diff < 0 ? `${Math.round(abs / 60)}m ago` : `in ${Math.round(abs / 60)}m`;
  if (abs < 86400) return diff < 0 ? `${Math.round(abs / 3600)}h ago` : `in ${Math.round(abs / 3600)}h`;
  return dateTime(iso);
}

// ── Numbers ──────────────────────────────────────────────────────────────────

const int0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const count = (n: number | null | undefined) => (n == null ? '—' : int0.format(n));

/** The noun a count is counting — "1 ambulance", "3 ambulances". */
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 1284 → "1,284 calls". A count with the thing it counts. */
export const countOf = (n: number | null | undefined, one: string, many: string) =>
  (n == null ? '—' : `${int0.format(n)} ${plural(n, one, many)}`);
export const decimal1 = (n: number | null | undefined) => (n == null ? '—' : dec1.format(n));
export const decimal2 = (n: number | null | undefined) => (n == null ? '—' : dec2.format(n));

export function pct(fraction: number | null | undefined, digits = 0): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—';
  return `${fraction.toFixed(digits)}%`;
}

export function pctFromRatio(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Percentage points — for "+3pt", which is NOT the same as "+3%". */
export function points(delta: number | null | undefined, digits = 0): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  return `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(digits)}pt`;
}

export function distance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

export function compact(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

// ── Domain-specific ──────────────────────────────────────────────────────────

/** 2797875860 → "27978 75860". The format on the physical blue-and-white plaques. */
export function makani(code: string | null | undefined): string {
  if (!code) return '—';
  const d = String(code).replace(/\D/g, '');
  if (d.length !== 10) return String(code);
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}

/** Floor, spoken the way a crew would. */
export function floorLabel(floor: number | null | undefined): string {
  if (floor == null) return '';
  if (floor === 0) return 'Ground';
  if (floor < 0) return `B${Math.abs(floor)}`;
  return `Floor ${floor}`;
}

export function confidence(c: number | null | undefined): string {
  if (c == null) return 'not enough data';
  return `${Math.round(c * 100)}% confidence`;
}

/** Coordinates, for a field crew reading them aloud over the radio. */
export function coords(lng: number | null | undefined, lat: number | null | undefined): string {
  if (lng == null || lat == null) return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export const UNIT_KIND_LABEL: Record<string, string> = {
  ALS: 'Advanced Life Support', BLS: 'Basic Life Support', MICU: 'Mobile ICU',
  MRU: 'Rapid Response Motorcycle', MCU: 'Mass Casualty Unit', SUPERCAR: 'First Responder Supercar',
  PRV: 'Police Response Vehicle', FIRE: 'Fire Appliance', RESCUE: 'Rescue Unit',
  MARINE: 'Marine Unit', SUPERVISOR: 'Supervisor', AIR: 'Air Ambulance',
};

export const UNIT_STATUS_LABEL: Record<string, string> = {
  off_duty: 'Off duty', available: 'Available', standby: 'Standby', relocating: 'Relocating',
  assigned: 'Assigned', responding: 'Responding', on_scene: 'On scene',
  transporting: 'Transporting', at_hospital: 'At hospital', out_of_service: 'Out of service',
};

export const INCIDENT_STATE_LABEL: Record<string, string> = {
  reported: 'Reported', triaged: 'Triaged', dispatched: 'Dispatched', responding: 'Responding',
  on_scene: 'On scene', transporting: 'Transporting', at_hospital: 'At hospital',
  resolved_on_scene: 'Resolved on scene', cancelled: 'Cancelled',
  non_emergency: 'Non-emergency', closed: 'Closed',
};

export const SOURCE_LABEL: Record<string, string> = {
  call_998: '998 Ambulance', call_999: '999 Police', call_997: '997 Civil Defence',
  call_996: '996 Coastguard', app_sos: 'App SOS', aed_activation: 'AED activation',
  cad_feed: 'CAD feed', sensor: 'Sensor', field_unit: 'Field unit', transfer: 'Transfer',
};
