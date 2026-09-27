/**
 * One ambulance in detail — vehicle, crew (demo roster), telemetry, its job and its day.
 *
 * Shared by the dashboard's ambulance panel and the ride-along card on the map, so the
 * crew named on the card is always the crew named in the panel. Polled while shown: speed,
 * distance to go and the traffic ahead change second by second.
 */

import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UnitDetail } from '../types';

interface State { request: string; data: UnitDetail | null; error: string | null }

export function useUnitDetail(ref: string | null, everyMs = 3000): { data: UnitDetail | null; error: string | null } {
  const [state, setState] = useState<State>({ request: '', data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ref) return undefined;
    let cancelled = false;
    api.live.unit(ref)
      .then((data) => { if (!cancelled) setState({ request: ref, data, error: null }); })
      .catch((err: Error) => { if (!cancelled) setState((s) => ({ request: ref, data: s.request === ref ? s.data : null, error: err.message })); });
    return () => { cancelled = true; };
  }, [ref, tick]);

  useEffect(() => {
    if (!ref || !everyMs) return undefined;
    const every = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(every);
  }, [ref, everyMs]);

  return state.request === ref ? { data: state.data, error: state.error } : { data: null, error: null };
}
