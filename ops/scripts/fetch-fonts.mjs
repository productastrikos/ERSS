#!/usr/bin/env node
/**
 * Download the three typefaces into web/public/fonts as woff2.
 *
 * Run once after cloning. The app works without them (system fallback) but is not
 * on-brand, and `npm run audit:theme` warns.
 *
 *   node ops/scripts/fetch-fonts.mjs
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'web', 'public', 'fonts');

// Google Fonts CSS API v2. A modern UA gets woff2; we parse the src URLs out.
const SPECS = [
  { file: 'lexend-deca-latin.woff2',      css: 'family=Lexend+Deca:wght@300..700', pick: (f) => f.weight.includes('300') || f.variable },
  { file: 'lato-400-latin.woff2',         css: 'family=Lato:wght@400',             pick: () => true },
  { file: 'lato-700-latin.woff2',         css: 'family=Lato:wght@700',             pick: () => true },
  { file: 'lato-900-latin.woff2',         css: 'family=Lato:wght@900',             pick: () => true },
  { file: 'lato-400-italic-latin.woff2',  css: 'family=Lato:ital,wght@1,400',      pick: () => true },
  { file: 'jetbrains-mono-latin.woff2',   css: 'family=JetBrains+Mono:wght@400..700', pick: () => true },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

await mkdir(OUT, { recursive: true });

let ok = 0;
let failed = 0;

for (const spec of SPECS) {
  const target = join(OUT, spec.file);
  try {
    await access(target);
    console.log(`  = ${spec.file} (already present)`);
    ok++;
    continue;
  } catch { /* not present — fetch it */ }

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?${spec.css}&display=swap`;
    const cssRes = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
    if (!cssRes.ok) throw new Error(`css ${cssRes.status}`);
    const css = await cssRes.text();

    // Take the latin subset block — the one whose unicode-range starts at U+0000.
    const blocks = css.split('@font-face').filter((b) => b.includes('src:'));
    const latin = blocks.find((b) => b.includes('U+0000-00FF')) ?? blocks.at(-1);
    const url = latin?.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
    if (!url) throw new Error('no woff2 url in the returned css');

    const fontRes = await fetch(url);
    if (!fontRes.ok) throw new Error(`font ${fontRes.status}`);
    await writeFile(target, Buffer.from(await fontRes.arrayBuffer()));
    const kb = Math.round((await fontRes.headers.get('content-length') ?? 0) / 1024);
    console.log(`  + ${spec.file}${kb ? ` (${kb} KB)` : ''}`);
    ok++;
  } catch (err) {
    console.warn(`  ! ${spec.file} — ${err.message}`);
    failed++;
  }
}

console.log(`\nfonts: ${ok} ready, ${failed} failed → ${OUT}`);
if (failed) {
  console.log('The app still runs; the fallback stack applies until these are fetched.');
  process.exitCode = 0;   // never fail a build over a font
}
