/**
 * The crew's AI co-pilot (server services/crewAssist.js): what the platform already knows
 * about this job, said at the moment the crew needs it — the briefing when the job
 * arrives, the road ahead while driving, scene safety and backup on arrival, the handover
 * on the way in. Every line carries its source; nothing is invented.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, Navigation, ShieldAlert, Sparkles, Users, Volume2, VolumeX } from 'lucide-react';
import type { Assignment, CrewAssist } from '../../lib/types';
import { api } from '../../lib/api';
import { speak } from '../../lib/sound';
import { distance as fmtDistance } from '../../lib/format';
import { SimulatedChip } from '../../shared/ui';

type Stage = 'briefing' | 'driving' | 'scene' | 'transport' | 'handover';

function stageOf(state: Assignment['state'], atPatient: boolean): Stage {
  if (state === 'offered' || state === 'acknowledged') return 'briefing';
  if (state === 'enroute') return 'driving';
  if (state === 'onscene') return atPatient ? 'transport' : 'scene';
  if (state === 'transporting') return 'transport';
  return 'handover';
}

/** Spoken once per stage of a job, while the voice is on. */
function spoken(stage: Stage, a: CrewAssist): string | null {
  const b = a.briefing;
  switch (stage) {
    case 'briefing': return `New job. ${b.headline}. ${b.whyYou}. Prepare ${b.prepare.join(', ')}.`;
    case 'driving': return a.route?.advice ?? null;
    case 'scene': return [b.safety[0], b.backup].filter(Boolean).join('. ') || null;
    case 'transport': return a.route?.to && a.route.to !== 'scene' ? `Transporting to ${a.route.to}. The handover is drafted.` : null;
    default: return null;
  }
}

export function AiCopilot({ state, atPatient, compact }: { state: Assignment['state']; atPatient: boolean; compact?: boolean }) {
  const [assist, setAssist] = useState<CrewAssist | null>(null);
  const [voice, setVoice] = useState(true);
  const said = useRef(new Set<string>());
  const stage = stageOf(state, atPatient);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.me.assist().then((r) => { if (!cancelled) setAssist(r); }).catch(() => {});
    load();
    const id = window.setInterval(load, 6000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [state, atPatient]);

  useEffect(() => {
    if (!assist || !voice) return;
    const key = `${assist.assignmentRef}:${stage}`;
    if (said.current.has(key)) return;
    const text = spoken(stage, assist);
    if (!text) return;
    said.current.add(key);
    speak(text);
  }, [assist, stage, voice]);

  if (!assist) {
    return (
      <section className="r-ai" data-demo="copilot">
        <header className="r-ai__head"><Sparkles aria-hidden /> <strong>AI co-pilot</strong><span className="r-ai__sub">reading the job…</span></header>
      </section>
    );
  }

  const b = assist.briefing;
  const route = assist.route;

  return (
    <section className={`r-ai${compact ? ' r-ai--compact' : ''}`} data-demo={compact ? 'briefing' : 'copilot'}>
      <header className="r-ai__head">
        <Sparkles aria-hidden />
        <strong>AI co-pilot</strong>
        <span className="r-ai__sub">{stage === 'briefing' ? 'briefing' : stage === 'driving' ? 'on the way' : stage === 'scene' ? 'on scene' : stage === 'transport' ? 'transport' : 'handover'}</span>
        <button type="button" className="r-ai__voice" aria-pressed={voice} onClick={() => setVoice((v) => !v)}
                title={voice ? 'Voice on — tap to mute' : 'Voice off'}>
          {voice ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
        </button>
      </header>

      {(stage === 'briefing' || stage === 'scene') && (
        <>
          <p className="r-ai__lead">{b.whyYou}</p>
          <ul className="r-ai__points">
            {b.points.map((p) => <li key={p.text}><span>{p.text}</span><small>{p.source}</small></li>)}
          </ul>
        </>
      )}

      {route && (stage === 'briefing' || stage === 'driving' || stage === 'transport') && route.advice && (
        <div className="r-ai__row" data-demo="ai-route">
          <Navigation aria-hidden />
          <span>
            <strong>{route.to === 'scene' ? 'Road to the scene' : `Road to ${route.to}`}{route.remainingM != null && ` · ${fmtDistance(route.remainingM)}`}</strong>
            <em>{route.advice}</em>
            {route.simulatedTraffic && <span className="r-ai__chip"><SimulatedChip label="Simulated traffic" /></span>}
          </span>
        </div>
      )}

      {(stage === 'briefing' || stage === 'driving') && (
        <div className="r-ai__row">
          <ClipboardList aria-hidden />
          <span><strong>Prepare</strong><em>{b.prepare.join(' · ')}</em></span>
        </div>
      )}

      {(stage === 'briefing' || stage === 'driving' || stage === 'scene') && b.safety.map((s) => (
        <div key={s} className="r-ai__row is-warn">
          <ShieldAlert aria-hidden />
          <span><strong>Scene safety</strong><em>{s}</em></span>
        </div>
      ))}

      {b.backup && (stage !== 'handover') && (
        <div className="r-ai__row is-warn">
          <Users aria-hidden />
          <span><strong>Backup</strong><em>{b.backup}</em></span>
        </div>
      )}

      {(stage === 'transport' || stage === 'handover') && (
        <div className="r-ai__handover" data-demo="handover">
          <div className="r-ai__handover-title">
            <ClipboardList aria-hidden /> Handover — drafted by AI from the record{!assist.handover.ready && ' (in progress)'}
          </div>
          <dl>
            {assist.handover.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <p className="r-ai__note"><AlertTriangle aria-hidden /> Check and complete clinical findings before handing over.</p>
        </div>
      )}
    </section>
  );
}
