/**
 * The report as a PDF — A4, in the DCAS brand: the red-to-blue sweep across the head, the
 * client's lockup, Lexend Deca headings over Lato text, brand-blue table heads, and a footer
 * on every page saying whose document it is, what it contains and which page this is.
 *
 * Vector text (selectable, searchable, crisp at any zoom) from the document model in doc.ts;
 * the vitals chart is the one image. Loaded on demand — jsPDF is not in the app's first load.
 */

import type { jsPDF as JsPdf } from 'jspdf';
import { docPalette, logoImage, mix, pdfFonts, rgb, type DocPalette } from './brand';
import { vitalsChartPng } from './chart';
import type { DocSection, ReportDoc, Tone } from './doc';

const PAGE = { w: 210, h: 297, m: 14 };
const CONTENT_W = PAGE.w - PAGE.m * 2;
const TOP_FIRST = 47;
const TOP_NEXT = 22;
const BOTTOM = 20;

/** The brand faces lack a few glyphs a report uses; say the same thing in ones they have. */
const safe = (s: string | number | null | undefined) => String(s ?? '')
  .replace(/₂/g, '2').replace(/\s*→\s*/g, ' to ').replace(/[↑]/g, 'up').replace(/[↓]/g, 'down').replace(/✓/g, 'Yes');

