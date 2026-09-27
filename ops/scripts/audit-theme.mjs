#!/usr/bin/env node
/**
 * Theme discipline audit. Run before any phase is called done.
 *
 * Each check must return nothing. A hit fails the build, which is the point:
 * "every component consumes var(--app-*)" is only true if something enforces it.
 *
 *   node ops/scripts/audit-theme.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'web', 'src');

/** Files exempt from the colour-literal ban, and why. */
const COLOUR_EXEMPT = [
  'theme/theme.css',   // the single source of colour
];

/** Not yet migrated — see docs/14-MIGRATION-MAP.md. Audited once each is ported. */
const LEGACY = '_legacy';

const checks = [
  {
    name: 'colour literal outside theme.css',
    exts: ['.ts', '.tsx', '.css', '.scss'],
    re: /#[0-9a-fA-F]{3,8}\b/,
    exempt: COLOUR_EXEMPT,
    why: 'Retheming must be possible by editing theme.css alone. Use a var(--app-*) token.',
  },
  {
    name: 'rgb()/rgba() literal outside theme.css',
    exts: ['.ts', '.tsx', '.css', '.scss'],
    re: /\brgba?\(\s*\d/,
    exempt: COLOUR_EXEMPT,
    why: 'Same rule. Add the value to theme.css and reference the token.',
  },
  {
    name: 'forbidden typeface',
    exts: ['.ts', '.tsx', '.css', '.scss', '.html'],
    re: /font-family:\s*['"]?(Inter|Roboto|Open Sans|Poppins|Montserrat|Arial|Helvetica)\b/i,
    why: 'Two typefaces only: Lexend Deca (display) and Lato (body). JetBrains Mono for refs.',
  },
  {
    name: 'off-scale border-radius',
    exts: ['.css', '.scss'],
    // Extract the declared value and validate each token in it. A lookahead here is
    // fragile — `\s*` backtracks to zero width and the assertion passes on a space.
    test: (line) => {
      const m = /border-radius:\s*([^;}]+)/.exec(line);
      if (!m) return false;
      const allowed = /^(0|inherit|initial|unset|50%|999px|6px|8px|9px|10px|12px|14px|var\(--r-[a-z0-9]+\))$/;
      return m[1].trim().split(/\s+/).some((part) => !allowed.test(part));
    },
    why: 'One radius family: 6 / 8 / 9 / 10 / 12 / 14 / 999. Cards 14, controls 9, pills 999.',
  },
  {
    name: 'deck.gl colour array literal',
    exts: ['.ts', '.tsx'],
    dirs: ['shared/map'],
    re: /\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*[,\]]/,
    why: 'Map colour comes from shared/map/tokens.ts, which resolves CSS custom properties.',
  },
  {
    name: 'emoji used as an interface icon',
    exts: ['.tsx'],
    re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u,
    why: 'lucide-react is the one icon family. Emoji render differently per platform.',
  },
  {
    name: 'dual-axis chart',
    exts: ['.ts', '.tsx'],
    re: /\b(yAxisId|secondaryAxis|rightAxis|y2Axis)\b/,
    why: 'Never two y-scales. Use two charts, small multiples, or index to a common base.',
  },
  {
    name: 'hard-coded host, IP or port',
    exts: ['.ts', '.tsx'],
    re: /https?:\/\/(?!\$\{|localhost|fonts\.|basemaps\.|router\.project-osrm|unpkg|cdn|www\.google\.com\/maps)[a-zA-Z0-9.-]+/,
    why: 'Every cross-service URL lives in an env var (deployment_context.md §5).',
  },
  {
    name: 'direction-specific margin/padding (blocks RTL later)',
    exts: ['.css', '.scss'],
    re: /^\s*(margin|padding)-(left|right):/m,
    why: 'Use margin-inline-start / padding-inline-end so an Arabic pack costs nothing.',
    warnOnly: true,
  },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === LEGACY || entry === 'dist') continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const files = walk(SRC);
let failures = 0;
let warnings = 0;

console.log(`\n  Theme audit — ${files.length} files under web/src (excluding ${LEGACY}/)\n`);

for (const check of checks) {
  const hits = [];
  for (const file of files) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    if (!check.exts.some((e) => file.endsWith(e))) continue;
    if (check.exempt?.some((x) => rel === x)) continue;
    if (check.dirs && !check.dirs.some((d) => rel.startsWith(d))) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Skip comment-only lines: a hex in a comment explaining a decision is fine.
      const stripped = line.trim();
      if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) return;
      const hit = check.test ? check.test(line) : check.re.test(line);
      if (hit) hits.push(`${rel}:${i + 1}  ${stripped.slice(0, 100)}`);
    });
  }

  if (hits.length === 0) {
    console.log(`  [32mPASS[0m  ${check.name}`);
  } else if (check.warnOnly) {
    warnings += hits.length;
    console.log(`  [33mWARN[0m  ${check.name} — ${hits.length} hit(s)`);
    console.log(`        ${check.why}`);
    hits.slice(0, 5).forEach((h) => console.log(`        ${h}`));
    if (hits.length > 5) console.log(`        … and ${hits.length - 5} more`);
  } else {
    failures += hits.length;
    console.log(`  [31mFAIL[0m  ${check.name} — ${hits.length} hit(s)`);
    console.log(`        ${check.why}`);
    hits.slice(0, 8).forEach((h) => console.log(`        ${h}`));
    if (hits.length > 8) console.log(`        … and ${hits.length - 8} more`);
  }
}

// Fonts are a warning, never a failure — the app runs on the fallback stack.
const fontDir = join(ROOT, 'web', 'public', 'fonts');
const expected = ['lexend-deca-latin.woff2', 'lato-400-latin.woff2', 'lato-700-latin.woff2'];
const missing = expected.filter((f) => !existsSync(join(fontDir, f)));
if (missing.length) {
  warnings++;
  console.log(`  [33mWARN[0m  self-hosted fonts missing: ${missing.join(', ')}`);
  console.log(`        run: node ops/scripts/fetch-fonts.mjs`);
} else {
  console.log(`  [32mPASS[0m  self-hosted fonts present`);
}

console.log('');
if (failures) {
  console.log(`  [31m${failures} violation(s)[0m${warnings ? `, ${warnings} warning(s)` : ''}\n`);
  process.exit(1);
}
console.log(`  [32mAll checks pass[0m${warnings ? ` (${warnings} warning(s))` : ''}\n`);
