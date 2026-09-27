/**
 * Command Centre — the operational workbench and its supporting reports, consolidated
 * behind one tab strip: Operations (the live dispatch board), AI advisories, response
 * time, stations & zones, demand & coverage, and the executive view.
 *
 * These were six separate top-level pages; they are one subsystem now, and the six
 * promoted Insights pages (Overview, Radial search, Comparison, Call centre,
 * Performance, Replay — pages.tsx) took their place in the sidebar instead.
 *
 * Deep links keep working with no change to the pages themselves: `openIncident()`
 * (lib/router.ts) lands here with `?tab=operations&incident=…`, and Operations' own
 * `?incident=/queue=/prio=` keys live alongside `tab` in the same query string —
 * Operations reads `window.location.pathname` for its own URL bookkeeping, never a
 * hard-coded `/operations`, so mounting it under `/command` needed no change there.
 */

import type { ComponentType } from 'react';
import { Radio, Siren, Timer, Trophy, Map as MapIcon, Gauge } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { navigate, useLocation } from '../../../lib/router';
import { useUser } from '../../../lib/stores/session';
import { OperationsPage } from '../operations/OperationsPage';
import { AdvisoriesPage } from '../advisories/AdvisoriesPage';
import { CollaboratePage } from '../collaborate/CollaboratePage';
import { RankingPage } from '../ranking/RankingPage';
import { AnalyticsPage } from '../analytics/AnalyticsPage';
import { ExecutivePage } from '../executive/ExecutivePage';
import '../pillar.scss';
import './command.scss';

type Tab = 'operations' | 'advisories' | 'response-time' | 'ranking' | 'analytics' | 'executive';

const TABS: Array<{ key: Tab; label: string; icon: ComponentType<{ 'aria-hidden'?: boolean }>; capability: string; render: () => React.ReactElement }> = [
  { key: 'operations', label: 'nav.operations', icon: Radio, capability: 'operations.view', render: () => <OperationsPage /> },
  { key: 'advisories', label: 'nav.advisories', icon: Siren, capability: 'advisories.view', render: () => <AdvisoriesPage /> },
  { key: 'response-time', label: 'nav.collaborate', icon: Timer, capability: 'collaborate.view', render: () => <CollaboratePage /> },
  { key: 'ranking', label: 'nav.ranking', icon: Trophy, capability: 'ranking.view', render: () => <RankingPage /> },
  { key: 'analytics', label: 'nav.analytics', icon: MapIcon, capability: 'analytics.view', render: () => <AnalyticsPage /> },
  { key: 'executive', label: 'nav.executive', icon: Gauge, capability: 'executive.view', render: () => <ExecutivePage /> },
];

export function CommandCentrePage() {
  const user = useUser();
  const location = useLocation();
  const visible = TABS.filter((tb) => user?.capabilities.includes(tb.capability));

  const requested = new URLSearchParams(location.search).get('tab');
  const active = visible.find((tb) => tb.key === requested) ?? visible[0];

  return (
    <div className="command-centre">
      <nav className="pillar__tabbar" aria-label={t('nav.commandCentre')}>
        {visible.map((tb) => {
          const Icon = tb.icon;
          return (
            <button key={tb.key} type="button" aria-current={active?.key === tb.key ? 'page' : undefined}
                    onClick={() => navigate(`/command?tab=${tb.key}`)}>
              <Icon aria-hidden /> {t(tb.label)}
            </button>
          );
        })}
      </nav>
      <div className="command-centre__body">
        {active?.render()}
      </div>
    </div>
  );
}
