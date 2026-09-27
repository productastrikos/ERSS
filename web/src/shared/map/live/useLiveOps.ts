/**
 * The live operations model — one derived picture of "what is happening right now",
 * shared by the map, the response rail and the dashboard.
 *
 * Three things happen here that no single feed gives you:
 *
 *  1. ALERTS ARE THE COMPLEMENT OF RESPONSES. `/api/live/assignments` says who is going
 *     where. The incident queue says what has been called in. The calls that appear in the
 *     second and not the first are the ones with nobody on the way — the most important
 *     rows on the screen, and the only ones neither feed states directly.
 *
 *  2. TRAILS COME FROM THE STORE, not from here. The server sends where each ambulance
 *     IS, not where it has been, so the console accumulates the fixes as they land
 *     (lib/stores/live.ts). Doing it in this hook would mean reading a ref during render
 *     or setting state from an effect — both of which are the same mistake wearing two
 *     hats: a trail is live DATA, and data belongs in the store.
 *
 *  3. HEADING IS DERIVED. A position feed carries no bearing for a unit the simulation is
 *     not driving, so the direction of travel comes from the last two fixes — which is
 *     also the only definition that stays true for a real ambulance reporting over GPS.
 */

import { useMemo } from 'react';
import type { Incident, LiveAssignment } from '../../../lib/types';
import { useQueue } from '../../../lib/stores/incidents';
import { useLiveRoutes, useLiveTrails } from '../../../lib/stores/live';
import { useNow } from '../../../lib/stores/now';
import type { LiveAlert, LiveResponse, LiveResponseData } from '../layers/liveResponse';

type LngLat = [number, number];

export interface LiveOpsModel extends LiveResponseData {
  /** Everything worth framing the camera on: every live call and every responding unit. */
  focusPoints: LngLat[];
  /** Responses first (soonest arrival first), then uncovered alerts (longest wait first). */
  ordered: Array<
    | { kind: 'response'; id: string; response: LiveResponse }
    | { kind: 'alert'; id: string; alert: LiveAlert }
  >;
  counts: { responses: number; alerts: number; toScene: number; toHospital: number; onScene: number };
}

/** The quiet-window shape (LiveOpsMap.tsx) as much as the pre-load one. */
export const EMPTY_LIVE_OPS: LiveOpsModel = {
  responses: [], alerts: [], at: '', focusPoints: [], ordered: [],
  counts: { responses: 0, alerts: 0, toScene: 0, toHospital: 0, onScene: 0 },
};

/** Compass bearing from a to b, in degrees clockwise from north. */
function bearing(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLon = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(b[1] * toRad);
  const x = Math.cos(a[1] * toRad) * Math.sin(b[1] * toRad)
    - Math.sin(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

export function useLiveOps(): LiveOpsModel {
  const routes = useLiveRoutes();
  const queue = useQueue();
  // Ticks once a second: the ETA countdowns on the map and in the rail are live text, and
  // they run on the DOMAIN clock so a scenario at 4× speed counts down at 4×.
  const now = useNow();

  const trails = useLiveTrails();
  const assignments = routes?.assignments;

  return useMemo(() => {
    if (!assignments) return EMPTY_LIVE_OPS;

    const responses: LiveResponse[] = assignments.map((a: LiveAssignment) => {
      const tail = trails.get(a.unitRef) ?? [];
      const heading = tail.length > 1 ? bearing(tail[tail.length - 2], tail[tail.length - 1])
        : a.path && a.path.length > 1 && a.unitPosition ? bearing(a.unitPosition, a.path[1])
          : null;
      return {
        ref: a.ref,
        state: a.state,
        leg: a.leg,
        unitRef: a.unitRef,
        callsign: a.callsign,
        unitKind: a.unitKind,
        unit: a.unitPosition,
        heading,
        incidentRef: a.incidentRef,
        incident: a.incidentPosition,
        priority: a.priority,
        kind: a.kind,
        zoneName: a.zoneName,
        hospital: a.hospital,
        path: a.path,
        trail: tail,
        reportedAt: a.reportedAt,
        onsceneAt: a.onsceneAt,
        etaPredictedAt: a.etaPredictedAt,
        etaSec: a.etaPredictedAt && !a.onsceneAt
          ? Math.round((Date.parse(a.etaPredictedAt) - now) / 1000)
          : null,
        traffic: a.traffic ?? [],
        trafficDelaySec: a.trafficDelaySec ?? 0,
        remainingM: a.remainingM ?? null,
        speedKmh: a.speedKmh ?? null,
      };
    });

    // The calls nobody is going to. `isResting` excludes the demo's scripted mid-flight
    // incidents, whose clocks would read as hours-old emergencies.
    const covered = new Set(responses.map((r) => r.incidentRef));
    const alerts: LiveAlert[] = queue.items
      .filter((i: Incident) => i.state !== 'closed' && !i.isResting && !covered.has(i.ref))
      .map((i) => ({
        ref: i.ref,
        priority: i.priority,
        kind: i.kind,
        position: [i.lng, i.lat] as LngLat,
        zoneName: i.zoneName ?? null,
        reportedAt: i.reportedAt,
        waitingSec: Math.max(0, Math.round((now - Date.parse(i.reportedAt)) / 1000)),
      }));

    // Order is the triage: whoever arrives soonest is the one to watch, and an uncovered
    // call outranks nothing — it sits below the responses but above the noise, sorted by
    // how long it has been waiting, because that is the number that gets worse.
    const RANK = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;
    const ordered: LiveOpsModel['ordered'] = [
      ...[...responses]
        .sort((a, b) => RANK[a.priority] - RANK[b.priority] || (a.etaSec ?? 1e9) - (b.etaSec ?? 1e9))
        .map((response) => ({ kind: 'response' as const, id: response.ref, response })),
      ...[...alerts]
        .sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.waitingSec - a.waitingSec)
        .map((alert) => ({ kind: 'alert' as const, id: alert.ref, alert })),
    ];

    const focusPoints: LngLat[] = [
      ...responses.flatMap((r) => (r.unit ? [r.unit, r.incident] : [r.incident])),
      ...alerts.map((a) => a.position),
    ];

    return {
      responses,
      alerts,
      at: routes?.at ?? '',
      focusPoints,
      ordered,
      counts: {
        responses: responses.length,
        alerts: alerts.length,
        toScene: responses.filter((r) => r.leg === 'scene').length,
        toHospital: responses.filter((r) => r.leg === 'hospital').length,
        onScene: responses.filter((r) => !!r.onsceneAt && r.leg !== 'hospital').length,
      },
    };
    // `now` is in the deps because the ETA and waiting counters are part of the model.
  }, [assignments, queue.items, routes?.at, now, trails]);
}
