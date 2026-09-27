/**
 * Intelligence — Pillar 4, business & data intelligence. docs/06 §7.
 *
 * Raw pass: the KPI library (a glossary with a current reading — formula and lineage
 * visible, not just a number) and the data-quality panel. The drag-and-drop report
 * builder and the full lineage graph from the spec are not built this pass; the KPI
 * registry already carries `formula` and `source_view`, which is most of what lineage
 * is for, stated plainly here rather than pretending a graph exists.
 */

import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, EmptyState, ErrorState, Skeleton, Chip, Meter } from '../../../shared/ui';
import { decimal2, relative } from '../../../lib/format';
import '../pillar.scss';

interface KpiRow {
  key: string; name: string; definition: string; formula: string; unit: string;
  direction: string; target: number | null; value: number | null; periodTo: string | null;
  sourceView: string; ownerRole: string | null;
}
interface DqRow { source: string; ranAt: string; rowsIn: number; score: number | null; results: Record<string, unknown> }

export function IntelligencePage() {
  const [kpis, setKpis] = useState<KpiRow[] | null>(null);
  const [dq, setDq] = useState<DqRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.kpiLibrary(), api.dataQuality()])
      .then(([k, d]) => { setKpis(k as unknown as KpiRow[]); setDq(d as unknown as DqRow[]); })
      .catch((e) => setError(e.message ?? 'Failed to load'));
  }, []);

  return (
    <div className="pillar">
      <div className="pillar__head">
        <h1 className="pillar__title"><Database aria-hidden /> Business &amp; data intelligence</h1>
      </div>
      <p className="pillar__sub">A glossary with a current reading, not a spreadsheet of unlabelled numbers — every KPI carries its formula and the view it is computed from.</p>

      {error && <ErrorState body={error} />}

      <div className="pillar__grid">
        <Card title="KPI library" className="pillar__span2" simulated>
          {!kpis ? <Skeleton height={260} /> : (
            <table className="pillar__table">
              <thead><tr><th>KPI</th><th>Formula</th><th>Current</th><th>Target</th><th>Owner</th></tr></thead>
              <tbody>
                {kpis.map((k) => (
                  <tr key={k.key} title={k.definition}>
                    <td>{k.name}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{k.formula}</td>
                    <td className="mono">{k.value != null ? decimal2(k.value) : '—'} {k.unit}</td>
                    <td className="mono">{k.target != null ? `${k.target} ${k.unit}` : '—'}</td>
                    <td>{k.ownerRole ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Data quality" subtitle="One row per source, most recent run">
          {!dq ? <Skeleton height={180} /> : dq.length === 0 ? <EmptyState title="No data-quality runs recorded" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-10)' }}>
              {dq.map((row) => (
                <div key={row.source}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{row.source}</span>
                    <Chip tone={row.score == null ? 'neutral' : row.score >= 80 ? 'success' : row.score >= 50 ? 'warning' : 'danger'}>{row.score ?? '—'}%</Chip>
                  </div>
                  {row.score != null && <Meter value={row.score / 100} />}
                  <div style={{ fontSize: 11, color: 'var(--app-text-faint)' }}>{row.rowsIn.toLocaleString()} rows · {relative(row.ranAt)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Report builder">
          <EmptyState title="Not built in this pass" body="The registry and every engine's EngineResult already carry everything a report needs (source, window, factors) — a drag-and-drop builder over them is additive, not structural." />
        </Card>
      </div>
    </div>
  );
}
