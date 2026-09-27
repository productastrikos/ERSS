/**
 * The live operations map — the surface the ambulance service actually watches.
 *
 * One component, two homes: embedded on the Dashboard beside the KPI strip, and filling
 * the window on the Live operations page. They are the same picture at two sizes, not two
 * implementations, so nothing can drift between the desk view and the wall view.
 *
 * The problem it was built to solve: a map that fills half a dashboard and shows forty
 * identical dots is worse than no map. This one is organised around the two questions a
 * duty officer is actually holding in their head —
 *
 *     WHICH CALLS HAVE NOBODY GOING TO THEM?   (the rail's red rows, the pulsing columns)
 *     WHERE HAS EACH AMBULANCE GOT TO?          (the vehicle, its route, its countdown)
 *
 * — and everything on it exists to answer one of them. Each kind of thing has ONE shape
 * and nothing else shares it, so the map can be read before a single label is:
 *
 *     ambulance at rest      a round disc with the ambulance glyph, ringed by its status
 *     ambulance on a job     a 3D vehicle on its road, labelled with its ETA
 *     incident               a road-warning triangle; a column of light rises from a live one
 *     assigned to            a dashed violet line, ambulance → call — never a road colour
 *     camera                 a wedge at the apex of its field of view
 *
 * 3D is not decoration here. Tilting the camera is what makes a column of light legible
 * across the emirate, and the towers standing up are what the crew is driving between.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, BrainCircuit, Locate, Maximize2, Minimize2, Mountain, Navigation, Play, Radio, Square, TrafficCone } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { duration, durationUnit } from '../../../lib/format';
import { Button } from '../../ui';
import { MapCanvas, type MapCanvasHandle } from '../MapCanvas';
import { LayerControl } from '../LayerControl';
import { Legend } from '../Legend';
import { useMapFocus } from '../useMapFocus';
import { setFollow, setLayerData, setVisible, useMapView, type MapSelection } from '../layerRegistry';
import { EMPTY_DECISION, unitPoints, type DecisionOverlayData } from '../layers';
import type { LiveResponse } from '../layers/liveResponse';
import { openDetail } from '../../../lib/stores/detail';
import { useDecisionTrace, usePreview, wireDecisionFeed } from '../../../lib/stores/decisions';
import { pauseDirector, resumeDirector } from '../../../lib/stores/director';
import { useUnitDetail } from '../../../lib/stores/unitDetail';
import { useIncidentDirector, type DirectorPhase } from './useIncidentDirector';
import { CAMERA_2D, CAMERA_3D, liveOpsMap } from './liveOpsView';
import { useBoot, useQuietWindow } from '../../../lib/stores/session';
import { useFleet } from '../../../lib/stores/fleet';
import { useQueue } from '../../../lib/stores/incidents';
import { useCameras, useDetections } from '../../../lib/stores/live';
import { IncidentCctvPopup } from '../popups/IncidentCctvPopup';
import { roadWatch } from './roadWatch';
import { useLiveOps, EMPTY_LIVE_OPS, type LiveOpsModel } from './useLiveOps';
import { liveMotion, wireLiveMotion } from './liveMotion';
import { ResponseRail } from './ResponseRail';
import './liveops.scss';

export interface LiveOpsMapProps {
  /** `full` fills its container and shows the rail expanded; `embedded` is the dashboard. */
  variant?: 'embedded' | 'full';
  /** Shown as a control when set — the dashboard's "open the big one" button. */
  onExpand?: () => void;
  onCollapse?: () => void;
  /** The wall view docks the detail panel where the response rail sits; the rail steps aside. */
  hideRail?: boolean;
  className?: string;
}

