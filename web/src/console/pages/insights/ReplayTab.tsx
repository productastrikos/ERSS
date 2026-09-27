/**
 * After-action replay (Concept Note §07 route/SLA, §08 replay and predicted-vs-actual
 * arrival): pick a finished job and watch it happen again — the road proposed against the
 * roads actually driven, the ambulance moving at the speed the crew moved, and the option
 * to ride with it exactly as the live screen lets you ride with a crew on the road now.
 *
 * Played on the REAL clock, not a fixed demo duration. A six-minute response takes six
 * minutes at 1×, and forty-five seconds at 8× — so what the replay shows can be compared
 * with what the live map showed, which is the entire point of keeping the recording.
 *
 * DCAS-first: the SLA table only appears when a partner agency was genuinely notified on
 * this incident — most DCAS jobs never involve one, and an empty multi-agency table would
 * misstate that as normal.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Crosshair, Handshake, Info, Navigation, Pause, Play, RotateCcw, Route, Square } from 'lucide-react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Card, Chip, ErrorState, Skeleton, EmptyState, AdvisoryStrip, type Finding } from '../../../shared/ui';
import { StatTile } from '../../../shared/charts';
import { distance, duration, durationDelta, floorLabel, relative, timeGst, durationUnit } from '../../../lib/format';
import { MapCanvas, type MapCanvasHandle } from '../../../shared/map/MapCanvas';
import { createMapView, setFollow, setLayerData, useMapView } from '../../../shared/map/layerRegistry';
import { buildingsLayer, replayLayer } from '../../../shared/map/layers';
import { REPLAY_VEHICLE } from '../../../shared/map/layers/replay';
import { buildTrip, PlaybackClock } from '../../../shared/map/replay/trip';
import type { ReplayResult } from '../../../lib/types';
import { useInsight } from './useInsight';

/** Findings over one reconstructed job — the forensic read, not the aggregate. */
function replayFindings(r: ReplayResult): Finding[] {
  const out: Finding[] = [];
  const inc = r.incident;

  // The interval the standard response clock never sees.
  if (inc.firstOnsceneAt && inc.firstAtPatientAt) {
    const vrt = Math.round((Date.parse(inc.firstAtPatientAt) - Date.parse(inc.firstOnsceneAt)) / 1000);
    if (vrt >= 60) {
      out.push({
        id: 'vertical-access',
        tone: vrt >= 240 ? 'critical' : 'warning',
        icon: Building2,
        headline: `${duration(vrt)} passed between arriving and reaching the patient.`,
        detail: inc.floor != null
          ? `${floorLabel(inc.floor)}${inc.buildingName ? ` · ${inc.buildingName}` : ''} — invisible to the response clock.`
          : 'This interval sits outside the measured response time.',
      });
    }
  }

  // Route proposed against route driven.
  if (r.route?.savedSec != null && Math.abs(r.route.savedSec) >= 15) {
    const lost = r.route.savedSec > 0;
    out.push({
      id: 'route-delta',
      tone: lost ? 'warning' : 'success',
      icon: Route,
      headline: `The road taken cost ${duration(Math.abs(r.route.savedSec))} ${lost ? 'more' : 'less'} than the one proposed.`,
      detail: r.route.takenSec != null && r.route.proposedSec != null
        ? `${duration(r.route.takenSec)} driven against ${duration(r.route.proposedSec)} modelled.`
        : undefined,
    });
  }

  // The arrival model, on this single job.
  if (r.route?.errorSec != null && Math.abs(r.route.errorSec) >= 60) {
    out.push({
      id: 'eta-miss',
      tone: 'warning',
      icon: Crosshair,
      headline: `Predicted arrival was out by ${duration(Math.abs(r.route.errorSec))}.`,
      detail: r.route.errorSec > 0 ? 'The crew arrived later than the model promised.' : 'The crew beat the predicted arrival.',
    });
  }

  // Partner SLAs only exist when an agency was genuinely notified.
  const missed = r.agencySla.filter((a) => a.met === false);
  if (missed.length > 0) {
    out.push({
      id: 'agency-sla',
      tone: 'critical',
      icon: Handshake,
      headline: `${missed.length} partner agenc${missed.length === 1 ? 'y' : 'ies'} missed the acknowledgement SLA.`,
      detail: missed.map((a) => `${a.agencyName} ${a.ackSec != null ? `at ${duration(a.ackSec)}` : 'no ack'}`).join(' · '),
    });
  }

  return out;
}

