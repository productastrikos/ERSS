/**
 * Popups for the agency feed layers. Replaces the setHTML popups in DSOMap.tsx and
 * utils/trafficIcons.ts, which carried their own palette and poked a countdown into
 * the DOM by id.
 */

import { useEffect, useState } from 'react';
import { t } from '../../../lib/i18n';
import { count, pct, relative } from '../../../lib/format';
import { CctvFeed, Chip, SimulatedChip } from '../../ui';
import { PopupBody } from '../MapPopup';
import type { PopupProps } from '../layerRegistry';
import { TONE_TOKEN } from '../tokens';
import { signalTone, type SignalPhase, type SignalPoint, type TrafficAccident } from '../layers/agency/traffic';
import { bmsTone, type BmsBuilding, type BmsMode } from '../layers/agency/bms';
import { nodeTone, type WaterBreak, type WaterNode } from '../layers/agency/water';
import { binTone, fillBand, type WasteBin } from '../layers/agency/waste';
import { aqiBand, emissionTone, type AirSensor, type PollutionSource } from '../layers/agency/environment';

// ── Transport ────────────────────────────────────────────────────────────────

export function TrafficPopup(props: PopupProps) {
  return props.selection.kind === 'signal' ? <SignalPopup {...props} /> : <CameraPopup {...props} />;
}

const YELLOW_SEC = 3;   // UAE / GCC standard amber

/**
 * The phase countdown ticks locally between feed updates, cycling GREEN → YELLOW → RED
 * with the signal's own timings — the same extrapolation DSOMap ran, as React state.
 */
function usePhaseCountdown(s: SignalPoint): { phase: SignalPhase; remaining: number } {
  const initial = s.phaseRemainingSec ?? (s.phase === 'YELLOW' ? YELLOW_SEC : s.phase === 'RED' ? s.redSec : s.greenSec);
  const [state, setState] = useState({ phase: s.phase, remaining: initial });

  useEffect(() => {
    if (s.status !== 'ACTIVE' || s.phase === 'FLASHING') return;
    const id = setInterval(() => setState((cur) => {
      if (cur.remaining > 1) return { ...cur, remaining: cur.remaining - 1 };
      if (cur.phase === 'GREEN') return { phase: 'YELLOW', remaining: YELLOW_SEC };
      if (cur.phase === 'YELLOW') return { phase: 'RED', remaining: s.redSec };
      return { phase: 'GREEN', remaining: s.greenSec };
    }), 1000);
    return () => clearInterval(id);
  }, [s.status, s.phase, s.redSec, s.greenSec]);

  return state;
}

function SignalPopup({ selection }: PopupProps) {
  const s = selection.data as SignalPoint;
  const { phase, remaining } = usePhaseCountdown(s);
  const tone = signalTone({ phase, status: s.status });
  const efficiency = s.cycleSec ? (s.greenSec / s.cycleSec) * 100 : null;

  return (
    <PopupBody
      eyebrow={`${t('map.traffic.signal')} · ${s.id}`}
      title={s.name}
      chips={<>
        <Chip tone={tone}>{s.status === 'ACTIVE' ? phase : s.status}</Chip>
        {s.held && <Chip tone="accent">{t('map.legend.signalHeld')}</Chip>}
        <SimulatedChip />
      </>}
      rows={[
        s.status === 'ACTIVE' && phase !== 'FLASHING' ? [t('map.traffic.remaining'), `${remaining} s`] : null,
        [t('map.traffic.density'), `${count(s.density)} veh/km`],
        [t('map.traffic.greenTime'), `${count(s.greenSec)} s`],
        [t('map.traffic.connectedRoads'), count(s.connectedRoads)],
      ]}
    >
      {s.cameraUrl && <CctvClip src={s.cameraUrl} />}
      {efficiency != null && (
        <div className="map-popup__factor">
          <div className="map-popup__factor-head">
            <span>{t('map.traffic.greenEfficiency')}</span>
            <span className="numeric">{pct(efficiency)}</span>
          </div>
          <div className="map-popup__meter" style={{ ['--meter' as string]: `var(${TONE_TOKEN[tone]})` }}>
            <span style={{ width: `${efficiency}%` }} />
          </div>
        </div>
      )}
    </PopupBody>
  );
}

