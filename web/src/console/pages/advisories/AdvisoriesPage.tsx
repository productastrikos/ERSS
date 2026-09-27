/**
 * Advisories — Pillar 5, the action engine. docs/06 §6, docs/08 §4.
 *
 * Raw pass: hub, drill-down with the evidence panel, and Analyze/Act/Measure/Close/
 * Dismiss. The what-if runner from the full spec is not built this pass.
 */

import { useEffect, useState } from 'react';
import { Siren, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { useCan } from '../../../lib/stores/session';
import { Card, Segmented, Chip, EmptyState, ErrorState, Skeleton, Button, Modal, Field } from '../../../shared/ui';
import { FactorBars } from '../../../shared/charts';
import { relative, dateTime } from '../../../lib/format';
import '../pillar.scss';

interface AdvisoryRow {
  id: string; ref: string; severity: 'info' | 'warning' | 'alert' | 'emergency'; category: string;
  title: string; body: string; state: string; recommendedAction: string | null;
  assignedAgencyCode: string | null; createdAt: string; detector: string;
  evidence: { factors?: Array<{ name: string; contribution: number; direction?: 'up' | 'down'; detail?: string }>; confidence?: number | null; window?: { from: string; to: string } };
}

type SeverityFilter = 'all' | 'emergency' | 'alert' | 'warning' | 'info';
const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  emergency: 'danger', alert: 'warning', warning: 'warning', info: 'neutral',
};

export function AdvisoriesPage() {
  const canAct = useCan('advisories.act');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ request: string; rows: AdvisoryRow[] | null; error: string | null } | null>(null);
  const [open, setOpen] = useState<AdvisoryRow | null>(null);
  const [generating, setGenerating] = useState(false);

  const request = `${severity}#${reload}`;

  useEffect(() => {
    let cancelled = false;
    api.advisories.list(severity === 'all' ? undefined : { severity })
      .then((r) => { if (!cancelled) setResult({ request, rows: r as unknown as AdvisoryRow[], error: null }); })
      .catch((e) => { if (!cancelled) setResult({ request, rows: null, error: e.message ?? 'Failed to load' }); });
    return () => { cancelled = true; };
  }, [request, severity]);

  const loading = result?.request !== request;
  const rows = result?.rows ?? null;
  const error = result?.request === request ? result.error : null;
  const reloadList = () => setReload((n) => n + 1);

  async function runGenerate() {
    setGenerating(true);
    try { await api.advisories.generate(); reloadList(); } finally { setGenerating(false); }
  }

  async function runAction(ref: string, action: 'act' | 'close' | 'dismiss') {
    if (action === 'act') await api.advisories.act(ref, { action: 'acted', slaHours: 24, agencyCode: open?.assignedAgencyCode ?? 'DCAS' });
    if (action === 'close') await api.advisories.close(ref);
    if (action === 'dismiss') await api.advisories.dismiss(ref, 'Reviewed — no action needed');
    setOpen(null);
    reloadList();
  }

  const bySeverity = { emergency: 0, alert: 0, warning: 0, info: 0 } as Record<string, number>;
  for (const r of rows ?? []) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;

  return (
    <div className="pillar">
      <div className="pillar__head">
        <h1 className="pillar__title"><Siren aria-hidden /> AI advisories — actions that cut response time</h1>
        <div style={{ display: 'flex', gap: 'var(--sp-10)', alignItems: 'center' }}>
          <Segmented value={severity} onChange={setSeverity} ariaLabel="Severity"
            options={[{ value: 'all', label: 'All' }, { value: 'emergency', label: 'Emergency' }, { value: 'alert', label: 'Alert' }, { value: 'warning', label: 'Warning' }, { value: 'info', label: 'Info' }]} />
          {canAct && (
            <Button variant="secondary" size="sm" onClick={() => void runGenerate()} loading={generating}>
              <RefreshCw aria-hidden /> Run detectors
            </Button>
          )}
        </div>
      </div>
      <p className="pillar__sub">Every advisory here cites the data it was derived from — the window analysed, the sample, the factors, and a confidence, or an honest "not enough data". Nothing on this page is asserted without evidence attached.</p>

      <div className="pillar__kpirow">
        {Object.entries(bySeverity).map(([sev, n]) => (
          <Card key={sev}><Chip tone={SEVERITY_TONE[sev]}>{sev}</Chip> <span className="mono" style={{ marginInlineStart: 'var(--sp-8)' }}>{n}</span></Card>
        ))}
      </div>

      {error && <ErrorState body={error} onRetry={reloadList} />}
      {loading ? <Skeleton height={300} /> : !rows?.length ? (
        <EmptyState title="No open advisories" body="Nothing has crossed a detector's threshold right now." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
          {rows.map((r) => (
            <button key={r.ref} type="button" className="u-card" style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }} onClick={() => setOpen(r)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-12)', padding: 'var(--sp-12) var(--sp-14)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 'var(--sp-8)', alignItems: 'center' }}>
                    <Chip tone={SEVERITY_TONE[r.severity]}>{r.severity}</Chip>
                    <Chip tone="neutral">{r.category}</Chip>
                    <Chip tone="neutral">{r.state}</Chip>
                  </div>
                  <strong style={{ color: 'var(--app-text)' }}>{r.title}</strong>
                  <span style={{ fontSize: 12, color: 'var(--app-text-muted)' }}>{r.body}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--app-text-faint)', whiteSpace: 'nowrap' }}>{relative(r.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal title={open?.title ?? ''} subtitle={open ? `${open.ref} · ${open.detector}` : undefined} open={!!open} onClose={() => setOpen(null)} width={640}
        footer={open && canAct ? (
          <div style={{ display: 'flex', gap: 'var(--sp-8)' }}>
            <Button variant="secondary" onClick={() => void runAction(open.ref, 'dismiss')}>Dismiss</Button>
            <Button variant="secondary" onClick={() => void runAction(open.ref, 'close')}>Close</Button>
            <Button variant="advisory" onClick={() => void runAction(open.ref, 'act')}>Act</Button>
          </div>
        ) : undefined}>
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-14)' }}>
            <p>{open.body}</p>
            {open.recommendedAction && (
              <Field label="Recommended action"><p style={{ margin: 0 }}>{open.recommendedAction}</p></Field>
            )}
            {open.evidence?.window && (
              <p className="pillar__footnote">Window analysed: {dateTime(open.evidence.window.from)} → {dateTime(open.evidence.window.to)}. Confidence: {open.evidence.confidence != null ? `${Math.round(open.evidence.confidence * 100)}%` : 'not enough data'}.</p>
            )}
            {open.evidence?.factors && open.evidence.factors.length > 0 && (
              <div>
                <Field label="Contributing factors"><FactorBars factors={open.evidence.factors} /></Field>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
