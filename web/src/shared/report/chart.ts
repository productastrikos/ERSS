/**
 * The vitals chart for documents — heart rate (left axis, DCAS red) and SpO₂ (right axis,
 * DCAS blue) against minutes from the first reading, with the out-of-range bands shaded so a
 * reader sees "how long, how far" before reading a number. Drawn once on a canvas and used
 * as a PNG by all three outputs: the preview, the PDF and the Excel workbook.
 */

import type { VitalsPoint } from '../../lib/types';
import { rgb, type DocPalette } from './brand';

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const alpha = (hex: string, a: number) => { const [r, g, b] = rgb(hex); return `rgb(${r} ${g} ${b} / ${a})`; };

export function vitalsChartPng(series: VitalsPoint[], pal: DocPalette, { width = 1600, height = 560 } = {}): string | null {
  const pts = series.map((s) => ({ t: Date.parse(s.ts), hr: s.hr, spo2: s.spo2 })).filter((p) => Number.isFinite(p.t));
  if (pts.length < 2) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const pad = { l: 92, r: 92, t: 54, b: 66 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 60_000);
  const hrs = pts.map((p) => p.hr).filter((v): v is number => v != null);
  const sps = pts.map((p) => p.spo2).filter((v): v is number => v != null);
  const hrLo = Math.min(40, ...hrs.map((v) => Math.floor(v / 10) * 10 - 10));
  const hrHi = Math.max(160, ...hrs.map((v) => Math.ceil(v / 10) * 10 + 10));
  const spLo = Math.min(80, ...sps.map((v) => Math.floor(v / 5) * 5 - 5));
  const spHi = 100;
  const X = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * W;
  const Yh = (v: number) => pad.t + (1 - (v - hrLo) / (hrHi - hrLo)) * H;
  const Ys = (v: number) => pad.t + (1 - (v - spLo) / (spHi - spLo)) * H;

  g.fillStyle = pal.paper;
  g.fillRect(0, 0, width, height);

  // Out-of-range bands: SpO₂ below 90, heart rate above 120.
  g.fillStyle = alpha(pal.chartSpo2, 0.08);
  g.fillRect(pad.l, Ys(90), W, Ys(spLo) - Ys(90));
  g.fillStyle = alpha(pal.chartHr, 0.07);
  g.fillRect(pad.l, Yh(hrHi), W, Yh(120) - Yh(hrHi));

  // Grid and axes.
  g.strokeStyle = pal.rule;
  g.lineWidth = 1.5;
  g.font = '600 22px Lato, sans-serif';
  g.textBaseline = 'middle';
  for (let v = hrLo; v <= hrHi; v += 20) {
    const y = Yh(v);
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(pad.l + W, y); g.stroke();
    g.fillStyle = pal.chartHr; g.textAlign = 'right'; g.fillText(String(v), pad.l - 14, y);
  }
  for (let v = spLo; v <= spHi; v += 5) {
    g.fillStyle = pal.chartSpo2; g.textAlign = 'left'; g.fillText(`${v}%`, pad.l + W + 14, Ys(v));
  }
  const span = (t1 - t0) / 1000;
  const step = span > 1200 ? 300 : span > 600 ? 120 : span > 240 ? 60 : 30;
  g.fillStyle = pal.muted; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let s = 0; s <= span + 0.5; s += step) {
    const x = X(t0 + s * 1000);
    g.strokeStyle = pal.rule; g.beginPath(); g.moveTo(x, pad.t + H); g.lineTo(x, pad.t + H + 8); g.stroke();
    g.fillText(fmt(s), x, pad.t + H + 14);
  }
  g.strokeStyle = pal.faint; g.lineWidth = 2;
  g.strokeRect(pad.l, pad.t, W, H);

  // Threshold lines.
  g.setLineDash([10, 8]); g.lineWidth = 2;
  g.strokeStyle = alpha(pal.chartSpo2, 0.55); g.beginPath(); g.moveTo(pad.l, Ys(90)); g.lineTo(pad.l + W, Ys(90)); g.stroke();
  g.strokeStyle = alpha(pal.chartHr, 0.5); g.beginPath(); g.moveTo(pad.l, Yh(120)); g.lineTo(pad.l + W, Yh(120)); g.stroke();
  g.setLineDash([]);

  const line = (key: 'hr' | 'spo2', colour: string, Y: (v: number) => number) => {
    g.strokeStyle = colour; g.lineWidth = 4.5; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    let open = false;
    let last = -Infinity;
    for (const p of pts) {
      const v = p[key];
      if (v == null || p.t - last > 15_000) open = false;
      if (v == null) continue;
      if (!open) { g.moveTo(X(p.t), Y(v)); open = true; } else g.lineTo(X(p.t), Y(v));
      last = p.t;
    }
    g.stroke();
  };
  line('spo2', pal.chartSpo2, Ys);
  line('hr', pal.chartHr, Yh);

  // Legend and axis titles.
  g.textBaseline = 'middle'; g.font = '800 23px Lato, sans-serif';
  const legend = (x: number, colour: string, text: string) => {
    g.fillStyle = colour; g.fillRect(x, 20, 34, 7);
    g.fillStyle = pal.ink; g.textAlign = 'left'; g.fillText(text, x + 44, 24);
  };
  legend(pad.l, pal.chartHr, 'Heart rate (bpm) — left axis');
  legend(pad.l + 470, pal.chartSpo2, 'SpO₂ (%) — right axis');
  g.font = '600 20px Lato, sans-serif'; g.fillStyle = pal.muted; g.textAlign = 'right';
  g.fillText('minutes from first reading', pad.l + W, height - 16);
  return canvas.toDataURL('image/png');
}
