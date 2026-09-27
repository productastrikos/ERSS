/**
 * The detection panel — what the room watches while a camera raises an incident by itself.
 *
 * It lives in the console shell rather than on a page, because a detection is not a thing
 * an operator navigated to: it happens, and it has to arrive wherever they already are.
 * Same reasoning as AlertPopup next door.
 *
 * The panel is ONE component for every kind of detection. A collision at a junction and a
 * collapse in a server room are the same five stages, the same cameras, the same SOP
 * shape — they differ in their evidence rows and their procedure, both of which are data
 * from the server (engines/detection.js, data/reference/sop.js). Adding a third kind of
 * detection does not touch this file.
 *
 * What it is built to make undeniable, in this order:
 *   1. the evidence, as the sensors reported it, before any interpretation
 *   2. the corroboration — that no single camera was trusted on its own
 *   3. the verdict WITH its confidence and the alternatives it ruled out
 *   4. that zero calls had been received when the alert was raised
 *   5. the procedure, and which steps the platform had already completed by itself
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Building2, Check, ChevronRight, Radio, ShieldCheck, Video, X } from 'lucide-react';

import { t } from '../../lib/i18n';
import { timeSec } from '../../lib/format';
import { openIncident } from '../../lib/router';
import { openDetection, useOpenDetection } from '../../lib/stores/live';
import { Button, CctvFeed, Chip, Dot, SimulatedChip } from '../../shared/ui';
import type { Detection, DetectionStage } from '../../lib/types';
import { FloorStack } from './FloorStack';
import './detection.scss';

const STAGE_ORDER: DetectionStage[] = ['sensor', 'validate', 'confirm', 'alert', 'incident'];

export function DetectionPanel() {
  const detection = useOpenDetection();
  if (!detection) return null;
  return <Panel key={detection.id} detection={detection} />;
}

function Panel({ detection: d }: { detection: Detection }) {
  const index = d.stageIndex;
  const severity = d.verdict?.severity ?? 'HIGH';
  const tone = severity === 'HIGH' ? 'danger' : severity === 'MEDIUM' ? 'warning' : 'neutral';

  return (
    <aside className="detection" role="dialog" aria-label={t('detection.title')}>
      <header className="detection__head">
        <div className="detection__head-row">
          <AlertTriangle aria-hidden className="detection__head-icon" />
          <h2>{t('detection.title')}</h2>
          <button type="button" className="detection__close" onClick={() => openDetection(null)}
                  aria-label={t('common.close')}>
            <X aria-hidden />
          </button>
        </div>
        <div className="detection__badges">
          <Chip tone={tone}>{severity}</Chip>
          <Chip tone="neutral">{d.id}</Chip>
          {/* The whole claim, as a chip. Not a sentence in a paragraph somebody skims. */}
          <Chip tone={d.callsReceived === 0 ? 'accent' : 'neutral'}>
            {t('detection.callsReceived', { n: d.callsReceived })}
          </Chip>
          <SimulatedChip />
        </div>
        <div className="detection__where">
          <strong>{d.place.name}</strong>
          {d.place.detail && <span>{d.place.detail}</span>}
          <span className="detection__at">{t('detection.at')} {timeSec(d.detectedAt)}</span>
        </div>
      </header>

      <StageTimeline index={index} />

      <div className="detection__scroll">
        {index >= 0 && <Evidence d={d} live={index === 0} />}
        {index >= 1 && <Corroboration d={d} live={index === 1} />}
        {index >= 2 && d.verdict && <Verdict d={d} />}
        {/* An indoor detection is a place in a building, not a dot on a map — the stack
            goes above the cameras because it is what the approach is planned from. */}
        {index >= 2 && d.place.building && d.place.floor != null && (
          <Section title={t('detection.section.floor')} icon={<Building2 aria-hidden />}>
            <FloorStack building={d.place.building} floor={d.place.floor} />
          </Section>
        )}
        {index >= 1 && <CctvWall d={d} />}
        {index >= 3 && <AlertBanner d={d} />}
        {index >= 4 && <Sop d={d} />}
      </div>
    </aside>
  );
}

// ── The five stages ──────────────────────────────────────────────────────────

