/**
 * The shared page scaffold for the six promoted Insights subsystems (Overview, Radial
 * search, Comparison, Call centre, Performance, Replay) — each is its own sidebar item
 * and its own route now, but they still share one look: an icon-led title and the
 * `.pillar`/`.insights` styling every tab's markup was built against.
 */

import type { ComponentType, ReactNode } from 'react';
import { t } from '../../../lib/i18n';
import '../pillar.scss';
import './insights.scss';

export function InsightsShell({ icon: Icon, title, children }: {
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="pillar insights">
      <div className="pillar__head">
        <h1 className="pillar__title"><Icon aria-hidden /> {t(title)}</h1>
      </div>
      {children}
    </div>
  );
}
