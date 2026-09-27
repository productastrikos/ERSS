/**
 * The AI advisory strip — the row of findings that sits directly under a page's KPI cards.
 *
 * The KPIs say what the numbers ARE. This says what they MEAN: the pattern behind them,
 * the thing an operator scanning the row would miss, and the one action that follows. Each
 * finding is a hard two-liner — a count, a share, a measured effect — and carries the
 * action as a collapsed arrow button, not a suggestion.
 *
 * Findings are computed by the CALLER from the same data the page already loaded, so the
 * strip never issues a query of its own and can never disagree with the chart below it.
 */

import type { ComponentType, ReactNode } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { t } from '../../lib/i18n';

export type FindingTone = 'info' | 'warning' | 'critical' | 'success';

export interface Finding {
  /** Stable key. */
  id: string;
  tone?: FindingTone;
  /** Two lines, hard-clamped: lead with the number, then the consequence. */
  headline: ReactNode;
  detail?: ReactNode;
  icon?: ComponentType<LucideProps>;
  action?: { label: string; run: () => void };
}

const SEVERITY: Record<FindingTone, number> = { critical: 0, warning: 1, info: 2, success: 3 };

export function AdvisoryStrip({
  findings, columns = 3, title, note,
}: {
  findings: Finding[];
  /** 2 or 3 across on a wide screen; collapses to one on narrow. */
  columns?: 2 | 3;
  title?: string;
  /** Honest labelling — how these were derived. */
  note?: string;
}) {
  if (findings.length === 0) return null;

  // The strip is a summary, not a dump: the most severe `columns` findings fill exactly
  // one row. A ragged second row reads as clutter, and anything that does not make the
  // cut is still in the AI advisory drawer (header, top right).
  const shown = [...findings]
    .sort((a, b) => SEVERITY[a.tone ?? 'info'] - SEVERITY[b.tone ?? 'info'])
    .slice(0, columns);
  const hidden = findings.length - shown.length;
  const heading = title ?? t('advisory.stripTitle');

  return (
    <section className="advisory-strip" aria-label={heading}>
      <header className="advisory-strip__head">
        <Sparkles aria-hidden />
        <h2>{heading}</h2>
        {note && <span className="advisory-strip__note">{note}</span>}
        {hidden > 0 && (
          <span className="advisory-strip__note">{t('advisory.stripMore', { n: hidden })}</span>
        )}
      </header>

      <div className="advisory-strip__grid" data-columns={columns}>
        {shown.map((f) => {
          const Icon = f.icon;
          return (
            <article key={f.id} className={`finding is-${f.tone ?? 'info'}`}>
              {Icon && <span className="finding__icon"><Icon aria-hidden /></span>}
              <div className="finding__text">
                <p className="finding__headline">{f.headline}</p>
                {f.detail && <p className="finding__detail">{f.detail}</p>}
              </div>
              {f.action && (
                <button type="button" className="finding__action" onClick={f.action.run}
                        title={f.action.label} aria-label={f.action.label}>
                  <ArrowRight aria-hidden />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
