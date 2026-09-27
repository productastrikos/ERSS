/**
 * The AI advisory slide-over — the second canonical right-edge panel (alongside the
 * incident detail rail), opened from the header's "AI Advisory" button.
 *
 * This is the reserved AI channel: the bronze/advisory hue appears here and on the header
 * trigger, nowhere else. Each advisory expands into root cause, numbered evidence,
 * recommendation, projected impact, then an action.
 *
 * Content is read from the advisory engine (`/api/advisories`), which already returns
 * detector-computed findings; nothing here is model-generated, so the panel labels itself
 * as computed rather than implying otherwise.
 */

import { useEffect, useState } from 'react';
import { X, ChevronDown, Sparkles } from 'lucide-react';

import { api } from '../../lib/api';
import { navigate } from '../../lib/router';
import { t } from '../../lib/i18n';
import type { Advisory } from '../../lib/types';

const PRIORITY: Record<string, { label: string; className: string }> = {
  emergency: { label: 'CRITICAL', className: 'is-critical' },
  alert: { label: 'HIGH', className: 'is-high' },
  warning: { label: 'MEDIUM', className: 'is-medium' },
  info: { label: 'INFO', className: 'is-info' },
};

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function AdvisoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Advisory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.advisories.list()
      .then((r) => { if (live) { setRows(r as Advisory[]); setError(null); } })
      .catch((e: Error) => { if (live) { setRows([]); setError(e.message); } });
    return () => { live = false; };
  }, [open]);

  // Esc closes any open side panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const live = (rows ?? []).filter((a) => !['closed', 'dismissed'].includes(a.state));

  return (
    <>
      {/* Transparent click-catcher: never dim or blur the page beneath. */}
      <div className="advisory-drawer__catcher" onClick={onClose} aria-hidden />

      <aside className="advisory-drawer" role="dialog" aria-modal="false" aria-label={t('advisory.title')}>
        <header className="advisory-drawer__head">
          <div>
            <h2><Sparkles aria-hidden /> {t('advisory.title')}</h2>
            <p>{t('advisory.activeCount', { n: live.length })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('advisory.close')}><X aria-hidden /></button>
        </header>

        <div className="advisory-drawer__body">
          {rows === null && <p className="advisory-drawer__empty">{t('common.loading')}</p>}

          {rows !== null && live.length === 0 && (
            <p className="advisory-drawer__empty">
              {error ? t('advisory.loadError', { error }) : t('advisory.drawerNone')}
            </p>
          )}

          {live.map((a) => {
            const meta = PRIORITY[a.severity] ?? PRIORITY.info;
            const isOpen = expanded === a.ref;
            return (
              <article key={a.ref} className="advisory-card">
                <button type="button" className="advisory-card__head"
                        onClick={() => setExpanded(isOpen ? null : a.ref)}
                        aria-expanded={isOpen}>
                  <span className="advisory-card__top">
                    <span className={`advisory-card__badge ${meta.className}`}>{meta.label}</span>
                    <span className="advisory-card__template">{titleCase(a.category ?? '')}</span>
                    <ChevronDown aria-hidden className={isOpen ? 'is-open' : ''} />
                  </span>
                  <span className="advisory-card__title">{a.title}</span>
                </button>

                {isOpen && (
                  <div className="advisory-card__body">
                    <section>
                      <h3>{t('advisory.rootCause')}</h3>
                      <p>{a.body}</p>
                    </section>

                    {a.evidence?.factors?.length > 0 && (
                      <section>
                        <h3>{t('advisory.evidence')}</h3>
                        <ol>
                          {a.evidence.factors.slice(0, 5).map((f) => (
                            <li key={f.name}>
                              <strong>{titleCase(f.name)}</strong>
                              {f.detail ? ` — ${f.detail}` : ''}
                              <span className="advisory-card__contrib">
                                {f.direction === 'down' ? '▼' : '▲'} {Math.abs(f.contribution).toFixed(1)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </section>
                    )}

                    {a.recommendedAction && (
                      <section>
                        <h3>{t('advisory.recommendation')}</h3>
                        <p className="advisory-card__rec">{a.recommendedAction}</p>
                      </section>
                    )}

                    {(a.baselineValue != null || a.targetValue != null || a.measuredValue != null) && (
                      <section>
                        <h3>{t('advisory.projectedImpact')}</h3>
                        <div className="advisory-card__impact">
                          {a.measuredValue != null && <span><b>{a.measuredValue}</b>{t('advisory.measured')}</span>}
                          {a.baselineValue != null && <span><b>{a.baselineValue}</b>{t('advisory.baseline')}</span>}
                          {a.targetValue != null && <span><b>{a.targetValue}</b>{t('advisory.target')}</span>}
                        </div>
                      </section>
                    )}

                    <footer className="advisory-card__meta">
                      {t('advisory.computedBy', { detector: a.detector })}
                      {a.evidence?.method ? ` · ${a.evidence.method}` : ''}
                      {a.evidence?.confidence != null ? ` · ${t('advisory.confidencePct', { pct: Math.round(a.evidence.confidence * 100) })}` : ''}
                    </footer>

                    <section className="advisory-card__actions">
                      <button type="button" onClick={() => { onClose(); navigate('/command?tab=advisories'); }}>
                        {t('advisory.openInCommand')} <span aria-hidden>›</span>
                      </button>
                    </section>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </aside>
    </>
  );
}
