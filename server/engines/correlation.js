/**
 * correlation — the context around an incident. BoQ-1 F9 / docs/04 §3.
 *
 * PURE. Wind and plume direction, population within radius, sensitive sites nearby, the
 * agency feeds relevant to this incident, and the agency set it recommends notifying —
 * each with the reason, so "why was Civil Defence alerted" is answered on screen.
 *
 * This is RULES, not a model, and says so (`meta.rulesBased`). Its confidence is null by
 * design: a lookup does not have one, and inventing one would be exactly the fabrication
 * docs/08 §1 forbids. The population figure IS an estimate and is labelled as one.
 */

import { engineResult } from '../lib/result.js';

export const METHOD = 'context-rules-v1';

/** Kinds where a plume matters. */
const PLUME_KINDS = new Set(['fire_related']);
const PLUME_HALF_WIDTH_DEG = 30;

const SENSITIVE_KINDS = { school: 'School', stadium: 'Stadium', mall: 'Mall', metro: 'Metro station', mosque: 'Mosque', hotel: 'Hotel' };

/**
 * @param {object} p
 * @param {{ ref: string, kind: string, priority: string, floor: number|null, patientsCount: number, chiefComplaint: string|null }} p.incident
 * @param {{ class: string, population: number|null, populationDaytime: number|null, areaKm2: number|null, highriseCount: number, name: string }|null} p.zone
 * @param {{ ts: string, windDir: number|null, windKph: number|null, tempC: number|null, condition: string|null }|null} p.weather
 * @param {boolean} p.daytime
 * @param {Array<{ name: string, distanceM: number, onDiversion?: boolean }>} p.hospitals   within 3 km
 * @param {Array<{ siteName: string, siteKind: string, distanceM: number }>} p.sites        within 1 km
 * @param {Array<{ name: string, kind: string, distanceM: number, footfall: number|null }>} p.events  active, within 2 km
 * @param {Array<{ key: string, name: string, agencyCode: string, isSimulated: boolean }>} p.feeds
 * @param {{ mciThreshold: number, highRiseFloorThreshold: number, emiratePatients: number }} p.rules
 * @param {{ from: string, to: string }} p.window
 */
