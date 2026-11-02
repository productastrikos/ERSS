/**
 * Which report the studio is showing. Any screen opens one — an incident's report by ref, or
 * any document built on the spot (a table of data, the citizen's health readings) — and the
 * one studio each surface mounts (ReportStudioHost) shows it: read first, edit if wanted,
 * then download as PDF or Excel.
 */

import { createStore, useStore } from '../../lib/stores/createStore';
import type { ReportDoc } from './doc';

export type StudioSource =
  | { kind: 'incident'; ref: string }
  | { kind: 'doc'; build: () => ReportDoc | Promise<ReportDoc> };

export const reportStore = createStore<{ source: StudioSource | null; opened: number }>({ source: null, opened: 0 });

export const openReport = (source: StudioSource) => reportStore.set({ source, opened: Date.now() });
export const closeReport = () => reportStore.set({ source: null });
export const useReportSource = () => useStore(reportStore);