export async function renderPdf(doc: ReportDoc): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pal = docPalette();
  const [logo, fonts] = await Promise.all([logoImage(), pdfFonts()]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: safe(doc.title), subject: safe(doc.eyebrow), author: 'Dubai Corporation for Ambulance Services — ERSS', creator: 'ERSS Dubai' });

  const F = fonts ? { body: 'Lato', display: 'LexendDeca' } : { body: 'helvetica', display: 'helvetica' };
  if (fonts) {
    pdf.addFileToVFS('Lato-Regular.ttf', fonts.body); pdf.addFont('Lato-Regular.ttf', 'Lato', 'normal');
    pdf.addFileToVFS('Lato-Bold.ttf', fonts.bodyBold); pdf.addFont('Lato-Bold.ttf', 'Lato', 'bold');
    pdf.addFileToVFS('Lato-Black.ttf', fonts.bodyBlack); pdf.addFont('Lato-Black.ttf', 'Lato', 'black');
    pdf.addFileToVFS('LexendDeca-Bold.ttf', fonts.display); pdf.addFont('LexendDeca-Bold.ttf', 'LexendDeca', 'bold');
  }
  const font = (family: 'body' | 'display', style: 'normal' | 'bold' | 'black', size: number, colour: string) => {
    pdf.setFont(F[family], family === 'display' ? 'bold' : !fonts && style === 'black' ? 'bold' : style);
    pdf.setFontSize(size);
    pdf.setTextColor(...rgb(colour));
  };
  const toneColour = (t: Tone | null | undefined) =>
    t === 'good' ? pal.good : t === 'warn' ? pal.warn : t === 'bad' ? pal.bad : t === 'ai' ? pal.ai : pal.blue;

  let y = TOP_FIRST;
  const room = (need: number) => {
    if (y + need > PAGE.h - BOTTOM) { pdf.addPage(); y = TOP_NEXT; }
  };
  const lastY = () => (pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;

  /** A section heading, kept on the page with at least `keep` mm of what follows it — a
   *  heading alone at the foot of a page, its content overleaf, reads as a mistake. */
  const heading = (title: string, keep = 22) => {
    const top = pdf.getNumberOfPages() === 1 ? TOP_FIRST : TOP_NEXT;
    if (y > top + 0.5) y += 4;   // space above, except at the very top of a page
    room(keep);
    pdf.setFillColor(...rgb(pal.red));
    pdf.rect(PAGE.m, y - 3.6, 1.3, 5, 'F');
    font('display', 'bold', 11.5, pal.blue);
    pdf.text(safe(title), PAGE.m + 3.6, y);
    y += 4.5;
  };
  const paragraph = (text: string, size = 9.5, colour = pal.ink, indent = 0) => {
    font('body', 'normal', size, colour);
    const lineH = size * 0.47;
    for (const raw of safe(text).split('\n')) {
      const lines = pdf.splitTextToSize(raw || ' ', CONTENT_W - indent) as string[];
      for (const line of lines) {
        room(lineH + 1);
        pdf.text(line, PAGE.m + indent, y + lineH * 0.75);
        y += lineH;
      }
    }
  };
  const table = (head: string[] | null, body: Array<Array<string | number>>, opts: Parameters<typeof autoTable>[1] = {}) => {
    autoTable(pdf, {
      startY: y,
      margin: { left: PAGE.m, right: PAGE.m, top: TOP_NEXT, bottom: BOTTOM },
      head: head ? [head.map(safe)] : undefined,
      body: body.map((r) => r.map((c) => safe(c))),
      theme: 'grid',
      styles: { font: F.body, fontSize: 8.6, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineColor: rgb(pal.rule), lineWidth: 0.15, textColor: rgb(pal.ink), overflow: 'linebreak', valign: 'middle' },
      headStyles: { font: F.display, fontStyle: 'bold', fillColor: rgb(pal.blue), textColor: rgb(pal.paper), fontSize: 8.4 },
      alternateRowStyles: { fillColor: rgb(pal.zebra) },
      ...opts,
    });
    y = lastY() + 3;
  };

  const render: Record<DocSection['kind'], (s: DocSection) => void> = {
    text: (s) => {
      const t = s as Extract<DocSection, { kind: 'text' }>;
      if (!t.text.trim()) return;
      heading(t.title);
      paragraph(t.text);
      y += 3;
    },
    facts: (s) => {
      const f = s as Extract<DocSection, { kind: 'facts' }>;
      if (!f.facts.length) return;
      heading(f.title);
      table(null, f.facts.map((x) => [x.label, x.value]), {
        theme: 'grid',
        columnStyles: { 0: { cellWidth: 56, font: F.body, fontStyle: 'bold', textColor: rgb(pal.muted), fillColor: rgb(pal.labelBg) } },
        alternateRowStyles: {},
        didParseCell: (d) => {
          const tone = f.facts[d.row.index]?.tone;
          if (d.column.index === 1 && tone) { d.cell.styles.textColor = rgb(toneColour(tone)); d.cell.styles.fontStyle = 'bold'; }
        },
      });
      y += 2;
    },
    table: (s) => {
      const t = s as Extract<DocSection, { kind: 'table' }>;
      heading(t.title, 30);
      if (!t.rows.length) { paragraph('No rows.', 9, pal.faint); y += 3; return; }
      const total = t.columns.reduce((a, c) => a + (c.width ?? 1), 0);
      table(t.columns.map((c) => c.label), t.rows.map((r) => t.columns.map((c) => (r[c.key] ?? '') as string | number)), {
        columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, { cellWidth: (CONTENT_W * (c.width ?? 1)) / total, halign: c.align ?? 'left' }])),
        didParseCell: (d) => {
          if (d.section !== 'body') return;
          const tone = t.tones?.[d.row.index];
          if (tone && d.column.index === 0) {
            d.cell.styles.textColor = rgb(toneColour(tone));
            d.cell.styles.fontStyle = 'bold';
          }
        },
      });
      if (t.note) { paragraph(t.note, 7.8, pal.faint); y += 1; }
      y += 2;
    },
    findings: (s) => {
      const f = s as Extract<DocSection, { kind: 'findings' }>;
      if (!f.items.length) return;
      heading(f.title);
      table(null, f.items.map((x) => [(x.label ?? x.tone).toUpperCase(), x.detail ? `${x.title}\n${x.detail}` : x.title]), {
        theme: 'plain',
        styles: { font: F.body, fontSize: 8.8, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 }, textColor: rgb(pal.ink), overflow: 'linebreak', valign: 'top', lineColor: rgb(pal.rule), lineWidth: { bottom: 0.15 } },
        columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold', fontSize: 7, halign: 'center', textColor: rgb(pal.paper) } },
        alternateRowStyles: {},
        didParseCell: (d) => {
          if (d.column.index === 0) d.cell.styles.fillColor = rgb(toneColour(f.items[d.row.index]?.tone));
        },
      });
      y += 2;
    },
    chart: (s) => {
      const c = s as Extract<DocSection, { kind: 'chart' }>;
      const png = vitalsChartPng(c.series, pal, { width: 1600, height: 560 });
      if (!png) return;
      const h = (CONTENT_W * 560) / 1600;
      heading(c.title, h + 12);
      pdf.setDrawColor(...rgb(pal.rule));
      pdf.setLineWidth(0.2);
      pdf.addImage(png, 'PNG', PAGE.m, y, CONTENT_W, h, undefined, 'FAST');
      pdf.rect(PAGE.m, y, CONTENT_W, h);
      y += h + 2;
      if (c.caption) paragraph(c.caption, 7.8, pal.faint);
      y += 3;
    },
    list: (s) => {
      const l = s as Extract<DocSection, { kind: 'list' }>;
      if (!l.items.length) return;
      heading(l.title);
      for (const item of l.items) {
        room(6);
        pdf.setFillColor(...rgb(pal.red));
        pdf.circle(PAGE.m + 1.4, y + 2.3, 0.7, 'F');
        paragraph(item, 9.2, pal.ink, 4);
        y += 0.8;
      }
      if (l.note) paragraph(l.note, 7.8, pal.faint);
      y += 3;
    },
  };

  for (const s of doc.sections) render[s.kind](s);

  // ── Head and foot on every page, now the page count is known ───────────────
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    drawHead(pdf, pal, doc, p === 1, logo, font);
    drawFoot(pdf, pal, doc, p, pages, font);
  }
  return pdf.output('blob');
}

