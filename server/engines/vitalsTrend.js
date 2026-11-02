/**
 * Vitals trend — what a run of heart-rate and SpO₂ readings DID, in the words a receiving
 * clinician uses.
 *
 * The citizen app's health monitor reads a wearable (or the demo sensor) and, when a reading
 * stays past a limit, sends the SOS by itself. Those readings travel with the SOS and keep
 * streaming while help is on the way (services/vitals.js). A list of numbers is no use to an
 * emergency department at 3 a.m.; the SHAPE is: how far the oxygen fell and how fast, how
 * high the heart rate went, how long each stayed out of range — and which moved first. A
 * desaturation that leads a tachycardia points at the lungs or the airway; a tachycardia that
 * leads a desaturation points at the heart. That ordering is the single most useful thing a
 * minutes-long trace can tell a hospital before the patient arrives.
 *
 * Deterministic, explainable, and honest about its source: these are consumer-wearable
 * readings, not a monitor's, and every result says so. It states patterns and what they are
 * consistent with; it never states a diagnosis.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'vitals-trend-v1';

/** Thresholds. Adult resting ranges; what counts as "out of range" for the summary. */
export const LIMITS = Object.freeze({
  tachy: 120, severeTachy: 150, brady: 50, severeBrady: 40,
  lowSpo2: 94, hypox: 90, severeHypox: 85,
});

/** A gap longer than this is not integrated across (the device dropped out). */
const MAX_STEP_MS = 15_000;

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const toMs = (ts) => (typeof ts === 'number' ? ts : Date.parse(ts));
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Seconds a value spent past a threshold (`above` true: > thr, false: < thr). */
function timePast(points, thr, above) {
  let ms = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt <= 0 || dt > MAX_STEP_MS) continue;
    const v = points[i - 1].v;
    if (above ? v > thr : v < thr) ms += dt;
  }
  return Math.round(ms / 1000);
}

/** The steepest change per minute over any window of 20–90 s (`sign` +1 rise, −1 fall). */
function steepest(points, sign) {
  let best = 0;
  let at = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j].t - points[i].t;
      if (dt < 20_000) continue;
      if (dt > 90_000) break;
      const rate = ((points[j].v - points[i].v) / dt) * 60_000 * sign;
      if (rate > best) { best = rate; at = points[j].t; }
    }
  }
  return { perMin: Math.round(best * 10) / 10, at };
}

function extreme(points, pickMax) {
  let e = null;
  for (const p of points) if (!e || (pickMax ? p.v > e.v : p.v < e.v)) e = p;
  return e;
}

/**
 * @param {Array<{ts: string|number, hr?: number|null, spo2?: number|null}>} series  oldest first
 * @param {{ device?: string|null, source?: string }} [opts]
 */
