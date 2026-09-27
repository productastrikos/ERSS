/**
 * Intelligence-engine reports — the service layer that fetches for engines/ and returns
 * their EngineResult envelopes. docs/08.
 */

import { pool } from '../lib/db.js';
import { stageRows, baselineStageRows, stageTrendRows, HOUR_BANDS } from '../repos/analytics.js';
import { decomposeStages } from '../engines/responseTime.js';
import { buildFilter, summarise } from '../lib/filters.js';
import { forecastLabelled, nextDay } from '../lib/forecast.js';

const num = (v) => (v == null ? null : Math.round(Number(v)));

/**
 * The console used to send one-at-a-time keys (`zoneRef`, `sectorRef`, `incidentKind`,
 * `agencyCode`, `hourBand`). They are folded into the universal filter so both spellings
 * reach the same SQL and an old deep link keeps working.
 *
 * `priority` and `unitKind` are NOT here: those names belong to the universal filter, which
 * already parses them as lists, so there is nothing to translate.
 */
export function foldLegacyKeys(filters = {}, legacy = {}) {
  const out = { ...filters };
  const push = (key, value) => {
    if (value == null || value === '') return;
    out[key] = [...new Set([...(out[key] ?? []), value])];
  };
  push('zone', legacy.zoneRef);
  push('zone', legacy.sectorRef);
  push('kind', legacy.incidentKind);
  push('agency', legacy.agencyCode);
  if (legacy.hourBand && HOUR_BANDS[legacy.hourBand]) {
    const [from, to] = HOUR_BANDS[legacy.hourBand];
    if (out.hourFrom == null) out.hourFrom = from;
    if (out.hourTo == null) out.hourTo = to;
  }
  return out;
}

/**
 * Stage decomposition for a filter, with a biggest-contributor comparison against the
 * emirate-wide population for the same window and hour band. docs/08 §2.1.
 *
 * Also returns the daily trend of every stage and a seven-day-seasonal forecast of each —
 * so "where do the minutes go" and "where are they going" are answered on one screen.
 */
export async function responseTimeReport({ filters = {}, defaultDays = 30, ahead = 7 } = {}) {
  const f = buildFilter(filters, { source: 'response', window: { days: defaultDays } });
  const window = {
    from: filters.from ?? new Date(Date.now() - defaultDays * 86_400_000).toISOString(),
    to: filters.to ?? new Date().toISOString(),
  };

  const [rows, baseline, trendRaw] = await Promise.all([
    stageRows(pool, { filters, defaultDays }),
    baselineStageRows(pool, { filters, defaultDays }),
    stageTrendRows(pool, { filters, defaultDays }),
  ]);

  const out = decomposeStages(rows, baseline, window);

  const STAGES = [
    ['response', 'Response'],
    ['call_handling', 'Call handling'],
    ['dispatch', 'Dispatch decision'],
    ['acknowledge', 'Acknowledge'],
    ['turnout', 'Turnout'],
    ['travel', 'En-route travel'],
    ['vertical', 'Vertical access'],
  ];
  const trend = trendRaw.map((r) => {
    const row = { day: r.day, n: r.n };
    for (const [key] of STAGES) row[key] = num(r[key]);
    return row;
  });

  const forecast = {};
  for (const [key, label] of STAGES) {
    const series = trend.filter((r) => r[key] != null);
    const fc = forecastLabelled(series, {
      labelKey: 'day', valueKey: key, nextLabel: nextDay, horizon: ahead, season: 7, integer: true,
    });
    forecast[key] = {
      label,
      points: fc.points.map((p) => ({ day: p.day, value: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
      method: fc.method, mae: fc.mae, mape: fc.mape, coverage80Pct: fc.coverage80Pct, caveats: fc.caveats,
    };
  }

  return {
    ...out,
    filters: { describe: f.describe, active: f.active, summary: summarise(f.describe) },
    sampleN: rows.length,
    baselineN: baseline.length,
    trend,
    forecast,
  };
}