// The city the job was driven through is part of the record: the same tilted, built-up
// view the live map uses, so a replay and the live screen are recognisably one product.
const replayMap = createMapView('insights-replay', [replayLayer, buildingsLayer], {
  persist: false,
  visible: { buildings: true },
});

const SPEEDS = [1, 2, 4, 8, 16] as const;

const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ReplayTab() {
  const list = useInsight('replayable', () => api.insights.replayable(24));
  const [ref, setRef] = useState<string | null>(null);
  const detail = useInsight(ref ?? '', () => (ref ? api.insights.replay(ref) : Promise.resolve(null)));
  const mapRef = useRef<MapCanvasHandle>(null);
  const view = useMapView(replayMap);

  const clockRef = useRef(new PlaybackClock());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(4);
  const [progress, setProgress] = useState(0);

  const trip = useMemo(() => (detail.data ? buildTrip(detail.data) : null), [detail.data]);
  const riding = view.follow?.layerId === 'replay';

  /** Push the current clock at the map. A NEW wrapper object each time, because that is
   *  what tells the registry something changed — the clock itself is mutable, and a
   *  paused seek has to redraw even though no animation frame is running. */
  const publish = () => setLayerData(replayMap, 'replay', { trip, clock: clockRef.current });

  /** Selecting a job rewinds — done in the handler, not an effect watching the fetch. */
  const pick = (nextRef: string) => {
    setRef(nextRef);
    setPlaying(false);
    setProgress(0);
    setFollow(replayMap, null);
    clockRef.current.pause();
  };

  // A new job: load the clock, feed the map, frame the whole trip. The scrubber was
  // already rewound by `pick` — the event that caused this — so nothing is set here.
  useEffect(() => {
    clockRef.current.load(trip);
    clockRef.current.speed = speed;
    publish();
    const map = mapRef.current?.map();
    const pts = trip ? [...trip.points, trip.incident, ...(trip.hospital ? [trip.hospital] : [])] : [];
    if (map && pts.length > 1) {
      const b = pts.reduce(
        (acc, p) => [Math.min(acc[0], p[0]), Math.min(acc[1], p[1]), Math.max(acc[2], p[0]), Math.max(acc[3], p[1])],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, duration: 500, maxZoom: 15.5 });
    }
    // `speed` is carried onto the new clock and `publish` is recreated every render;
    // neither is a reason to reload the trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip]);

  // While playing, read the clock a few times a second for the scrubber. The MAP is driven
  // by the animation frame, not by this — a cursor pushed through React sixty times a
  // second would re-render the page to move one marker.
  useEffect(() => {
    if (!playing || !trip) return;
    const id = setInterval(() => {
      const now = performance.now();
      setProgress(clockRef.current.progress(now));
      if (clockRef.current.ended(now)) {
        clockRef.current.pause();
        setPlaying(false);
        setLayerData(replayMap, 'replay', { trip, clock: clockRef.current });
      }
    }, 100);
    return () => clearInterval(id);
  }, [playing, trip]);

  const toggle = () => {
    if (!trip) return;
    if (playing) { clockRef.current.pause(); setPlaying(false); } else { clockRef.current.play(); setPlaying(true); }
    setProgress(clockRef.current.progress(performance.now()));
    publish();
  };

  const seek = (p: number) => {
    clockRef.current.seekProgress(p);
    setProgress(p);
    publish();
  };

  const pickSpeed = (s: number) => {
    setSpeed(s);
    clockRef.current.setSpeed(s);
  };

  const ride = () => {
    if (riding) { setFollow(replayMap, null); return; }
    setFollow(replayMap, { layerId: 'replay', id: REPLAY_VEHICLE, chase: true });
    if (!playing && trip) { clockRef.current.play(); setPlaying(true); }
  };

  const r = detail.data;
  const primary = r?.assignments.find((a) => a.isPrimary) ?? r?.assignments[0] ?? null;
  const elapsed = trip ? (progress * (trip.to - trip.from)) / 1000 : 0;
  const total = trip ? (trip.to - trip.from) / 1000 : 0;
  const atWall = trip ? new Date(trip.from + progress * (trip.to - trip.from)).toISOString() : null;
  const stage = trip ? [...trip.stages].reverse().find((s) => s.at <= trip.from + progress * (trip.to - trip.from)) : null;

  return (
    <div className="insights__replay">
      <Card title={t('insights.replay.pick')} subtitle={t('insights.replay.pickSub')} flush>
        {list.loading ? <Skeleton height={160} /> : list.error ? <ErrorState body={list.error} /> : !list.data?.length ? (
          <EmptyState title={t('insights.replay.none')} />
        ) : (
          <ul className="insights__replay-list">
            {list.data.map((item) => (
              <li key={item.ref}>
                <button type="button" aria-pressed={ref === item.ref} onClick={() => pick(item.ref)}>
                  <span className={`insights__prio insights__prio--${item.priority}`}>{item.priority}</span>
                  <span className="insights__replay-what">
                    <strong>{t(`kind.${item.kind}`)}</strong>
                    <span>{item.zoneName ?? '—'} · {relative(item.reportedAt)}</span>
                  </span>
                  <span className="insights__replay-nums">
                    <span>{duration(item.responseSec)}</span>
                    {item.deltaSec != null && <span className={item.deltaSec > 0 ? 'is-bad' : 'is-good'}>{durationDelta(item.deltaSec)} vs proposed</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {ref && detail.loading && <Skeleton height={360} />}
      {ref && detail.error && <ErrorState body={detail.error} />}

      {r && primary && (
        <>
          <div className="insights__kpirow">
            <Card><StatTile label={t('incident.response')} value={duration(r.incident.responseSec)} unit={durationUnit(r.incident.responseSec)} sub={r.incident.ref} /></Card>
            <Card><StatTile label={t('insights.replay.routeTime')}
              value={r.route?.takenSec != null ? duration(r.route.takenSec) : '—'} unit={r.route?.takenSec != null ? durationUnit(r.route.takenSec) : undefined}
              sub={r.route?.proposedSec != null ? `proposed ${duration(r.route.proposedSec)} ${durationUnit(r.route.proposedSec)}` : undefined} /></Card>
            <Card><StatTile label={t('insights.replay.saved')}
              value={r.route?.savedSec != null ? durationDelta(r.route.savedSec) : '—'}
              deltaGood={r.route?.savedSec != null ? r.route.savedSec <= 0 : null}
              sub={t('insights.replay.savedSub')} /></Card>
            <Card><StatTile label={t('insights.replay.etaError')}
              value={r.route?.errorSec != null ? durationDelta(r.route.errorSec) : '—'}
              deltaGood={r.route?.errorSec != null ? Math.abs(r.route.errorSec) <= 60 : null}
              sub={t('insights.replay.etaErrorSub')} /></Card>
          </div>

          <AdvisoryStrip findings={replayFindings(r)} note="Computed from this job's own reconstruction." />

          <Card title={`${t(`kind.${r.incident.kind}`)} · ${r.incident.priority}`}
                subtitle={[r.incident.buildingName, r.incident.zoneName].filter(Boolean).join(', ') || undefined} flush>
            <div className="insights__replay-body">
              <div className="insights__replay-map">
                <MapCanvas view={replayMap} ref={mapRef}
                           camera={{ center: [r.incident.lng, r.incident.lat], zoom: 13.5, pitch: 50, bearing: -12 }}>
                  <div className="map-control map-control--top-right insights__replay-tools">
                    <button type="button" className={`insights__replay-ride${riding ? ' is-on' : ''}`}
                            aria-pressed={riding} onClick={ride} disabled={!trip}>
                      {riding ? <Square aria-hidden /> : <Navigation aria-hidden />}
                      <span>{riding ? t('insights.replay.stopRide') : t('insights.replay.ride')}</span>
                    </button>
                  </div>
                </MapCanvas>

                <div className="insights__scrub">
                  <button type="button" className="u-btn u-btn--secondary u-btn--sm u-btn--icon" onClick={toggle}
                          disabled={!trip} aria-label={playing ? t('insights.replay.pause') : t('insights.replay.play')}>
                    {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                  </button>
                  <button type="button" className="u-btn u-btn--ghost u-btn--sm u-btn--icon"
                          onClick={() => { clockRef.current.pause(); setPlaying(false); seek(0); }}
                          aria-label={t('insights.replay.rewind')}>
                    <RotateCcw aria-hidden />
                  </button>

                  <div className="insights__scrub-track">
                    <input type="range" min={0} max={1000} value={Math.round(progress * 1000)}
                           aria-label={t('insights.replay.scrub')}
                           onChange={(e) => seek(Number(e.target.value) / 1000)} />
                    {/* Stage marks sit on the track, so "when did they reach the patient"
                        is a place on the bar rather than a number to hunt for. */}
                    {trip && trip.stages.map((s) => (
                      <button key={s.key} type="button" className="insights__scrub-stage"
                              style={{ insetInlineStart: `${((s.at - trip.from) / (trip.to - trip.from)) * 100}%` }}
                              title={t(s.label)} aria-label={t(s.label)}
                              onClick={() => seek((s.at - trip.from) / (trip.to - trip.from))} />
                    ))}
                  </div>

                  <span className="insights__scrub-time">
                    {clock(elapsed)} / {clock(total)}
                    {atWall && <em>{timeGst(atWall)}</em>}
                  </span>

                  <div className="insights__scrub-speeds" role="group" aria-label={t('insights.replay.speed')}>
                    {SPEEDS.map((s) => (
                      <button key={s} type="button" aria-pressed={speed === s} onClick={() => pickSpeed(s)}>{s}×</button>
                    ))}
                  </div>
                </div>

                {stage && <div className="insights__replay-stage">{t(stage.label)}</div>}
              </div>

              <div className="insights__replay-facts">
                <dl className="m-kv">
                  {r.incident.floor != null && <div><dt>{t('incident.floor')}</dt><dd>{floorLabel(r.incident.floor)}</dd></div>}
                  {r.incident.chiefComplaint && <div><dt>{t('incident.complaint')}</dt><dd>{r.incident.chiefComplaint}</dd></div>}
                  <div><dt>{t('incident.reported')}</dt><dd>{timeGst(r.incident.reportedAt)}</dd></div>
                  <div><dt>{t('responder.destination')}</dt><dd>{primary.hospitalName ?? '—'}</dd></div>
                  <div><dt>{t('asg.route')}</dt><dd>{r.route?.takenM != null ? distance(r.route.takenM) : '—'}</dd></div>
                  {primary.routeHospitalM != null && (
                    <div><dt>{t('insights.replay.transportLeg')}</dt><dd>{distance(primary.routeHospitalM)}</dd></div>
                  )}
                </dl>

                {trip?.fromBreadcrumbs && (
                  <p className="insights__replay-note"><Info aria-hidden /> {t('insights.replay.breadcrumbs')}</p>
                )}

                {r.agencySla.length > 0 && (
                  <table className="pillar__table">
                    <caption className="pillar__footnote" style={{ textAlign: 'start', marginBottom: 'var(--sp-4)' }}>{t('sla.title')}</caption>
                    <thead><tr><th>{t('insights.replay.agency')}</th><th className="numeric">{t('insights.replay.ack')}</th><th>{t('sla.title')}</th></tr></thead>
                    <tbody>
                      {r.agencySla.map((s) => (
                        <tr key={s.agencyCode}>
                          <td>{s.agencyName}</td>
                          <td className="numeric">{s.ackSec != null ? duration(s.ackSec) : '—'}</td>
                          <td><Chip tone={s.met == null ? 'neutral' : s.met ? 'success' : 'danger'}>{s.met == null ? t('sla.pending') : s.met ? t('sla.met') : t('sla.breached')}</Chip></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </Card>

          <Card title={t('timeline.title')} variant="flat">
            <ol className="insights__timeline">
              {r.timeline.map((row, i) => (
                <li key={i}>
                  <span>{row.label}</span>
                  <span className="mono">
                    <button type="button" className="insights__timeline-jump"
                            onClick={() => trip && seek((Date.parse(row.ts) - trip.from) / (trip.to - trip.from))}>
                      {timeGst(row.ts)}
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}