export function correlate({ incident, zone, weather, daytime, hospitals, sites, events, feeds, rules, window }) {
  const agencies = new Map();
  const recommend = (code, reason) => {
    if (!agencies.has(code)) agencies.set(code, []);
    agencies.get(code).push(reason);
  };
  const kind = incident.kind;
  const complaint = (incident.chiefComplaint ?? '').toLowerCase();
  const highRise = incident.floor !== null && incident.floor >= rules.highRiseFloorThreshold;

  // ── Agencies ────────────────────────────────────────────────────────────────
  if (kind === 'rta') {
    recommend('POLICE', 'Collision: scene safety, traffic control and investigation (999)');
    recommend('RTA', 'Collision on the road network: lane closures and diversion');
  }
  if (kind === 'fire_related') {
    recommend('CIVIL_DEFENCE', 'Fire or smoke: suppression and rescue (997)');
    recommend('POLICE', 'Fire scene: cordon and evacuation support');
  }
  if (kind === 'drowning') {
    if (zone?.class === 'coastal') recommend('COASTGUARD', 'Water rescue in a coastal zone (996)');
    recommend('POLICE', 'Drowning: scene control and investigation');
  }
  if (kind === 'workplace_injury' && /crush|trapped|chemical|exposure/.test(complaint)) {
    recommend('CIVIL_DEFENCE', `"${incident.chiefComplaint}": extrication or hazardous-materials support`);
  }
  if (kind === 'psychiatric' && /self-harm|harm/.test(complaint)) {
    recommend('POLICE', 'Risk of harm: police attendance for scene safety');
  }
  if (kind === 'mass_casualty' || incident.patientsCount >= rules.mciThreshold) {
    recommend('POLICE', `${incident.patientsCount} patients: mass-casualty scene control`);
    recommend('CIVIL_DEFENCE', 'Mass-casualty incident: rescue and scene support');
    recommend('DHA', 'Mass-casualty incident: hospital surge activation');
  }
  if (incident.patientsCount >= rules.emiratePatients) {
    recommend('NCEMA', `${incident.patientsCount} patients meets the emirate escalation trigger (modelled threshold)`);
  }
  if (highRise && incident.priority === 'P1') {
    recommend('CIVIL_DEFENCE', `Floor ${incident.floor}: firefighter-lift control for vertical access (modelled)`);
  }
  const bigEvent = events.find((e) => e.distanceM <= 1000);
  if (bigEvent && (incident.priority === 'P1' || incident.priority === 'P2')) {
    recommend('POLICE', `${bigEvent.name} is running ${Math.round(bigEvent.distanceM)} m away: crowd and access control`);
  }

  // ── Feeds relevant to this incident ─────────────────────────────────────────
  const feedReasons = new Map();
  const feed = (key, reason) => { if (!feedReasons.has(key)) feedReasons.set(key, reason); };
  if (kind === 'rta' || incident.priority === 'P1') feed('traffic', kind === 'rta' ? 'Corridor congestion and CCTV at the collision' : 'Signal state on the response corridor');
  if (incident.floor !== null || kind === 'fire_related') feed('bms', incident.floor !== null ? `Lifts, alarms and occupancy for a floor ${incident.floor} call` : 'Building alarms and occupancy');
  if (PLUME_KINDS.has(kind) || kind === 'respiratory' || kind === 'heat_illness') {
    feed('environment', kind === 'heat_illness' ? 'Heat stress and air quality' : PLUME_KINDS.has(kind) ? 'Wind direction for the smoke plume' : 'Air quality at the scene');
  }
  if (kind === 'fire_related') feed('water', 'Hydrant availability and supply pressure');
  if (bigEvent) feed('waste', `Event sanitation and obstruction around ${bigEvent.name}`);
  const relevantFeeds = feeds
    .filter((f) => feedReasons.has(f.key))
    .map((f) => ({ key: f.key, name: f.name, agencyCode: f.agencyCode, isSimulated: f.isSimulated, relevance: feedReasons.get(f.key) }));

  // ── Wind and plume ──────────────────────────────────────────────────────────
  let wind = null;
  if (weather && weather.windDir !== null && weather.windKph !== null) {
    // Meteorological convention: the direction the wind blows FROM.
    const toward = (weather.windDir + 180) % 360;
    wind = {
      fromDeg: weather.windDir,
      towardDeg: toward,
      speedKph: weather.windKph,
      tempC: weather.tempC,
      condition: weather.condition,
      asOf: weather.ts,
      plume: PLUME_KINDS.has(kind)
        ? { fromDeg: (toward - PLUME_HALF_WIDTH_DEG + 360) % 360, toDeg: (toward + PLUME_HALF_WIDTH_DEG) % 360 }
        : null,
    };
  }

  // ── Population estimate ─────────────────────────────────────────────────────
  let populationWithin = [];
  if (zone?.areaKm2 && (zone.population || zone.populationDaytime)) {
    const people = daytime ? (zone.populationDaytime ?? zone.population) : zone.population;
    const density = people / zone.areaKm2;
    populationWithin = [500, 1000].map((radiusM) => ({
      radiusM,
      estimate: Math.round(density * Math.PI * (radiusM / 1000) ** 2),
      basis: `${daytime ? 'daytime' : 'resident'} density of ${zone.name}, assumed uniform`,
    }));
  }

  // ── Sensitive sites ─────────────────────────────────────────────────────────
  // One line per site: a mall with four defibrillators is one mall.
  const nearestSite = new Map();
  for (const s of [
    ...hospitals.map((h) => ({ kind: 'hospital', label: 'Hospital', name: h.name, distanceM: Math.round(h.distanceM) })),
    ...sites.filter((s) => SENSITIVE_KINDS[s.siteKind]).map((s) => ({ kind: s.siteKind, label: SENSITIVE_KINDS[s.siteKind], name: s.siteName, distanceM: Math.round(s.distanceM) })),
    ...events.map((e) => ({ kind: 'event', label: 'Event in progress', name: e.name, distanceM: Math.round(e.distanceM) })),
  ]) {
    const key = `${s.kind}:${s.name}`;
    if (!nearestSite.has(key) || nearestSite.get(key).distanceM > s.distanceM) nearestSite.set(key, s);
  }
  const sensitiveSites = [...nearestSite.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, 8);

  const recommendedAgencies = [...agencies.entries()].map(([code, reasons]) => ({ code, reasons }));

  const caveats = ['Rule-based context, not a model'];
  if (populationWithin.length) caveats.push('Population within radius is an estimate from zone density');
  if (wind && weather.ts) caveats.push(`Wind from the weather feed as of ${weather.ts}`);
  if (relevantFeeds.some((f) => f.isSimulated)) caveats.push('Agency feeds are simulated sources');

  return engineResult({
    value: { wind, populationWithin, sensitiveSites, feeds: relevantFeeds, recommendedAgencies },
    unit: null,
    confidence: null,
    window,
    inputs: [
      { source: 'weather_hourly', rows: weather ? 1 : 0, asOf: weather?.ts },
      { source: 'zones', rows: zone ? 1 : 0 },
      { source: 'hospitals', rows: hospitals.length },
      { source: 'aeds (site register)', rows: sites.length },
      { source: 'events_calendar', rows: events.length },
      { source: 'agency_feeds', rows: feeds.length },
    ],
    factors: recommendedAgencies.map((a) => ({ name: a.code, contribution: 1 / Math.max(1, recommendedAgencies.length), direction: 'up', detail: a.reasons.join('; ') })),
    method: METHOD,
    caveats,
    meta: { rulesBased: true },
  });
}