export function LiveOpsMap({ variant = 'embedded', onExpand, onCollapse, hideRail = false, className = '' }: LiveOpsMapProps) {
  const live = useLiveOps();
  // A cold open (session.ts): the first 30s after this tab recognised a signed-in user,
  // this map shows nothing happening no matter what the shared PoC simulation already
  // has mid-flight — a restart already starts the backend quiet (sim/live.js), but a
  // sign-in mid-story otherwise would not. `shown` is what the map, the rail and the
  // incident director are allowed to react to; `live` (the real picture) is kept only for
  // the busy-unit exclusion below, so a truly idle ambulance still reads as idle.
  const quiet = useQuietWindow();
  const shown = quiet ? EMPTY_LIVE_OPS : live;
  const fleet = useFleet();
  const queue = useQueue();
  const boot = useBoot();
  const cameras = useCameras();
  const detections = useDetections().items;
  const mapRef = useRef<MapCanvasHandle>(null);
  const focus = useMapFocus(mapRef);
  const view = useMapView(liveOpsMap);
  const [is3D, setIs3D] = useState(true);
  // Open on both surfaces. "Where are the alerts, and is anyone en route" is the
  // question this screen exists for; hiding its answer behind a toggle on the smaller
  // surface would put the map back to being scenery.
  const [railOpen, setRailOpen] = useState(true);

  // ── Feed the layers ────────────────────────────────────────────────────────
  useEffect(() => { setLayerData(liveOpsMap, 'live', shown); }, [shown]);

  // Where each ambulance is BETWEEN fixes: dead-reckoned along its road at its reported
  // speed, so it drives rather than hops, and a camera riding with it moves at its pace.
  useEffect(() => wireLiveMotion(), []);

  useEffect(() => {
    // Idle ambulances only. The ones on a job are drawn by the live layer, larger and
    // with their route — drawing them twice would put a small quiet marker on top of the
    // thing the whole screen is about.
    const busy = new Set(live.responses.map((r) => r.unitRef));
    const dcas = fleet.units.filter((u) => u.agencyCode === 'DCAS' && !busy.has(u.ref));
    setLayerData(liveOpsMap, 'units', unitPoints(dcas, boot?.agencies ?? []));
  }, [fleet.units, boot?.agencies, live.responses]);

  // Road watch, on this map rather than a page of its own: the camera estate, and the
  // signal network (off unless switched on in the layer control).
  //
  // The signals used to come on BY THEMSELVES while a collision was being handled — a dozen
  // junction discs and thirteen green-dashed corridors around the one road that mattered.
  // They no longer do: the only traffic this map draws by default is red, on the stretches
  // of an ambulance's own route that are congested (layers/liveResponse.ts). That answers
  // "will the crew be slowed, and where" without the operator reading a network diagram.
  const watch = useMemo(() => roadWatch(detections, cameras), [detections, cameras]);
  useEffect(() => {
    setLayerData(liveOpsMap, 'cameras', watch.cameras);
    setLayerData(liveOpsMap, 'traffic', watch.traffic);
  }, [watch]);

  // What the AI is weighing (server/services/decisions.js), pushed over the socket.
  useEffect(() => wireDecisionFeed(), []);

  useEffect(() => {
    // Quiet: no incident marker either, the same as the live layer just above.
    if (queue.status !== 'ready' || quiet) { if (quiet) setLayerData(liveOpsMap, 'incidents', []); return; }
    // Only the calls the live layer is NOT already drawing.
    //
    // Every live emergency used to appear twice: as a column of light from the live layer
    // AND as a plain coloured disc from this one, a few pixels apart. Two marks for one
    // call is the single worst thing a map like this can do — an operator counting open
    // emergencies on a wall was counting them double — and it is most of why the markers
    // read as noise. The incident layer keeps its job (selection and popups for
    // everything else on the queue); it just stops repeating the live picture.
    const alreadyDrawn = new Set([
      ...live.responses.map((r) => r.incidentRef),
      ...live.alerts.map((a) => a.ref),
    ]);
    setLayerData(liveOpsMap, 'incidents', queue.items.filter(
      (i) => i.state !== 'closed' && !i.isResting && !alreadyDrawn.has(i.ref),
    ));
  }, [queue.items, queue.status, live.responses, live.alerts, quiet]);

  // ── The camera ─────────────────────────────────────────────────────────────
  const apply3D = useCallback((on: boolean) => {
    setIs3D(on);
    setVisible(liveOpsMap, 'buildings', on);
    // A chase IS a 3D view — it tilts in behind the vehicle on every position update.
    // Leaving one running while the map is flattened makes the toggle and the camera
    // fight each other, and the button ends up describing a view that is not on screen.
    if (!on) setFollow(liveOpsMap, null);
    const map = mapRef.current?.map();
    map?.easeTo({ pitch: on ? CAMERA_3D.pitch : 0, bearing: on ? CAMERA_3D.bearing : 0, duration: 700 });
  }, []);

  const frameAll = useCallback(() => {
    setFollow(liveOpsMap, null);
    if (shown.focusPoints.length) focus.fitTo(shown.focusPoints, { padding: variant === 'full' ? 140 : 90, maxZoom: 14 });
    else mapRef.current?.map()?.easeTo({ ...(is3D ? CAMERA_3D : CAMERA_2D), duration: 700 });
  }, [focus, shown.focusPoints, is3D, variant]);

  const chasing = view.follow?.layerId === 'live' && view.follow.chase ? view.follow.id : null;

  /** Ride with a crew. The director calls this itself; a person does it from the rail. */
  const startChase = useCallback((id: string) => {
    if (!is3D) apply3D(true);
    // Riding with a crew is a street-level view of the city it is driving through — the
    // buildings come on even if they were switched off in the layer control.
    setVisible(liveOpsMap, 'buildings', true);
    focus.chase('live', id);
  }, [focus, is3D, apply3D]);
  const releaseChase = useCallback(() => setFollow(liveOpsMap, null), []);

  /** One click frames the response and opens it in the detail panel; a second rides with it. */
  const onPick = useCallback((id: string, points: Array<[number, number]>) => {
    pauseDirector();
    if (chasing === id) { setFollow(liveOpsMap, null); return; }
    setFollow(liveOpsMap, null);
    focus.fitTo(points, { padding: 160, maxZoom: 15.5 });
    const row = shown.ordered.find((x) => x.id === id);
    const incidentRef = row?.kind === 'response' ? row.response.incidentRef : row?.kind === 'alert' ? row.alert.ref : null;
    if (incidentRef) openDetail({ kind: 'incident', ref: incidentRef });
  }, [chasing, focus, shown.ordered]);

  const onChase = useCallback((id: string) => {
    pauseDirector();
    if (chasing === id) { setFollow(liveOpsMap, null); return; }
    startChase(id);
  }, [chasing, startChase]);

  // ── The director: the map follows each new incident by itself ──────────────
  // `shown`, not `live` — a quiet cold open must not have the director fly the camera to
  // and open the panel for a story that's about to be hidden anyway.
  const director = useIncidentDirector({ live: shown, focus, mapRef, is3D, startChase, releaseChase, frameAll, chasing });
  const preview = usePreview(director.ref);

  // The AI log's steps, read here purely to mirror the CURRENTLY ACTIVE one on the map —
  // "Checked all 8 trial ambulances" flashes the whole field, "Chose Medic 22" pulses just
  // the one. This is the same trace IncidentDetail's log already polls; the map just also
  // reads it now so the two never say different things.
  const { data: trace } = useDecisionTrace(director.phase === 'deciding' ? director.ref : null);
  const activeStepUnits = useMemo(() => {
    const active = trace?.steps.find((s) => s.state === 'active') ?? trace?.steps[trace.steps.length - 1];
    return new Set(active?.unitRefs ?? []);
  }, [trace]);

  // The AI's choice being made, on the map — only until the job is sent.
  useEffect(() => {
    const deciding = director.phase === 'deciding' && preview;
    const alert = deciding ? shown.alerts.find((a) => a.ref === director.ref) : null;
    const data: DecisionOverlayData = deciding && alert ? {
      incidentRef: director.ref,
      incident: alert.position,
      status: preview.status,
      candidates: preview.candidates.slice(0, 3).map((c) => ({
        unitRef: c.unitRef, callsign: c.callsign, rank: c.rank, arrivalSec: c.arrivalSec,
        trafficDelaySec: c.trafficDelaySec, position: c.position ?? null,
        path: c.route?.path ?? null, traffic: c.route?.traffic ?? [], chosen: c.unitRef === preview.chosen,
        highlighted: activeStepUnits.has(c.unitRef),
      })),
    } : EMPTY_DECISION;
    setLayerData(liveOpsMap, 'decision', data);
  }, [director.phase, director.ref, preview, shown.alerts, activeStepUnits]);

  // The CCTV feed that raised this incident, shown on the map itself while the AI is
  // deciding — gone the moment a job is sent, so it never lingers through the response.
  // A person can also dismiss it early; that only holds until the NEXT incident (keyed by
  // detection id), so the next camera alert still shows its own feed.
  const activeDetection = director.phase === 'deciding'
    ? detections.find((d) => d.incidentRef === director.ref && d.cameras.length > 0) ?? null
    : null;
  const [dismissedCctv, setDismissedCctv] = useState<string | null>(null);
  const showCctv = activeDetection && activeDetection.id !== dismissedCctv;

  /** A click on the map opens what was clicked in the detail panel — no popup bubble. */
  const onSelect = useCallback((sel: MapSelection | null) => {
    if (!sel) return;
    if (sel.kind === 'unit') openDetail({ kind: 'unit', ref: sel.id });
    else if (sel.kind === 'vehicle') openDetail({ kind: 'unit', ref: (sel.data as LiveResponse).unitRef });
    else if (sel.kind === 'response' || sel.kind === 'alert' || sel.kind === 'incident') openDetail({ kind: 'incident', ref: sel.id });
  }, []);

  const ridden = chasing ? shown.responses.find((r) => r.ref === chasing) ?? null : null;
  // Read once a second with the rest of the model (useLiveOps ticks on the domain clock).
  const riddenKmh = ridden ? liveMotion.speedOf(ridden.unitRef) : null;

  // Frame the picture the first time something is actually happening, so the map does not
  // open on an empty emirate while three ambulances are mid-response off-screen.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !shown.focusPoints.length) return;
    framed.current = true;
    const id = setTimeout(frameAll, 400);
    return () => clearTimeout(id);
  }, [shown.focusPoints.length, frameAll]);

  return (
    <div className={`liveops liveops--${variant} ${className}`}>
      <MapCanvas view={liveOpsMap} ref={mapRef} camera={is3D ? CAMERA_3D : CAMERA_2D} onSelect={onSelect} popups={false}>
        {/* Top left: what is happening, in four numbers — and what the AI is doing now. */}
        <div className="map-control map-control--top-left liveops__top-left">
          <LiveTicker live={shown} onShowAll={frameAll} />
          <DirectorChip phase={director.phase} paused={director.paused} live={shown} incidentRef={director.ref}
                        weighing={preview?.status === 'thinking'} candidates={preview?.candidates.length ?? 0} />
        </div>

        {/* Top right: the view controls. */}
        <div className="map-control map-control--top-right liveops__tools">
          <button type="button" className="liveops__tool" aria-pressed={is3D}
                  title={is3D ? t('liveops.flatten') : t('liveops.tilt')}
                  onClick={() => apply3D(!is3D)}>
            {is3D ? <Box aria-hidden /> : <Mountain aria-hidden />}
            <span>{is3D ? '3D' : '2D'}</span>
          </button>
          <button type="button" className="liveops__tool" title={t('liveops.frameAll')} onClick={frameAll}>
            <Locate aria-hidden />
          </button>
          <button type="button" className={`liveops__tool${railOpen ? ' is-on' : ''}`}
                  aria-pressed={railOpen} title={t('liveops.toggleRail')}
                  onClick={() => setRailOpen((v) => !v)}>
            <Radio aria-hidden />
            {shown.counts.alerts > 0 && <span className="liveops__badge">{shown.counts.alerts}</span>}
          </button>
          <LayerControl view={liveOpsMap} />
          {onExpand && (
            <button type="button" className="liveops__tool" title={t('liveops.expand')} onClick={onExpand}>
              <Maximize2 aria-hidden />
            </button>
          )}
          {onCollapse && (
            <button type="button" className="liveops__tool" title={t('liveops.collapse')} onClick={onCollapse}>
              <Minimize2 aria-hidden />
            </button>
          )}
        </div>

        {railOpen && !hideRail && (
          <ResponseRail
            live={shown}
            chasing={chasing}
            onPick={onPick}
            onChase={onChase}
            variant={variant}
          />
        )}

        {chasing && ridden && (
          <RideAlong response={ridden} kmh={riddenKmh != null ? riddenKmh * 3.6 : null} onRelease={() => { pauseDirector(); setFollow(liveOpsMap, null); }} />
        )}

        {activeDetection && showCctv && (
          <IncidentCctvPopup mapRef={mapRef} detection={activeDetection}
                              onClose={() => setDismissedCctv(activeDetection.id)} />
        )}

        <div className="map-control map-control--bottom-left">
          <Legend view={liveOpsMap} defaultOpen={false} />
        </div>
      </MapCanvas>
    </div>
  );
}

