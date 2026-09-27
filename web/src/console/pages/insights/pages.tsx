/**
 * The six promoted Insights subsystems, as top-level pages.
 *
 * These used to be tabs inside one "Search & insights" page; the sidebar is now the tab
 * strip — each gets its own nav item, its own URL, its own place in the keyboard-shortcut
 * map (ConsoleApp.tsx) — and each is still just its content component (OverviewTab, …)
 * inside the shared InsightsShell.
 */

import { LayoutGrid, Crosshair, GitCompare, Headset, Gauge, History } from 'lucide-react';
import { InsightsShell } from './InsightsShell';
import { OverviewTab } from './OverviewTab';
import { RadialSearchTab } from './RadialSearchTab';
import { ComparisonTab } from './ComparisonTab';
import { CallCentreTab } from './CallCentreTab';
import { PerformanceTab } from './PerformanceTab';
import { ReplayTab } from './ReplayTab';

export const OverviewPage = () => <InsightsShell icon={LayoutGrid} title="insights.tab.overview"><OverviewTab /></InsightsShell>;
export const RadialSearchPage = () => <InsightsShell icon={Crosshair} title="insights.tab.radial"><RadialSearchTab /></InsightsShell>;
export const ComparisonPage = () => <InsightsShell icon={GitCompare} title="insights.tab.compare"><ComparisonTab /></InsightsShell>;
export const CallCentrePage = () => <InsightsShell icon={Headset} title="insights.tab.callcentre"><CallCentreTab /></InsightsShell>;
export const PerformancePage = () => <InsightsShell icon={Gauge} title="insights.tab.performance"><PerformanceTab /></InsightsShell>;
export const ReplayPage = () => <InsightsShell icon={History} title="insights.tab.replay"><ReplayTab /></InsightsShell>;