type FontFn = (family: 'body' | 'display', style: 'normal' | 'bold' | 'black', size: number, colour: string) => void;

function sweep(pdf: JsPdf, pal: DocPalette, height: number) {
  const n = 70;
  for (let i = 0; i < n; i++) {
    pdf.setFillColor(...rgb(mix(pal.red, pal.blue, i / (n - 1))));
    pdf.rect((PAGE.w / n) * i, 0, PAGE.w / n + 0.3, height, 'F');
  }
}

function drawHead(pdf: JsPdf, pal: DocPalette, doc: ReportDoc, first: boolean, logo: Awaited<ReturnType<typeof logoImage>>, font: FontFn) {
  if (first) {
    sweep(pdf, pal, 3.2);
    if (logo) pdf.addImage(logo.url, 'PNG', PAGE.m, 8.5, 64, (64 * logo.height) / logo.width, undefined, 'FAST');
    if (doc.classification) {
      font('body', 'black', 7, pal.bad);
      const label = safe(doc.classification.toUpperCase());
      const w = pdf.getTextWidth(label) + 6;
      pdf.setFillColor(...rgb(pal.redTint));
      pdf.roundedRect(PAGE.w - PAGE.m - w, 9, w, 6, 1.4, 1.4, 'F');
      pdf.text(label, PAGE.w - PAGE.m - w / 2, 12.9, { align: 'center' });
    }
    font('body', 'black', 7.5, pal.red);
    pdf.text(safe(doc.eyebrow.toUpperCase()), PAGE.m, 27, { charSpace: 0.4 });
    font('display', 'bold', 16, pal.blue);
    const title = pdf.splitTextToSize(safe(doc.title), CONTENT_W) as string[];
    pdf.text(title[0], PAGE.m, 33.5);
    font('body', 'normal', 9, pal.muted);
    pdf.text(safe(doc.subtitle), PAGE.m, 38.6, { maxWidth: CONTENT_W });
    pdf.setDrawColor(...rgb(pal.rule));
    pdf.setLineWidth(0.3);
    pdf.line(PAGE.m, 41.5, PAGE.w - PAGE.m, 41.5);
  } else {
    sweep(pdf, pal, 1.8);
    if (logo) pdf.addImage(logo.url, 'PNG', PAGE.m, 5, 34, (34 * logo.height) / logo.width, undefined, 'FAST');
    font('body', 'bold', 7.8, pal.muted);
    pdf.text(safe(`${doc.title}`), PAGE.w - PAGE.m, 10, { align: 'right', maxWidth: 120 });
    pdf.setDrawColor(...rgb(pal.rule));
    pdf.setLineWidth(0.2);
    pdf.line(PAGE.m, 14.5, PAGE.w - PAGE.m, 14.5);
  }
}

function drawFoot(pdf: JsPdf, pal: DocPalette, doc: ReportDoc, page: number, pages: number, font: FontFn) {
  const y = PAGE.h - 12;
  pdf.setDrawColor(...rgb(pal.rule));
  pdf.setLineWidth(0.2);
  pdf.line(PAGE.m, y - 3.5, PAGE.w - PAGE.m, y - 3.5);
  font('body', 'bold', 7.2, pal.ink);
  pdf.text('Dubai Corporation for Ambulance Services', PAGE.m, y);
  font('body', 'normal', 7.2, pal.muted);
  pdf.text('  ·  Emergency Response Support System (ERSS)', PAGE.m + pdf.getTextWidth('Dubai Corporation for Ambulance Services ') - 1, y);
  font('body', 'bold', 7.2, pal.muted);
  pdf.text(`Page ${page} of ${pages}`, PAGE.w - PAGE.m, y, { align: 'right' });
  const generated = new Date(doc.generatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
  font('body', 'normal', 6.8, pal.faint);
  pdf.text(safe(`${doc.ref ? `${doc.ref} · ` : ''}Generated ${generated} GST${doc.generatedBy ? ` by ${doc.generatedBy}` : ''}`), PAGE.m, y + 4);
  const flags = [doc.confidential ? 'CONFIDENTIAL — PATIENT DATA' : null, doc.classification ? (/trial|simulat/i.test(doc.classification) ? 'TRIAL DATA' : doc.classification.toUpperCase()) : null].filter(Boolean).join('  ·  ');
  if (flags) {
    font('body', 'black', 6.8, pal.bad);
    pdf.text(safe(flags), PAGE.w - PAGE.m, y + 4, { align: 'right' });
  }
}
