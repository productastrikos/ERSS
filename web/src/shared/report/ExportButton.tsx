/**
 * The download control any screen puts beside its data. It opens the report studio on a
 * document built from what the screen is showing — never a straight-to-disk download: the
 * person sees it, can add a note or retitle it, and then takes it as PDF or Excel.
 */

import { Download, FileText } from 'lucide-react';
import type { ReportDoc } from './doc';
import { openReport } from './store';

export function ExportButton({ build, label = 'Download', iconOnly = false, title }: {
  build: () => ReportDoc | Promise<ReportDoc>;
  label?: string;
  iconOnly?: boolean;
  title?: string;
}) {
  return (
    <button type="button" className={`rs-export${iconOnly ? ' rs-export--icon' : ''}`}
            onClick={(e) => { e.stopPropagation(); openReport({ kind: 'doc', build }); }}
            aria-label={iconOnly ? label : undefined} title={title ?? 'Preview, edit and download as PDF or Excel'}>
      <Download aria-hidden />{!iconOnly && label}
    </button>
  );
}

/** Open an incident's report in the studio — the audience is decided by the server. */
export function ReportButton({ incidentRef, label = 'Report', iconOnly = false }: { incidentRef: string; label?: string; iconOnly?: boolean }) {
  return (
    <button type="button" className={`rs-export${iconOnly ? ' rs-export--icon' : ''}`}
            onClick={(e) => { e.stopPropagation(); openReport({ kind: 'incident', ref: incidentRef }); }}
            aria-label={iconOnly ? `${label} — ${incidentRef}` : undefined} title="Preview, edit and download the incident report">
      <FileText aria-hidden />{!iconOnly && label}
    </button>
  );
}
