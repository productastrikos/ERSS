/**
 * Operations — the working screen. Everything else in the product exists to make this
 * screen better. docs/06 §2.
 *
 *   queue (left) · operating picture (centre) · detail / dispatch (right) · KPI strip
 *
 * Every panel renders from REST alone; the socket only makes it live. The selected
 * incident, the queue scope and the priority filter live in the URL, so a view can be
 * sent to a colleague.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import type { Incident, Priority } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { useBoot, useCan, usePoc } from '../../../lib/stores/session';
import {
  loadIncidents, setQueueScope, useIncidentDetail, useQueue, wireIncidentFeed, type QueueScope,
} from '../../../lib/stores/incidents';
import { loadUnits, useFleet, wireFleetFeed } from '../../../lib/stores/fleet';
import { loadKpis, wireKpiFeed } from '../../../lib/stores/kpis';
import { MapCanvas, type MapCanvasHandle } from '../../../shared/map/MapCanvas';
import { LayerControl } from '../../../shared/map/LayerControl';
import { Legend } from '../../../shared/map/Legend';
import { useMapFocus } from '../../../shared/map/useMapFocus';
import { select, setLayerData, useMapView } from '../../../shared/map/layerRegistry';
import { unitPoints, type RoutesData } from '../../../shared/map/layers';
import { opsMap } from './opsMap';
import { IncidentQueue } from './IncidentQueue';
import { IncidentPanel } from './IncidentPanel';
import { FleetBoard, FleetSummary, KpiStrip } from './Board';
import { CreateIncidentDialog } from './CreateIncidentDialog';
import { ACTIVE_ASSIGNMENT, EN_ROUTE } from './opsModel';
import { useLocation } from '../../../lib/router';
import { responseRoutes, useLiveRoutes, useLiveRoutesPolling } from '../../../lib/stores/live';
import './operations.scss';

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return {
    incident: p.get('incident'),
    scope: (p.get('queue') === 'all' ? 'all' : 'active') as QueueScope,
    priorities: (p.get('prio') ?? '').split(',').filter((x): x is Priority => PRIORITIES.includes(x as Priority)),
  };
}

function writeUrl(state: { incident: string | null; scope: QueueScope; priorities: Priority[] }) {
  const p = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | null) => { if (v) p.set(k, v); else p.delete(k); };
  set('incident', state.incident);
  set('queue', state.scope === 'all' ? 'all' : null);
  set('prio', state.priorities.length ? state.priorities.join(',') : null);
  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, '', next);
}

export function OperationsPage() {
  const queue = useQueue();
  const fleet = useFleet();
  const boot = useBoot();
  // No calls in the trial build (config/poc.js): every incident is raised by a camera, so
  // the right-click "create one here" and the queue's New button — the call-taker's tools —
  // are withdrawn rather than left on screen as a way to break the claim being made.
  const poc = usePoc();
  const canCreate = useCan('incident.create') && poc.calls;

  const mapRef = useRef<MapCanvasHandle>(null);
  const focus = useMapFocus(mapRef);
  const selection = useMapView(opsMap).selection;
  const selectedRef = selection?.kind === 'incident' ? selection.id : null;

  const [priorities, setPriorities] = useState<Priority[]>(() => readUrl().priorities);
  const framedRef = useRef<string | null>(null);
  // A counter, not a boolean: each opening mounts a fresh form.
  const [create, setCreate] = useState<{ n: number; at: [number, number] | null } | null>(null);

  // ── Load once, and wire the live feeds ──────────────────────────────────────
  useEffect(() => {
    const initial = readUrl();
    wireIncidentFeed();
    wireFleetFeed();
    wireKpiFeed();
    if (initial.scope === 'all') setQueueScope('all');
    else void loadIncidents();
    void loadUnits();
    void loadKpis();
  }, []);
  useLiveRoutesPolling();

  // A deep link — an alert's "Open incident", a dashboard card, the back button — selects
  // the incident it names. Keyed on the navigation, so the same link works twice.
  const location = useLocation();
  useEffect(() => {
    const fromUrl = readUrl().incident;
    const current = opsMap.store.get().selection;
    if (fromUrl && !(current?.kind === 'incident' && current.id === fromUrl)) {
      framedRef.current = null;
      select(opsMap, { layerId: 'incidents', kind: 'incident', id: fromUrl, lngLat: [0, 0], data: null });
    }
  }, [location.key]);

  useEffect(() => {
    writeUrl({ incident: selectedRef, scope: queue.scope, priorities });
  }, [selectedRef, queue.scope, priorities]);

  // ── Feed the map from the same state the panels read ────────────────────────
  const shownIncidents = useMemo(
    () => (priorities.length ? queue.items.filter((i) => priorities.includes(i.priority)) : queue.items),
    [queue.items, priorities],
  );
  useEffect(() => {
    if (queue.status === 'ready') setLayerData(opsMap, 'incidents', shownIncidents);
  }, [shownIncidents, queue.status]);

  // DCAS ambulances only — this is the ambulance service's operating picture.
  const agencies = boot?.agencies;
  useEffect(() => {
    const dcas = fleet.units.filter((u) => u.agencyCode === 'DCAS');
    if (dcas.length) setLayerData(opsMap, 'units', unitPoints(dcas, agencies ?? []));
  }, [fleet.units, agencies]);

  // Every ambulance on a job, and the road still ahead of it.
  const liveRoutes = useLiveRoutes();
  useEffect(() => {
    if (liveRoutes) setLayerData(opsMap, 'responses', { routes: responseRoutes(liveRoutes) });
  }, [liveRoutes]);

  const detailEntry = useIncidentDetail(selectedRef);
  const detail = detailEntry?.data ?? null;

  // Routes for the selected incident only: proposed while a unit is still on its way,
  // taken once it has arrived — the Concept Note's comparison, on the map.
  useEffect(() => {
    const routes: RoutesData['routes'] = (detail?.assignments ?? [])
      .filter((a) => ACTIVE_ASSIGNMENT.has(a.state) && (a.routeProposed || a.routeTaken))
      .map((a) => ({ ref: a.ref, proposed: EN_ROUTE.has(a.state) ? a.routeProposed : null, taken: a.routeTaken }));
    setLayerData(opsMap, 'routes', { routes });
  }, [detail]);

  // Frame the incident and its units once, when a selection's detail first arrives.
  useEffect(() => {
    if (!selectedRef) { framedRef.current = null; return; }
    if (!detail || detail.incident.ref !== selectedRef || framedRef.current === selectedRef) return;
    framedRef.current = selectedRef;
    const points: Array<[number, number]> = [[detail.incident.lng, detail.incident.lat]];
    for (const a of detail.assignments) {
      if (ACTIVE_ASSIGNMENT.has(a.state) && a.unitPosition) points.push([a.unitPosition.lng, a.unitPosition.lat]);
    }
    focus.fitTo(points, { padding: 90, maxZoom: 15 });
  }, [selectedRef, detail, focus]);

  const chooseIncident = useCallback((inc: Incident) => {
    select(opsMap, { layerId: 'incidents', kind: 'incident', id: inc.ref, lngLat: [inc.lng, inc.lat], data: inc });
  }, []);

  const openCreate = useCallback((at: [number, number] | null) => {
    setCreate((c) => ({ n: (c?.n ?? 0) + 1, at }));
  }, []);

  const summary = queue.items.find((i) => i.ref === selectedRef) ?? null;

  return (
    <div className="ops">
      <aside className="ops__queue">
        <IncidentQueue
          items={queue.items}
          status={queue.status}
          error={queue.error}
          scope={queue.scope}
          onScope={setQueueScope}
          priorities={priorities}
          onPriorities={setPriorities}
          selectedRef={selectedRef}
          onChoose={chooseIncident}
          arrived={queue.arrived}
          canCreate={canCreate}
          onCreate={() => openCreate(null)}
          onRetry={() => void loadIncidents()}
        />
        <FleetSummary />
      </aside>

      <section className="ops__map" aria-label={t('ops.map')}>
        <MapCanvas view={opsMap} ref={mapRef} onContextMenu={canCreate ? openCreate : undefined}>
          <div className="map-control map-control--top-right">
            <LayerControl view={opsMap} />
          </div>
          <div className="map-control map-control--bottom-left">
            <Legend view={opsMap} />
          </div>
          {canCreate && (
            <div className="ops__hint"><MousePointerClick aria-hidden /> {t('ops.createHint')}</div>
          )}
        </MapCanvas>
      </section>

      <aside className="ops__detail">
        {selectedRef
          ? <IncidentPanel key={selectedRef} summary={summary} entry={detailEntry} onClose={() => select(opsMap, null)} />
          : <FleetBoard />}
      </aside>

      <KpiStrip />

      {create && (
        <CreateIncidentDialog key={create.n} at={create.at} onClose={() => setCreate(null)} onCreated={chooseIncident} />
      )}
    </div>
  );
}