function CameraPopup({ selection }: PopupProps) {
  const a = selection.data as TrafficAccident;
  return (
    <PopupBody
      eyebrow={t('map.traffic.cctv')}
      title={a.name}
      chips={<><Chip tone="danger">{t('map.traffic.live')}</Chip><SimulatedChip /></>}
    >
      {a.cameraUrl && <CctvClip src={a.cameraUrl} />}
    </PopupBody>
  );
}

// ── Civil Defence (BMS) ──────────────────────────────────────────────────────

const ALERT_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;

export function BmsPopup({ selection }: PopupProps) {
  const { building: b, mode } = selection.data as { building: BmsBuilding; mode: BmsMode };
  const tone = bmsTone(b, 'status');
  // The metric the overlay is currently colouring by leads the list.
  const metrics: Array<[BmsMode, string, string]> = [
    ['power', t('map.bms.power'), pct(b.powerLoadPct)],
    ['hvac', t('map.bms.hvac'), pct(b.hvacEfficiencyPct)],
    ['occupancy', t('map.bms.occupancy'), `${pct(b.occupancyPct)} · ${count(b.occupancyCount)}`],
    ['water', t('map.bms.pressure'), `${b.waterPressureBar.toFixed(1)} bar`],
  ];
  metrics.sort((x, y) => Number(y[0] === mode) - Number(x[0] === mode));

  return (
    <PopupBody
      eyebrow={`${t('map.layer.bms')} · ${b.id}`}
      title={b.name}
      chips={<>
        <Chip tone={tone}>{t(`map.bms.status.${b.status}`)}</Chip>
        {b.fireAlarms > 0 && <Chip tone="danger">{t('map.bms.fireAlarms', { n: b.fireAlarms })}</Chip>}
        <SimulatedChip />
      </>}
      rows={[
        [t('map.field.floors'), `${count(b.floors)} · ${count(b.heightM)} m`],
        ...metrics.map(([, label, value]): [string, string] => [label, value]),
      ]}
    >
      {b.alerts.slice(0, 3).map((a) => (
        <div key={a.id} className="map-popup__factor-head">
          <span>{a.message}</span>
          <Chip tone={ALERT_TONE[a.severity]}>{a.system}</Chip>
        </div>
      ))}
    </PopupBody>
  );
}

// ── Utility (DEWA) ───────────────────────────────────────────────────────────

const SEVERITY_TONE = { LOW: 'info', MEDIUM: 'warning', HIGH: 'danger', CRITICAL: 'danger' } as const;

export function WaterPopup({ selection }: PopupProps) {
  if (selection.kind === 'water-break') {
    const b = selection.data as WaterBreak;
    return (
      <PopupBody
        eyebrow={t('map.water.break')}
        title={t(`map.water.kind.${b.kind}`)}
        chips={<><Chip tone={SEVERITY_TONE[b.severity]}>{b.severity}</Chip><SimulatedChip /></>}
        rows={[
          [t('map.water.pipe'), <span className="map-popup__mono">{b.pipeId}</span>],
          b.affectedUsers != null ? [t('map.water.users'), count(b.affectedUsers)] : null,
          b.pressureDropPsi != null ? [t('map.water.pressureDrop'), `${count(b.pressureDropPsi)} PSI`] : null,
        ]}
      />
    );
  }

  const n = selection.data as WaterNode;
  return (
    <PopupBody
      eyebrow={`${t(`map.water.node.${n.kind}`)} · ${n.id}`}
      title={n.name}
      chips={<>
        <Chip tone={nodeTone(n)}>{t(`map.water.status.${n.status}`)}</Chip>
        {n.affected && <Chip tone="danger">{t('map.water.affected')}</Chip>}
        <SimulatedChip />
      </>}
      rows={[
        n.pressurePsi != null ? [t('map.water.pressure'), `${count(n.pressurePsi)} PSI`] : null,
        n.flowLpm != null ? [t('map.water.flow'), `${count(n.flowLpm)} L/min`] : null,
        n.population != null ? [t('map.water.users'), count(n.population)] : null,
        n.capacityL != null ? [t('map.water.capacity'), `${count(n.capacityL / 1000)} kL`] : null,
      ]}
    />
  );
}

// ── Municipality ─────────────────────────────────────────────────────────────