const clock = (sec: number) => {
  const s = Math.abs(Math.round(sec));
  return `${sec < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const km = (m: number | null | undefined) => (m == null ? '—' : `${(Math.max(0, m) / 1000).toFixed(1)} km`);

// ── What the AI is doing, in one line ────────────────────────────────────────

/**
 * The director's state, always in the same place: which step of which incident the map is
 * showing, and — when a person has taken the camera — the one button that hands it back.
 */
function DirectorChip({ phase, paused, live, incidentRef, weighing, candidates }: {
  phase: DirectorPhase; paused: boolean; live: LiveOpsModel; incidentRef: string | null; weighing: boolean; candidates: number;
}) {
  if (!incidentRef || phase === 'idle' || phase === 'gone') return null;
  const r = live.responses.find((x) => x.incidentRef === incidentRef);
  const text = phase === 'deciding'
    ? (weighing || !candidates ? t('liveops.director.thinking') : t('liveops.director.weighing', { n: candidates }))
    : phase === 'dispatched' ? t('liveops.director.dispatched', { unit: r?.callsign ?? '' })
      : phase === 'following' ? t('liveops.director.following', { unit: r?.callsign ?? '' })
        : t('liveops.director.arrived', { unit: r?.callsign ?? '' });
  return (
    <div className={`liveops__director is-${phase}${paused ? ' is-paused' : ''}`} role="status" aria-live="polite">
      <BrainCircuit aria-hidden />
      <span className="liveops__director-text">{text}</span>
      {paused && (
        <button type="button" className="liveops__director-resume" onClick={resumeDirector} title={t('liveops.director.resumeHelp')}>
          <Play aria-hidden /> {t('liveops.director.resume')}
        </button>
      )}
    </div>
  );
}

// ── Riding with a crew ───────────────────────────────────────────────────────

/**
 * The ride-along card: who is in the ambulance, how fast it is going, how far it has to
 * go, and what the road ahead holds. The crew comes from the same record as the detail
 * panel (demo roster), so the names on the card and the panel can never disagree.
 */
function RideAlong({ response: r, kmh, onRelease }: { response: LiveResponse; kmh: number | null; onRelease: () => void }) {
  const detail = useUnitDetail(r.unitRef, 5000).data;
  const p = detail?.profile;
  const nextJam = r.traffic[0] ?? null;
  const toHospital = r.leg === 'hospital';
  const speed = kmh ?? r.speedKmh;
  return (
    <div className="ridealong" role="region" aria-label={t('liveops.chasing', { unit: r.callsign })}>
      <div className="ridealong__head">
        <Navigation aria-hidden />
        <div className="ridealong__who">
          <strong>{r.callsign}</strong>
          <span>{r.unitKind}{p ? ` · ${p.plate}` : ''}</span>
        </div>
        <span className={`prio prio--${r.priority}`}>{r.priority}</span>
        <button type="button" className="ridealong__link" onClick={() => openDetail({ kind: 'unit', ref: r.unitRef })}>
          {t('liveops.ride.crew')}
        </button>
        <Button size="sm" variant="ghost" onClick={onRelease}>
          <Square aria-hidden /> {t('liveops.release')}
        </Button>
      </div>
      {p && (
        <div className="ridealong__crew">
          {p.driver && <span><em>{t('liveops.ride.driver')}</em> {p.driver.name}</span>}
          {p.lead && <span><em>{p.lead.title}</em> {p.lead.name}</span>}
        </div>
      )}
      <div className="ridealong__stats">
        <div><span>{t('liveops.ride.speed')}</span><strong>{speed != null ? Math.round(speed) : '—'}<small> km/h</small></strong></div>
        <div>
          <span>{toHospital ? t('liveops.ride.toHospital') : t('liveops.ride.eta')}</span>
          <strong className={r.etaSec != null && r.etaSec < 0 ? 'is-bad' : ''}>
            {toHospital ? (r.hospital?.name ?? '—') : r.etaSec == null ? '—' : <>{clock(r.etaSec)}<small> min</small></>}
          </strong>
        </div>
        <div><span>{t('liveops.ride.toGo')}</span><strong>{km(r.remainingM)}</strong></div>
        <div className={nextJam ? 'is-jam' : 'is-clear'}>
          <span><TrafficCone aria-hidden /> {t('liveops.ride.traffic')}</span>
          <strong>
            {nextJam
              ? t(nextJam.level === 'heavy' ? 'liveops.ride.heavyIn' : 'liveops.ride.slowIn', {
                in: (nextJam.inM ?? 0) > 30 ? t('liveops.ride.ahead', { m: Math.round(nextJam.inM ?? 0) }) : t('liveops.ride.now'),
                delay: `+${duration(nextJam.delaySec)} ${durationUnit(nextJam.delaySec)}`,
              })
              : t('liveops.ride.clear')}
          </strong>
        </div>
      </div>
      <div className="ridealong__foot">{t('liveops.ride.simulated')}</div>
    </div>
  );
}

// ── The ticker ───────────────────────────────────────────────────────────────

/** Four numbers, always in the same place: what the map is currently showing. */
function LiveTicker({ live, onShowAll }: { live: LiveOpsModel; onShowAll: () => void }) {
  const { counts } = live;
  return (
    <button type="button" className="liveops__ticker" onClick={onShowAll} title={t('liveops.frameAll')}>
      {/* Each count names what it counts — "3 waiting" leaves the room to guess three what. */}
      <span className={`liveops__stat${counts.alerts ? ' is-bad' : ''}`}>
        <strong>{counts.alerts}</strong> {t(counts.alerts === 1 ? 'liveops.stat.waitingOne' : 'liveops.stat.waiting')}
      </span>
      <span className="liveops__stat">
        <strong>{counts.toScene}</strong> {t(counts.toScene === 1 ? 'liveops.stat.toSceneOne' : 'liveops.stat.toScene')}
      </span>
      <span className="liveops__stat">
        <strong>{counts.onScene}</strong> {t('liveops.stat.onScene')}
      </span>
      <span className="liveops__stat">
        <strong>{counts.toHospital}</strong> {t('liveops.stat.toHospital')}
      </span>
    </button>
  );
}
