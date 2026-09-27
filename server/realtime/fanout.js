/**
 * Fan-out — the ONLY way the rest of the server tells clients something happened.
 * docs/04 §10.
 *
 * Every function here is called AFTER the write it announces has committed. The socket is
 * enrichment: a client that misses one of these refetches over REST on reconnect, so no
 * payload here is ever the only copy of a piece of state.
 *
 * Each announcement is also published on the in-process bus (lib/bus.js), which is how the
 * alert watcher and the live simulator learn what happened without services calling them.
 *
 * Room addressing:
 *   console:all      console users with no zone scope — every incident
 *   zone:<ref>       console users scoped to a zone — incidents in it (community or sector)
 *   console:fleet    every console user — fleet positions, snapshots, KPI ticks, sim state
 *   incident:<ref>   anyone watching that incident, access-checked on join
 *   unit:<ref>       the responder device bound to the unit
 *   agency:<code>    users of that agency
 */

import { emitTo, room } from './index.js';
import { bus } from '../lib/bus.js';

/** The last summary seen per incident, so a timeline row can be announced to the live feed
 *  with its priority, kind and place without another query. Bounded. */
const summaries = new Map();
const SUMMARY_MAX = 600;
function remember(summary) {
  if (!summary?.ref) return;
  summaries.delete(summary.ref);
  summaries.set(summary.ref, summary);
  if (summaries.size > SUMMARY_MAX) summaries.delete(summaries.keys().next().value);
}
export const summaryFor = (ref) => summaries.get(ref) ?? null;

/** Where an incident's events go: unscoped consoles, and the zone rooms that contain it. */
function incidentRooms(summary) {
  return [
    room.consoleAll,
    summary?.zoneRef && room.zone(summary.zoneRef),
    summary?.sectorRef && room.zone(summary.sectorRef),
  ].filter(Boolean);
}

export function incidentNew(summary) {
  remember(summary);
  emitTo(incidentRooms(summary), 'incident:new', summary);
  bus.publish('incident:new', summary);
}

/** The patch is the full summary: a client never has to merge partial state to be right. */
export function incidentUpdate(summary) {
  remember(summary);
  emitTo([...incidentRooms(summary), room.incident(summary.ref)], 'incident:update', { ref: summary.ref, patch: summary });
  bus.publish('incident:update', summary);
}

export function incidentTimeline(ref, rows) {
  const summary = summaryFor(ref);
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    emitTo(room.incident(ref), 'incident:timeline', { ref, row });
    // The dashboard's live feed: every ambulance stage of every live incident, in one stream.
    if (!FEED_SKIP.has(row.stage)) emitTo(incidentRooms(summary), 'feed:item', feedItem(ref, row, summary));
    bus.publish('incident:timeline', { ref, row, summary });
  }
}

/** Housekeeping stages that would drown the ambulance story on a video wall. */
const FEED_SKIP = new Set(['agency_notified', 'agency_acknowledged', 'note', 'updated']);

export function feedItem(ref, row, summary) {
  return {
    id: row.id, ts: row.ts, stage: row.stage, label: row.label,
    incidentRef: ref,
    priority: summary?.priority ?? null,
    kind: summary?.kind ?? null,
    zoneName: summary?.zoneName ?? null,
    unitRef: row.detail?.unitRef ?? null,
  };
}

export function incidentClosed(summary) {
  remember(summary);
  emitTo([...incidentRooms(summary), room.incident(summary.ref)], 'incident:closed', { ref: summary.ref, outcome: summary.outcome });
  bus.publish('incident:closed', summary);
}

/** Full assignment + incident + route + Makani entrance — everything the crew needs, in one push. */
export function assignmentOffer(unitRef, payload) {
  emitTo(room.unit(unitRef), 'assignment:offer', payload);
  bus.publish('assignment:offer', { unitRef, ...payload });
}

export function assignmentUpdate({ incidentRef, unitRef, ref, state, at }) {
  const payload = { ref, incidentRef, unitRef, state, at };
  // Consoles hear every assignment move too: the dashboard map redraws routes from it.
  emitTo([room.incident(incidentRef), room.unit(unitRef), room.consoleFleet], 'assignment:update', payload);
  bus.publish('assignment:update', payload);
}

/** A one-unit position frame, sent immediately on a status change — the batched 1 s
 *  frames in services/positions.js carry the GPS stream. Same event, same shape. */
export function unitStatus(row) {
  if (!row) return;
  emitTo(room.consoleFleet, 'unit:position', [{
    unitRef: row.ref, lng: row.lng, lat: row.lat,
    heading: row.current_heading ?? null, speed: row.current_speed ?? null, status: row.status,
  }]);
}

export function agencyNotified(code, payload) {
  emitTo([room.agency(code), room.incident(payload.incidentRef)], 'agency:notified', payload);
}

/**
 * KPIs changed. Deliberately carries no values: KPIs are zone-scoped, and a broadcast
 * cannot be. Each client refetches /api/kpi/today, which the server scopes.
 */
export function kpiTick(at) {
  emitTo(room.consoleFleet, 'kpi:tick', { at });
}

/** A targeted human message: { level, title, body, link }. */
export function notify(rooms, payload) {
  emitTo(rooms, 'notify', payload);
}

/** An operational alert (services/alerts.js) — to every console, and to a unit if it concerns one. */
export function alert(payload) {
  emitTo([room.consoleFleet, payload.unitRef && room.unit(payload.unitRef)].filter(Boolean), 'alert:new', payload);
}

/** The live simulator's state — running, intensity, auto-dispatch countdowns. */
export function simState(state) {
  emitTo(room.consoleFleet, 'sim:state', state);
}

/** A camera detection moving through its stages (engines/detection.js). Console-wide:
 *  the whole room watches a detection, the same way it watches an alert. */
export function detection(payload) {
  emitTo(room.consoleFleet, 'detection:stage', payload);
}
