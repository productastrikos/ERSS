/**
 * Non-component helpers the Operations components share: status tones, the agency
 * lookup, labels. Components live in opsUi.tsx (fast refresh needs the two apart).
 */

import { useMemo } from 'react';
import type { Agency, AgencyCode, AssignState, Priority } from '../../../lib/types';
import { useBoot } from '../../../lib/stores/session';
import { t } from '../../../lib/i18n';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const ACTIVE_ASSIGNMENT: ReadonlySet<AssignState> = new Set([
  'offered', 'acknowledged', 'enroute', 'onscene', 'transporting', 'at_hospital', 'resolved_on_scene',
]);

export const EN_ROUTE: ReadonlySet<AssignState> = new Set(['offered', 'acknowledged', 'enroute']);

/** Priority is a status scale (docs/05 §5.4), and every chip carries its label. */
export const PRIORITY_TONE: Record<Priority, Tone> = { P1: 'danger', P2: 'danger', P3: 'info', P4: 'neutral' };

export const ASSIGNMENT_TONE: Record<AssignState, Tone> = {
  offered: 'warning', acknowledged: 'info', enroute: 'info', onscene: 'success',
  transporting: 'accent', at_hospital: 'accent', resolved_on_scene: 'success',
  cleared: 'neutral', declined: 'neutral', timed_out: 'neutral', cancelled: 'neutral',
};

export function useAgencies(): Map<AgencyCode, Agency> {
  const boot = useBoot();
  return useMemo(() => new Map((boot?.agencies ?? []).map((a) => [a.code, a])), [boot]);
}

export const kindLabel = (kind: string) => t(`kind.${kind}`);

/** "+0:39" / "−1:12" — a signed m:ss for prediction error. */
export function signedDuration(sec: number): string {
  const s = Math.round(Math.abs(sec));
  return `${sec < 0 ? '−' : '+'}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
