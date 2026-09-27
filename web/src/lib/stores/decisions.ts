/**
 * What the AI is thinking — the live previews, and the step-by-step trace of one incident.
 *
 * Two feeds, one idea (server/services/decisions.js):
 *
 *   previews   pushed over the socket the moment the AI starts weighing an incident and
 *              again when it has — the candidates, their road routes and the traffic on
 *              each. The map draws them while the countdown runs.
 *   trace      the incident's reasoning as numbered steps, read over REST. Polled while a
 *              panel shows it (the drive's distance and ETA are part of it) and re-read at
 *              once whenever anything about that incident moves.
 */

import { useEffect, useState } from 'react';
import { createStore, useStore } from './createStore';
import { api } from '../api';
import { onResync, onSocket } from '../socket';
import type { DecisionPreview, DecisionTrace } from '../types';

export const previewStore = createStore<{ byRef: Record<string, DecisionPreview> }>({ byRef: {} });

let wired = false;
export function wireDecisionFeed(): void {
  if (wired) return;
  wired = true;
  onSocket('decision:update', (p) => {
    previewStore.update((s) => {
      const byRef = { ...s.byRef, [p.incidentRef]: p };
      // Bounded: the trial tells one story at a time; a long day must not grow this forever.
      const keys = Object.keys(byRef);
      if (keys.length > 30) delete byRef[keys[0]];
      return { byRef };
    });
  });
}

export const usePreview = (ref: string | null | undefined): DecisionPreview | null =>
  useStore(previewStore, (s) => (ref ? s.byRef[ref] ?? null : null));

// ── The trace ────────────────────────────────────────────────────────────────

interface TraceState { request: string; data: DecisionTrace | null; error: string | null }

/**
 * The reasoning on one incident, kept current. Request-tagged state, set only inside the
 * promise callbacks — the repo's pattern for effects that fetch (see DispatchPanel.tsx).
 */
export function useDecisionTrace(ref: string | null): { data: DecisionTrace | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<TraceState>({ request: '', data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ref) return undefined;
    let cancelled = false;
    api.live.decision(ref)
      .then((data) => { if (!cancelled) setState({ request: ref, data, error: null }); })
      .catch((err: Error) => { if (!cancelled) setState((s) => ({ request: ref, data: s.request === ref ? s.data : null, error: err.message })); });
    return () => { cancelled = true; };
  }, [ref, tick]);

  // Re-read soon after anything about this incident moves; otherwise every two seconds
  // while the story is live (the drive's distance and ETA change continuously).
  useEffect(() => {
    if (!ref) return undefined;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (soon) return;
      soon = setTimeout(() => { soon = null; setTick((n) => n + 1); }, 350);
    };
    const offs = [
      onSocket('decision:update', (p) => { if (p.incidentRef === ref) bump(); }),
      onSocket('assignment:update', (p) => { if (p.incidentRef === ref) bump(); }),
      onSocket('incident:timeline', (p) => { if (p.ref === ref) bump(); }),
      onResync(bump),
    ];
    const every = setInterval(() => setTick((n) => n + 1), 2000);
    return () => {
      for (const off of offs) off();
      clearInterval(every);
      if (soon) clearTimeout(soon);
    };
  }, [ref]);

  const current = state.request === ref ? state : { data: null, error: null };
  return { data: current.data, error: current.error, loading: !!ref && !current.data && !current.error };
}
