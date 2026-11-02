/**
 * The report as an Excel workbook, in the DCAS brand.
 *
 *   Report      the document itself, laid out to read and to print: the client's lockup,
 *               the red-to-blue band, a brand-blue bar per section, labelled facts, styled
 *               tables, tone-coloured findings, the vitals chart as an image. A4 portrait,
 *               fitted to the page width, with a footer naming the organisation and the page.
 *   data sheets the raw rows behind it (timeline, vitals, the AI's ranking…), one per sheet,
 *               header frozen and filterable — the part an analyst actually works with.
 *
 * Lato is named as the font, as the brand asks; a machine without it shows Excel's default,
 * which changes the face and nothing else. Loaded on demand — exceljs is not in the app's
 * first load.
 */

import type { Workbook, Worksheet, Fill, Font, Borders } from 'exceljs';
import { docPalette, logoImage, mix, type DocPalette } from './brand';
import { vitalsChartPng } from './chart';
import type { DocColumn, DocSection, ReportDoc, Tone } from './doc';

const COLS = 8;
const WIDTHS = [26, 15, 15, 15, 14, 14, 14, 16];
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

export async function renderXlsx(doc: ReportDoc): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const pal = docPalette();
  const logo = await logoImage();
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'Dubai Corporation for Ambulance Services — ERSS';
  wb.title = doc.title;
  wb.subject = doc.eyebrow;
  wb.created = new Date(doc.generatedAt);

  const ws = wb.addWorksheet('Report', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 } },
    headerFooter: {
      oddFooter: `&L&8&"Lato,Bold"Dubai Corporation for Ambulance Services&"Lato,Regular" · ERSS${doc.confidential ? ' · CONFIDENTIAL — patient information' : ''}&R&8Page &P of &N`,
    },
  });
  ws.columns = WIDTHS.map((width) => ({ width }));
  const S = styles(pal);
  let r = 1;

  // ── Head: lockup, classification, the brand band, title ──────────────────
  ws.getRow(r).height = 46;
  if (logo) {
    const id = wb.addImage({ base64: logo.url, extension: 'png' });
    ws.addImage(id, { tl: { col: 0.15, row: 0.2 }, ext: { width: 250, height: (250 * logo.height) / logo.width } });
  }
  if (doc.classification) {
    ws.mergeCells(r, 5, r, COLS);
    const c = ws.getCell(r, 5);
    c.value = doc.classification.toUpperCase();
    c.font = { name: 'Lato', size: 8, bold: true, color: { argb: argb(pal.bad) } };
    c.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }
  r++;
  ws.getRow(r).height = 5;
  for (let c = 1; c <= COLS; c++) ws.getCell(r, c).fill = solid(mix(pal.red, pal.blue, (c - 1) / (COLS - 1)));
  r++;
  line(ws, r, doc.eyebrow.toUpperCase(), { name: 'Lato', size: 8, bold: true, color: { argb: argb(pal.red) } }, 16);
  r++;
  line(ws, r, doc.title, { name: 'Lexend Deca', size: 16, bold: true, color: { argb: argb(pal.blue) } }, 26);
  r++;
  line(ws, r, doc.subtitle, { name: 'Lato', size: 10, color: { argb: argb(pal.muted) } }, 17);
  r++;
  const generated = new Date(doc.generatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
  line(ws, r, `${doc.ref ? `${doc.ref} · ` : ''}Generated ${generated} GST${doc.generatedBy ? ` by ${doc.generatedBy}` : ''}`, { name: 'Lato', size: 9, italic: true, color: { argb: argb(pal.faint) } }, 15);
  r += 2;

  // ── Sections ──────────────────────────────────────────────────────────────
  const sectionBar = (title: string) => {
    ws.mergeCells(r, 1, r, COLS);
    const c = ws.getCell(r, 1);
    c.value = title;
    c.font = { name: 'Lexend Deca', size: 11, bold: true, color: { argb: argb(pal.paper) } };
    c.fill = solid(pal.blue);
    c.alignment = { vertical: 'middle', indent: 1 };
    c.border = { left: { style: 'thick', color: { argb: argb(pal.red) } } };
    ws.getRow(r).height = 21;
    r++;
  };
  const textRow = (text: string, font: Partial<Font>, fill?: Fill) => {
    ws.mergeCells(r, 1, r, COLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = font;
    c.alignment = { wrapText: true, vertical: 'top', indent: 1 };
    if (fill) c.fill = fill;
    ws.getRow(r).height = heightFor(text, 125, 14.5);
    r++;
  };
  const toneHex = (t: Tone | null | undefined) => (t === 'good' ? pal.good : t === 'warn' ? pal.warn : t === 'bad' ? pal.bad : t === 'ai' ? pal.ai : pal.blue);

  const render: Record<DocSection['kind'], (s: DocSection) => void> = {
    text: (s) => {
      const t = s as Extract<DocSection, { kind: 'text' }>;
      if (!t.text.trim()) return;
      sectionBar(t.title);
      for (const para of t.text.split('\n').filter((x) => x.trim())) textRow(para, S.body);
    },
    facts: (s) => {
      const f = s as Extract<DocSection, { kind: 'facts' }>;
      if (!f.facts.length) return;
      sectionBar(f.title);
      for (const x of f.facts) {
        const label = ws.getCell(r, 1);
        label.value = x.label;
        label.font = S.label;
        label.fill = solid(pal.labelBg);
        label.alignment = { vertical: 'top', wrapText: true, indent: 1 };
        label.border = S.border;
        ws.mergeCells(r, 2, r, COLS);
        const v = ws.getCell(r, 2);
        v.value = x.value;
        v.font = x.tone ? { ...S.body, bold: true, color: { argb: argb(toneHex(x.tone)) } } : S.body;
        v.alignment = { vertical: 'top', wrapText: true, indent: 1 };
        v.border = S.border;
        ws.getRow(r).height = Math.max(heightFor(x.label, 26, 14.5), heightFor(x.value, 100, 14.5));
        r++;
      }
    },
    table: (s) => {
      const t = s as Extract<DocSection, { kind: 'table' }>;
      sectionBar(t.title);
      if (!t.rows.length) { textRow('No rows.', S.faint); return; }
      const spans = spread(t.columns);
      spans.forEach(([from, to], i) => {
        if (to > from) ws.mergeCells(r, from, r, to);
        const c = ws.getCell(r, from);
        c.value = t.columns[i].label;
        c.font = S.head;
        c.fill = solid(pal.blueTint);
        c.alignment = { vertical: 'middle', horizontal: t.columns[i].align ?? 'left', wrapText: true };
        c.border = S.border;
      });
      ws.getRow(r).height = 19;
      r++;
      t.rows.forEach((row, k) => {
        let h = 15;
        spans.forEach(([from, to], i) => {
          if (to > from) ws.mergeCells(r, from, r, to);
          const c = ws.getCell(r, from);
          const value = row[t.columns[i].key];
          c.value = value ?? '';
          c.font = i === 0 && t.tones?.[k] ? { ...S.body, bold: true, color: { argb: argb(toneHex(t.tones[k])) } } : S.body;
          c.alignment = { vertical: 'top', wrapText: true, horizontal: t.columns[i].align ?? 'left' };
          c.border = S.border;
          if (k % 2) c.fill = solid(pal.zebra);
          const chars = WIDTHS.slice(from - 1, to).reduce((a, b) => a + b, 0) * 1.15;
          h = Math.max(h, heightFor(String(value ?? ''), chars, 14.5));
        });
        ws.getRow(r).height = h;
        r++;
      });
      if (t.note) textRow(t.note, S.faint);
    },
    findings: (s) => {
      const f = s as Extract<DocSection, { kind: 'findings' }>;
      if (!f.items.length) return;
      sectionBar(f.title);
      for (const x of f.items) {
        const tag = ws.getCell(r, 1);
        tag.value = (x.label ?? x.tone).toUpperCase();
        tag.font = { name: 'Lato', size: 8, bold: true, color: { argb: argb(pal.paper) } };
        tag.fill = solid(toneHex(x.tone));
        tag.alignment = { horizontal: 'center', vertical: 'middle' };
        tag.border = S.border;
        ws.mergeCells(r, 2, r, COLS);
        const v = ws.getCell(r, 2);
        v.value = { richText: [{ text: x.title, font: { ...S.body, bold: true } }, ...(x.detail ? [{ text: `\n${x.detail}`, font: S.muted }] : [])] };
        v.alignment = { wrapText: true, vertical: 'top', indent: 1 };
        v.border = S.border;
        ws.getRow(r).height = heightFor(`${x.title}${x.detail ? `\n${x.detail}` : ''}`, 100, 14.5);
        r++;
      }
    },
    chart: (s) => {
      const c = s as Extract<DocSection, { kind: 'chart' }>;
      const png = vitalsChartPng(c.series, pal, { width: 1600, height: 560 });
      if (!png) return;
      sectionBar(c.title);
      const id = wb.addImage({ base64: png, extension: 'png' });
      const rows = 16;
      for (let k = 0; k < rows; k++) ws.getRow(r + k).height = 15;
      ws.addImage(id, { tl: { col: 0.1, row: r - 1 + 0.2 }, ext: { width: 760, height: 266 } });
      r += rows + 1;
      if (c.caption) textRow(c.caption, S.faint);
    },
    list: (s) => {
      const l = s as Extract<DocSection, { kind: 'list' }>;
      if (!l.items.length) return;
      sectionBar(l.title);
      for (const item of l.items) textRow(`•  ${item}`, S.body);
      if (l.note) textRow(l.note, S.faint);
    },
  };
  for (const s of doc.sections) { render[s.kind](s); r++; }

  // ── Data sheets ───────────────────────────────────────────────────────────
  const tables = doc.sections.filter((s): s is Extract<DocSection, { kind: 'table' }> => s.kind === 'table');
  const sheets = doc.kind === 'table' && tables[0]
    ? [{ name: 'Data', columns: tables[0].columns, rows: tables[0].rows }, ...doc.sheets]
    : doc.sheets;
  for (const sheet of sheets) dataSheet(wb, sheet.name, sheet.columns, sheet.rows, pal, S);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function styles(pal: DocPalette) {
  const thin = { style: 'thin' as const, color: { argb: argb(pal.rule) } };
  return {
    body: { name: 'Lato', size: 10, color: { argb: argb(pal.ink) } } as Partial<Font>,
    muted: { name: 'Lato', size: 9.5, color: { argb: argb(pal.muted) } } as Partial<Font>,
    faint: { name: 'Lato', size: 8.5, italic: true, color: { argb: argb(pal.faint) } } as Partial<Font>,
    label: { name: 'Lato', size: 9.5, bold: true, color: { argb: argb(pal.muted) } } as Partial<Font>,
    head: { name: 'Lato', size: 9.5, bold: true, color: { argb: argb(pal.blue) } } as Partial<Font>,
    border: { top: thin, left: thin, bottom: thin, right: thin } as Partial<Borders>,
  };
}

function solid(hex: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } };
}

