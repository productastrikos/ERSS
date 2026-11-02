/**
 * Intelligence — Pillar 4, business & data intelligence. docs/06 §7.
 *
 * Raw pass: the KPI library (a glossary with a current reading — formula and lineage
 * visible, not just a number) and the data-quality panel. The KPI registry carries
 * `formula` and `source_view`, which is most of what lineage is for, so the library shows
 * both beside the reading rather than pretending a lineage graph exists.
 */

import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, EmptyState, ErrorState, Skeleton, Chip, Dot, Meter } from '../../../shared/ui';
import { durationWithUnit, pct, relative } from '../../../lib/format';
import '../pillar.scss';

interface KpiRow {
  key: string; name: string; definition: string; formula: string; unit: string;
  direction: string; target: number | null; warnAt: number | null; breachAt: number | null;
  value: number | null; periodTo: string | null; window?: string;
  sourceView: string; ownerRole: string | null;
}
interface DqRow {
  source: string; ranAt: string; rowsIn: number; score: number | null;
  results: { latestAt?: string | null; stale?: boolean; note?: string } & Record<string, unknown>;
}

/** A KPI value in the unit people read it in: 327.5 seconds is "5:28 min". */
function kpiValue(value: number | null, unit: string): string {
  if (value == null) return '—';
  if (unit === 'seconds') return durationWithUnit(value);
  if (unit === 'percent') return pct(value, 1);
  return `${value} ${unit}`;
}

/** Where a reading sits against its target, its warning line and its breach line. */
function kpiTone(k: KpiRow): 'success' | 'warning' | 'danger' | 'neutral' {
  if (k.value == null || k.target == null) return 'neutral';
  const lower = k.direction === 'lower_better';
  const worse = (a: number, b: number) => (lower ? a > b : a < b);
  if (k.breachAt != null && worse(k.value, k.breachAt)) return 'danger';
  if (k.warnAt != null && worse(k.value, k.warnAt)) return 'warning';
  if (worse(k.value, k.target)) return 'warning';
  return 'success';
}

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
        <Card title="KPI library" subtitle="Current reading over the trailing 30 days, from the view named beside it" className="pillar__span2" simulated>
          {!kpis ? <Skeleton height={260} /> : (
            <table className="pillar__table">
              <thead><tr><th>KPI</th><th>Formula</th><th>Source</th><th>Current</th><th>Target</th><th>Owner</th></tr></thead>
              <tbody>
                {kpis.map((k) => {
                  const tone = kpiTone(k);
                  return (
                    <tr key={k.key} title={k.definition}>
                      <td>{k.name}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{k.formula}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{k.sourceView}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {tone !== 'neutral' && <><Dot tone={tone} title={tone === 'success' ? 'On target' : tone === 'warning' ? 'Off target' : 'Past the breach line'} />{' '}</>}
                        {kpiValue(k.value, k.unit)}
                      </td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{k.target != null ? kpiValue(k.target, k.unit) : '—'}</td>
                      <td>{k.ownerRole ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Data quality" subtitle="Every source profiled now — completeness, validity, duplicates and how recent the newest record is">
          {!dq ? <Skeleton height={180} /> : dq.length === 0 ? <EmptyState title="No data-quality runs recorded" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-10)' }}>
              {dq.map((row) => (
                <div key={row.source}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
                    <span>{row.source}</span>
                    <span style={{ display: 'flex', gap: 'var(--sp-6)' }}>
                      {row.results.stale && <Chip tone="danger">stale</Chip>}
                      <Chip tone={row.score == null ? 'neutral' : row.score >= 80 ? 'success' : row.score >= 50 ? 'warning' : 'danger'}>{row.score ?? '—'}%</Chip>
                    </span>
                  </div>
                  {row.score != null && <Meter value={row.score / 100} />}
                  <div style={{ fontSize: 11, color: 'var(--app-text-faint)' }}>
                    {row.rowsIn.toLocaleString()} rows checked
                    {row.results.latestAt ? ` · newest record ${relative(row.results.latestAt)}` : ' · reference data'}
                  </div>
                  {row.results.note && <div style={{ fontSize: 11, color: 'var(--app-text-faint)', marginTop: 'var(--sp-4)' }}>{row.results.note}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