export function analyseVitals(series, { device = null, source = 'wearable' } = {}) {
  const pts = (series ?? [])
    .map((r) => ({ t: toMs(r.ts), hr: num(r.hr), spo2: num(r.spo2) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const window = {
    from: pts.length ? new Date(pts[0].t).toISOString() : new Date().toISOString(),
    to: pts.length ? new Date(pts[pts.length - 1].t).toISOString() : new Date().toISOString(),
  };
  const inputs = [{ source: `telemetry:${source}`, rows: pts.length }];
  if (pts.length < 3) {
    return insufficientData({ method: METHOD, window, inputs, reason: 'Fewer than three readings', minimum: 3, actual: pts.length });
  }

  const t0 = pts[0].t;
  const durationSec = Math.round((pts[pts.length - 1].t - t0) / 1000);
  const at = (t) => (t == null ? null : new Date(t).toISOString());
  const since = (t) => (t == null ? null : mmss((t - t0) / 1000));
  // The baseline is the start of the record: the first 20 % of it, at least 30 s.
  const baseEnd = t0 + Math.max(30_000, (pts[pts.length - 1].t - t0) * 0.2);

  const hr = pts.filter((p) => p.hr != null).map((p) => ({ t: p.t, v: p.hr }));
  const sp = pts.filter((p) => p.spo2 != null).map((p) => ({ t: p.t, v: p.spo2 }));

  const findings = [];
  const considerations = [];
  const prepare = new Set();

  // ── Heart rate ────────────────────────────────────────────────────────────
  let hrOut = null;
  let hrOnset = null;
  if (hr.length >= 3) {
    const base = median(hr.filter((p) => p.t <= baseEnd).map((p) => p.v)) ?? hr[0].v;
    const hi = extreme(hr, true);
    const lo = extreme(hr, false);
    const rise = steepest(hr, 1);
    hrOut = {
      baseline: base, latest: hr[hr.length - 1].v, min: lo.v, minAt: at(lo.t), max: hi.v, maxAt: at(hi.t),
      above120Sec: timePast(hr, LIMITS.tachy, true), above150Sec: timePast(hr, LIMITS.severeTachy, true),
      below50Sec: timePast(hr, LIMITS.brady, false), maxRisePerMin: rise.perMin,
    };
    hrOnset = hr.find((p) => p.v >= Math.max(base + 20, 110) || p.v <= LIMITS.brady)?.t ?? null;
    const climb = hi.v - base;
    if (hi.v >= LIMITS.severeTachy) {
      findings.push({ key: 'hr', tone: 'bad', text: `Marked tachycardia: heart rate rose from ${base} to ${hi.v} bpm (peak at +${since(hi.t)}), above 150 bpm for ${mmss(hrOut.above150Sec)} and above 120 bpm for ${mmss(hrOut.above120Sec)}. Steepest climb ${rise.perMin} bpm/min.` });
    } else if (hi.v >= LIMITS.tachy) {
      findings.push({ key: 'hr', tone: 'warn', text: `Tachycardia: heart rate rose from ${base} to ${hi.v} bpm, above 120 bpm for ${mmss(hrOut.above120Sec)}.` });
    } else if (climb >= 25) {
      findings.push({ key: 'hr', tone: 'warn', text: `Heart rate climbed ${climb} bpm, from ${base} to ${hi.v} bpm, while staying under 120.` });
    }
    if (lo.v <= LIMITS.severeBrady) {
      findings.push({ key: 'hr-low', tone: 'bad', text: `Severe bradycardia: heart rate fell to ${lo.v} bpm (at +${since(lo.t)}), below 50 bpm for ${mmss(hrOut.below50Sec)}.` });
    } else if (lo.v <= LIMITS.brady) {
      findings.push({ key: 'hr-low', tone: 'warn', text: `Bradycardia: heart rate fell to ${lo.v} bpm, below 50 bpm for ${mmss(hrOut.below50Sec)}.` });
    }
    if (!findings.some((f) => f.key.startsWith('hr'))) {
      findings.push({ key: 'hr', tone: 'good', text: `Heart rate stayed between ${lo.v} and ${hi.v} bpm (baseline ${base}).` });
    }
  }

  // ── Oxygen saturation ─────────────────────────────────────────────────────
  let spOut = null;
  let spOnset = null;
  if (sp.length >= 3) {
    const base = median(sp.filter((p) => p.t <= baseEnd).map((p) => p.v)) ?? sp[0].v;
    const lo = extreme(sp, false);
    const fall = steepest(sp, -1);
    spOut = {
      baseline: base, latest: sp[sp.length - 1].v, min: lo.v, minAt: at(lo.t),
      below94Sec: timePast(sp, LIMITS.lowSpo2, false), below90Sec: timePast(sp, LIMITS.hypox, false),
      below85Sec: timePast(sp, LIMITS.severeHypox, false), maxFallPerMin: fall.perMin,
    };
    spOnset = sp.find((p) => p.v <= Math.min(base - 3, 93))?.t ?? null;
    const over = spOnset != null ? mmss((lo.t - spOnset) / 1000) : null;
    if (lo.v < LIMITS.severeHypox) {
      findings.push({ key: 'spo2', tone: 'bad', text: `Severe desaturation: SpO₂ fell from ${base}% to ${lo.v}% (lowest at +${since(lo.t)}${over ? `, ${over} after it began to fall` : ''}), below 90% for ${mmss(spOut.below90Sec)}. Steepest fall ${fall.perMin} %/min.` });
    } else if (lo.v < LIMITS.hypox) {
      findings.push({ key: 'spo2', tone: 'bad', text: `Hypoxaemia: SpO₂ fell from ${base}% to ${lo.v}%, below 90% for ${mmss(spOut.below90Sec)}. Steepest fall ${fall.perMin} %/min.` });
    } else if (lo.v < LIMITS.lowSpo2) {
      findings.push({ key: 'spo2', tone: 'warn', text: `SpO₂ dipped from ${base}% to ${lo.v}%, below 94% for ${mmss(spOut.below94Sec)}.` });
    } else {
      findings.push({ key: 'spo2', tone: 'good', text: `SpO₂ held at ${lo.v}–${Math.max(...sp.map((p) => p.v))}% throughout.` });
    }
    if (fall.perMin >= 4) {
      considerations.push(`Abrupt desaturation (${fall.perMin} %/min at its steepest) — consider acute airway obstruction, aspiration or pulmonary embolism; rule out a probe artefact.`);
    }
  }

  // ── Which moved first ─────────────────────────────────────────────────────
  let sequence = { first: null, leadSec: null, text: null };
  if (hrOnset != null && spOnset != null) {
    const lead = Math.round((hrOnset - spOnset) / 1000);
    if (lead > 10) {
      sequence = { first: 'spo2', leadSec: lead, text: `Oxygen fell first: SpO₂ was dropping ${mmss(lead)} before the heart rate rose. That order fits a respiratory or airway cause driving a compensatory tachycardia.` };
    } else if (lead < -10) {
      sequence = { first: 'hr', leadSec: -lead, text: `The heart rate rose first: ${mmss(-lead)} before SpO₂ began to fall. That order fits a primary cardiac or circulatory cause (arrhythmia, poor output) better than a respiratory one.` };
    } else {
      sequence = { first: 'together', leadSec: Math.abs(lead), text: 'Heart rate and SpO₂ changed together, within ten seconds of each other.' };
    }
    findings.push({ key: 'sequence', tone: 'info', text: sequence.text });
  }

  // ── What it is consistent with, and what to have ready ─────────────────────
  const hypox = spOut && spOut.min < LIMITS.hypox;
  const tachy = hrOut && hrOut.max >= LIMITS.tachy;
  const brady = hrOut && hrOut.min <= LIMITS.brady;
  if (hypox) { prepare.add('Supplemental oxygen and airway support'); prepare.add('Resuscitation bay'); }
  if (hypox && tachy) considerations.push('Hypoxaemia with tachycardia — assess airway and breathing first; consider asthma/COPD exacerbation, pneumonia, pulmonary embolism or anaphylaxis.');
  if (tachy && !hypox && hrOut.max >= LIMITS.severeTachy) {
    considerations.push('Fast heart rate without low oxygen — consider an arrhythmia (SVT, AF with rapid ventricular response); a 12-lead ECG on arrival.');
    prepare.add('12-lead ECG on arrival');
  }
  if (brady && hypox) {
    considerations.push('Slow heart rate with low oxygen is a peri-arrest pattern — prepare for resuscitation.');
    prepare.add('Resuscitation team on standby');
  }
  if (sequence.first === 'hr' && tachy) prepare.add('12-lead ECG on arrival');
  if (!hypox && !tachy && !brady) considerations.push('No sustained abnormality in heart rate or SpO₂ over this record.');

  // ── Data quality ──────────────────────────────────────────────────────────
  let gaps = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].t - pts[i - 1].t > MAX_STEP_MS) gaps++;
  const coverage = Math.min(1, pts.length / Math.max(1, durationSec / 2));
  const confidence = Math.round(Math.max(0.2, Math.min(1, (pts.length / 60) * 0.6 + coverage * 0.4) - Math.min(0.3, gaps * 0.05)) * 100) / 100;

  const headline = [
    spOut ? (spOut.min < spOut.baseline - 2 ? `SpO₂ ${spOut.baseline}→${spOut.min}%` : `SpO₂ ${spOut.min}–${spOut.baseline}%`) : null,
    hrOut ? (hrOut.max > hrOut.baseline + 10 ? `HR ${hrOut.baseline}→${hrOut.max} bpm` : `HR ${hrOut.min}–${hrOut.max} bpm`) : null,
    `over ${mmss(durationSec)}`,
    sequence.first === 'spo2' ? 'oxygen fell first' : sequence.first === 'hr' ? 'heart rate rose first' : null,
  ].filter(Boolean).join(' · ');

  return engineResult({
    value: {
      window: { ...window, durationSec },
      samples: pts.length, gaps, device,
      hr: hrOut, spo2: spOut, sequence,
      findings, considerations, prepare: [...prepare], headline,
      severity: findings.some((f) => f.tone === 'bad') ? 'bad' : findings.some((f) => f.tone === 'warn') ? 'warn' : 'good',
    },
    method: METHOD,
    window,
    inputs,
    confidence,
    factors: [
      ...(spOut ? [{ name: 'Lowest SpO₂', contribution: Math.max(0, spOut.baseline - spOut.min) / 20, direction: 'down', detail: `${spOut.min}%` }] : []),
      ...(hrOut ? [{ name: 'Peak heart rate', contribution: Math.max(0, hrOut.max - hrOut.baseline) / 100, direction: 'up', detail: `${hrOut.max} bpm` }] : []),
    ],
    caveats: [
      `Consumer wearable readings${device ? ` (${device})` : ''} — not a medical-grade monitor. For context and triage only; not a diagnosis.`,
      ...(gaps ? [`${gaps} gap${gaps > 1 ? 's' : ''} longer than 15 s in the record.`] : []),
    ],
  });
}
