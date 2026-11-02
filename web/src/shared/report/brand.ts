/**
 * The DCAS brand, for documents — colour, logo and type, read from the same sources the
 * screens use, so a PDF and a spreadsheet look like they came from the same organisation as
 * the console.
 *
 *   COLOUR  read from theme.css at export time (--app-brand-*, --app-doc-*): no colour is
 *           written here, so retheming the product rethemes its documents too.
 *   LOGO    the client's own lockup (/dcas_logo.png), scaled down once — the source file is
 *           4,684 px wide, which would make every report a megabyte heavier for nothing.
 *   TYPE    Lexend Deca for headings and Lato for text, embedded in the PDF from
 *           /fonts/pdf (TrueType: a PDF cannot embed woff2). If they cannot be loaded the
 *           PDF falls back to the viewer's standard sans, never to no document at all.
 */

export interface DocPalette {
  red: string; blue: string;
  paper: string; ink: string; muted: string; faint: string; rule: string; zebra: string;
  labelBg: string; blueTint: string; redTint: string;
  good: string; warn: string; bad: string; ai: string;
  chartHr: string; chartSpo2: string;
}

const TOKENS: Record<keyof DocPalette, string> = {
  red: '--app-brand-red', blue: '--app-brand-blue',
  paper: '--app-doc-paper', ink: '--app-doc-ink', muted: '--app-doc-muted', faint: '--app-doc-faint',
  rule: '--app-doc-rule', zebra: '--app-doc-zebra', labelBg: '--app-doc-label-bg',
  blueTint: '--app-doc-blue-tint', redTint: '--app-doc-red-tint',
  good: '--app-doc-good', warn: '--app-doc-warn', bad: '--app-doc-bad', ai: '--app-doc-ai',
  chartHr: '--app-doc-chart-hr', chartSpo2: '--app-doc-chart-spo2',
};

/** `#RRGGBB` for any colour a computed style can hold. */
function toHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split('').map((c) => c + c).join('')}`.toUpperCase();
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  return v;
}

export function docPalette(): DocPalette {
  const css = getComputedStyle(document.documentElement);
  const out = {} as DocPalette;
  for (const [k, token] of Object.entries(TOKENS) as Array<[keyof DocPalette, string]>) out[k] = toHex(css.getPropertyValue(token));
  return out;
}

/** `[r, g, b]` for a `#RRGGBB`. */
export const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
};

/** A colour between two, for the red-to-blue brand sweep (0 = a, 1 = b). */
export function mix(a: string, b: string, k: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`.toUpperCase();
}

export interface LogoImage { url: string; width: number; height: number }

let logo: Promise<LogoImage | null> | null = null;

/** The DCAS lockup as a PNG data URL, about 1,000 px wide. Cached. */
export function logoImage(): Promise<LogoImage | null> {
  logo ??= new Promise<LogoImage | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = Math.min(1000, img.naturalWidth);
      const height = Math.round((img.naturalHeight / img.naturalWidth) * width);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      resolve({ url: canvas.toDataURL('image/png'), width, height });
    };
    img.onerror = () => resolve(null);
    img.src = '/dcas_logo.png';
  });
  return logo;
}

export interface PdfFonts { body: string; bodyBold: string; bodyBlack: string; display: string }

let fonts: Promise<PdfFonts | null> | null = null;

async function base64Of(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The brand faces as base64 TrueType, for jsPDF. Null when they cannot be fetched. */
export function pdfFonts(): Promise<PdfFonts | null> {
  fonts ??= Promise.all([
    base64Of('/fonts/pdf/lato-400.ttf'), base64Of('/fonts/pdf/lato-700.ttf'),
    base64Of('/fonts/pdf/lato-900.ttf'), base64Of('/fonts/pdf/lexend-deca-700.ttf'),
  ]).then(([body, bodyBold, bodyBlack, display]) => ({ body, bodyBold, bodyBlack, display }))
    .catch(() => null);
  return fonts;
}

/** Save a generated file. A real <a download>, so it works in a phone's browser too. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