function StageTimeline({ index }: { index: number }) {
  return (
    <ol className="detection__stages">
      {STAGE_ORDER.map((stage, i) => {
        const state = index > i ? 'done' : index === i ? 'active' : 'todo';
        return (
          <li key={stage} className={`detection__stage is-${state}`}>
            <span className="detection__stage-dot">{state === 'done' ? <Check aria-hidden /> : i + 1}</span>
            <span className="detection__stage-name">{t(`detection.stage.${stage}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, icon, live, children }: {
  title: string; icon?: ReactNode; live?: boolean; children: ReactNode;
}) {
  return (
    <section className={`detection__section${live ? ' is-live' : ''}`}>
      <h3>{icon}{title}{live && <Dot tone="warning" />}</h3>
      {children}
    </section>
  );
}

function Evidence({ d, live }: { d: Detection; live: boolean }) {
  return (
    <Section title={t('detection.section.evidence')} live={live}>
      <dl className="detection__grid">
        {d.evidence.map((e) => (
          <div key={e.label} className={e.anomalous ? 'is-anomalous' : ''}>
            <dt>{e.label}</dt>
            <dd>{e.value}</dd>
          </div>
        ))}
      </dl>
      {live && <div className="detection__scanbar"><span /></div>}
    </Section>
  );
}

function Corroboration({ d, live }: { d: Detection; live: boolean }) {
  return (
    <Section title={t('detection.section.corroboration')} icon={<ShieldCheck aria-hidden />} live={live}>
      <ul className="detection__rows">
        {d.corroboration.map((c) => (
          <li key={c.source}>
            <span className="detection__rows-k"><Check aria-hidden /> {c.source}</span>
            <span className="detection__rows-v">{c.result}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Verdict({ d }: { d: Detection }) {
  const v = d.verdict;
  if (!v) return null;
  const pct = Math.round(v.confidence * 100);
  return (
    <Section title={t('detection.section.verdict')}>
      <div className="detection__verdict">
        <span className="detection__verdict-label">{v.label}</span>
        <Chip tone={v.severity === 'HIGH' ? 'danger' : 'warning'}>{v.severity}</Chip>
      </div>
      <div className="detection__confidence">
        <span>{t('detection.confidence')}</span>
        <div className="detection__meter"><span style={{ width: `${pct}%` }} /></div>
        <span className="numeric">{pct}%</span>
      </div>
      {/* Ruling things OUT is what separates a detection from a motion sensor. */}
      <ul className="detection__checks">
        {v.ruledOut.map((c) => (
          <li key={c.label} className={c.answer ? 'is-yes' : 'is-no'}>
            <span>{c.label}</span><span>{c.answer ? t('common.yes') : t('common.no')}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AlertBanner({ d }: { d: Detection }) {
  return (
    <div className="detection__alert">
      <div className="detection__alert-tag"><Radio aria-hidden /> {t('detection.alertRaised')}</div>
      <div className="detection__alert-title">{d.verdict?.label}</div>
      <div className="detection__alert-meta">
        {d.place.name}
        {d.place.floor != null && ` · ${t('map.camera.floor')} ${d.place.floor}`}
        {d.place.roomName && ` · ${d.place.roomName}`}
      </div>
    </div>
  );
}

// ── CCTV ─────────────────────────────────────────────────────────────────────

/**
 * Both angles, side by side, playing. Two cameras on one incident is not decoration: it
 * is the reason the confidence is 0.9 and not 0.6, and an operator deciding whether to
 * commit a crew is entitled to see what the engine saw.
 */
function CctvWall({ d }: { d: Detection }) {
  return (
    <Section title={t('detection.section.cctv')} icon={<Video aria-hidden />}>
      <div className="detection__cctv">
        {d.cameras.map((c) => (
          <figure key={c.id} className={c.primary ? 'is-primary' : ''}>
            <CctvFeed src={c.clipUrl} label={c.name} />
            <span className="detection__rec"><Dot tone="danger" /> {t('detection.rec')}</span>
            <figcaption>
              {c.id}
              {c.floor != null && ` · F${c.floor}`}
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

// ── SOP ──────────────────────────────────────────────────────────────────────

/**
 * The procedure, with the steps the platform has already completed marked as done before
 * the operator read them. Those pre-done rows are the argument: each one is a phone call
 * that did not have to happen while somebody was on the floor of a server room.
 */
function Sop({ d }: { d: Detection }) {
  const sop = d.sop;
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Auto steps land as the panel opens, one after another, so the operator sees them
  // being done rather than finding a wall of pre-ticked boxes.
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    if (!sop) return;
    const autos = sop.steps.filter((s) => s.auto);
    timers.current = autos.map((s, i) => setTimeout(
      () => setTicked((prev) => new Set(prev).add(s.id)),
      500 + i * 900,
    ));
    const running = timers.current;
    return () => { for (const timer of running) clearTimeout(timer); };
  }, [sop]);

  if (!sop) return null;

  return (
    <Section title={t('detection.section.sop')}>
      <div className="detection__sop-head">
        <strong>{sop.title}</strong>
        <span>{t('detection.lead')} {sop.leadAgency} · {sop.supportingAgencies.join(', ')}</span>
      </div>

      <div className="detection__advisory">
        <p>{sop.advisory.headline}</p>
        <dl>
          <div><dt>{t('detection.signalPlan')}</dt><dd>{sop.advisory.signalPlan}</dd></div>
          <div><dt>{t('detection.diversion')}</dt><dd>{sop.advisory.diversion}</dd></div>
          {sop.advisory.clearTimeEstMin != null && (
            <div><dt>{t('detection.clearEst')}</dt><dd>{sop.advisory.clearTimeEstMin} min</dd></div>
          )}
        </dl>
      </div>

      <ol className="detection__steps">
        {sop.steps.map((s) => {
          const done = s.auto && ticked.has(s.id);
          return (
            <li key={s.id} className={done ? 'is-done' : s.auto ? 'is-pending' : 'is-manual'}>
              <span className="detection__step-mark">{done ? <Check aria-hidden /> : null}</span>
              <span className="detection__step-body">
                <span className="detection__step-label">{s.label}</span>
                <span className="detection__step-meta">
                  {s.owner}
                  {s.auto
                    ? ` · ${done ? t('detection.doneByPlatform') : t('detection.inProgress')}`
                    : ` · ${t('detection.needsOperator')}`}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {d.incidentRef && (
        <Button variant="primary" block onClick={() => { openIncident(d.incidentRef as string); openDetection(null); }}>
          {t('detection.openIncident', { ref: d.incidentRef })} <ChevronRight aria-hidden />
        </Button>
      )}
    </Section>
  );
}