function line(ws: Worksheet, r: number, text: string, font: Partial<Font>, height: number) {
  ws.mergeCells(r, 1, r, COLS);
  const c = ws.getCell(r, 1);
  c.value = text;
  c.font = font;
  c.alignment = { vertical: 'middle' };
  ws.getRow(r).height = height;
}

/** A row height that fits `text` wrapped at about `chars` characters a line. */
function heightFor(text: string, chars: number, lineH: number): number {
  const lines = text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(8, chars))), 0);
  return Math.min(409, Math.max(lineH + 3, lines * lineH + 4));
}

/** Spread a table's columns over the sheet's eight, wider columns taking more. */
function spread(columns: DocColumn[]): Array<[number, number]> {
  if (columns.length >= COLS) return columns.map((_, i) => [i + 1, i + 1]);
  const total = columns.reduce((a, c) => a + (c.width ?? 1), 0);
  let next = 1;
  return columns.map((c, i) => {
    const left = columns.length - i - 1;
    const want = Math.max(1, Math.round(((c.width ?? 1) / total) * COLS));
    const span = Math.min(want, COLS - next + 1 - left);
    const out: [number, number] = [next, i === columns.length - 1 ? COLS : next + span - 1];
    next = out[1] + 1;
    return out;
  });
}

function dataSheet(wb: Workbook, name: string, columns: DocColumn[], rows: Array<Record<string, string | number | null>>, pal: DocPalette, S: ReturnType<typeof styles>) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = columns.map((c) => ({ key: c.key, width: Math.min(70, Math.max(12, c.label.length + 4, ...rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2))) }));
  ws.mergeCells(1, 1, 1, Math.max(1, columns.length));
  const t = ws.getCell(1, 1);
  t.value = `${name} — Dubai Corporation for Ambulance Services · ERSS`;
  t.font = { name: 'Lexend Deca', size: 11, bold: true, color: { argb: argb(pal.paper) } };
  t.fill = solid(pal.blue);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 22;
  const head = ws.getRow(2);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.label;
    cell.font = S.head;
    cell.fill = solid(pal.blueTint);
    cell.border = S.border;
    cell.alignment = { horizontal: c.align ?? 'left', vertical: 'middle' };
  });
  head.height = 19;
  rows.forEach((row, k) => {
    const rr = ws.getRow(k + 3);
    columns.forEach((c, i) => {
      const cell = rr.getCell(i + 1);
      cell.value = row[c.key] ?? null;
      cell.font = S.body;
      cell.border = S.border;
      cell.alignment = { horizontal: c.align ?? 'left', vertical: 'top', wrapText: true };
      if (k % 2) cell.fill = solid(pal.zebra);
    });
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: Math.max(1, columns.length) } };
}
