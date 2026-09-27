/**
 * The mobile map — one ambulance, one destination, and the road between them.
 *
 * Used by both mobile surfaces: the crew sees where they are going, the caller sees the
 * ambulance coming. Same layer registry as the console (incidents, units, responses), so
 * an ambulance looks the same on a phone as on the video wall.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { Incident, Priority, Unit, UnitKind, UnitStatus } from '../lib/types';
import { useBoot } from '../lib/stores/session';
import { MapCanvas, type MapCanvasHandle } from '../shared/map/MapCanvas';
import { setFollow, setLayerData, type MapView } from '../shared/map/layerRegistry';
import { unitPoints, type ResponseLeg } from '../shared/map/layers';
import { useMapFocus } from '../shared/map/useMapFocus';

export interface TrackUnit {
  ref: string;
  callsign: string;
  kind: UnitKind;
  status: UnitStatus;
  lng: number;
  lat: number;
  heading: number | null;
}

export function TrackMap({ view, target, priority = 'P1', unit, route, leg = 'scene', follow = false, fitKey, children }: {
  view: MapView;
  target: { lng: number; lat: number } | null;
  priority?: Priority;
  unit: TrackUnit | null;
  route: Array<[number, number]> | null;
  leg?: ResponseLeg;
  /** Keep the camera on the ambulance while it drives. */
  follow?: boolean;
  /** Change it to re-frame the ambulance and the destination together. */
  fitKey?: string;
  children?: ReactNode;
}) {
  const agencies = useBoot()?.agencies;
  const mapRef = useRef<MapCanvasHandle>(null);
  const focus = useMapFocus(mapRef);

  const tLng = target?.lng;
  const tLat = target?.lat;
  useEffect(() => {
    const incidents = tLng != null && tLat != null
      ? [{ ref: 'destination', priority, lng: tLng, lat: tLat } as unknown as Incident]
      : [];
    setLayerData(view, 'incidents', incidents);
  }, [view, tLng, tLat, priority]);

  useEffect(() => {
    if (!unit) { setLayerData(view, 'units', []); return; }
    const asUnit = { ...unit, agencyCode: 'DCAS', capabilities: [], crewSize: 2, homeStationRef: null, shiftStart: null, shiftEnd: null, speed: null, lastSeenAt: null } as Unit;
    setLayerData(view, 'units', unitPoints([asUnit], agencies ?? []));
  }, [view, unit, agencies]);

  useEffect(() => {
    setLayerData(view, 'responses', { routes: route && route.length > 1 ? [{ ref: 'route', leg, priority, path: route }] : [] });
  }, [view, route, leg, priority]);

  const unitRef = unit?.ref ?? null;
  useEffect(() => {
    setFollow(view, follow && unitRef ? { layerId: 'units', id: unitRef } : null);
  }, [view, follow, unitRef]);

  // Frame both ends once per fitKey, from the latest positions.
  const latest = useRef({ unit, target });
  useEffect(() => { latest.current = { unit, target }; });
  useEffect(() => {
    if (!fitKey) return;
    const { unit: u, target: tg } = latest.current;
    const points: Array<[number, number]> = [];
    if (u) points.push([u.lng, u.lat]);
    if (tg) points.push([tg.lng, tg.lat]);
    if (points.length) focus.fitTo(points, { padding: 70, maxZoom: 15.5 });
  }, [fitKey, focus]);

  return (
    <MapCanvas view={view} ref={mapRef} camera={{ center: [55.27, 25.2], zoom: 11 }}>
      {children}
    </MapCanvas>
  );
}