export function WastePopup({ selection }: PopupProps) {
  const b = selection.data as WasteBin;
  const tone = binTone(b);
  return (
    <PopupBody
      eyebrow={`${t(`map.waste.kind.${b.kind}`)} · ${b.id}`}
      title={b.name}
      chips={<>
        <Chip tone={tone}>{b.sensor === 'offline' ? t('map.waste.offline') : t(`map.waste.band.${fillBand(b.fillPct)}`)}</Chip>
        <SimulatedChip />
      </>}
      rows={[
        [t('map.waste.zone'), b.zone],
        [t('map.waste.capacity'), `${count(b.capacityL)} L`],
        [t('map.waste.battery'), pct(b.batteryPct)],
        [t('map.waste.lastCollected'), relative(b.lastCollectedAt)],
      ]}
    >
      <div className="map-popup__factor">
        <div className="map-popup__factor-head">
          <span>{t('map.waste.fill')}</span>
          <span className="numeric">{pct(b.fillPct)}</span>
        </div>
        <div className="map-popup__meter" style={{ ['--meter' as string]: `var(${TONE_TOKEN[tone]})` }}>
          <span style={{ width: `${Math.min(100, b.fillPct)}%` }} />
        </div>
      </div>
    </PopupBody>
  );
}

// ── Environment ──────────────────────────────────────────────────────────────

const MITIGATION_TONE = { none: 'neutral', monitoring: 'info', active: 'warning', resolved: 'success' } as const;

export function EnvironmentPopup(props: PopupProps) {
  return props.selection.kind === 'air-sensor' ? <AirSensorPopup {...props} /> : <PollutionSourcePopup {...props} />;
}

function AirSensorPopup({ selection }: PopupProps) {
  const s = selection.data as AirSensor;
  const band = aqiBand(s.aqi);
  return (
    <PopupBody
      eyebrow={`${s.zone} · ${s.id}`}
      title={s.name}
      chips={<>
        <Chip tone={band.tone}>{`AQI ${Math.round(s.aqi)} · ${t(`map.env.aqi.${band.key}`)}`}</Chip>
        <SimulatedChip />
      </>}
      rows={[
        ['PM2.5', `${count(s.pm25)} µg/m³`],
        ['PM10', `${count(s.pm10)} µg/m³`],
        ['NO₂', `${count(s.no2)} µg/m³`],
        ['O₃', `${count(s.o3)} µg/m³`],
        ['CO₂', `${count(s.co2)} ppm`],
        [t('map.env.temperature'), `${count(s.temperatureC)} °C · ${count(s.humidityPct)}%`],
        [t('map.env.wind'), `${count(s.windKph)} km/h · ${count(s.windDirDeg)}°`],
        s.lastCalibration ? [t('map.env.calibrated'), s.lastCalibration] : null,
      ]}
    />
  );
}

function PollutionSourcePopup({ selection }: PopupProps) {
  const s = selection.data as PollutionSource;
  return (
    <PopupBody
      eyebrow={`${t(`map.env.kind.${s.kind}`)} · ${s.activeHours}`}
      title={s.name}
      chips={<>
        <Chip tone={emissionTone(s.emission)}>{t(`map.env.emission.${s.emission}`)}</Chip>
        <Chip tone={MITIGATION_TONE[s.mitigation]}>{t(`map.env.mitigation.${s.mitigation}`)}</Chip>
        <SimulatedChip />
      </>}
      rows={[
        [t('map.env.contribution'), pct(s.contributionPct)],
        ['PM2.5', `${count(s.pollutants.pm25)} µg/m³`],
        ['NO₂', `${count(s.pollutants.no2)} µg/m³`],
        ['VOC', `${count(s.pollutants.voc)} ppb`],
        [t('map.field.radius'), `${count(s.affectedRadiusM)} m`],
        s.trafficPerHour != null ? [t('map.env.traffic'), `${count(s.trafficPerHour)} veh/h`] : null,
      ]}
    >
      {s.description && <div className="map-popup__note">{s.description}</div>}
    </PopupBody>
  );
}

/** A looping, muted clip. Labelled simulated alongside — it is a recording, not a feed. */
function CctvClip({ src }: { src: string }) {
  return <CctvFeed className="map-popup__media" src={src} label={t('map.traffic.cctv')} />;
}
