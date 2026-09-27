#!/usr/bin/env node
/**
 * Environment discipline audit.
 *
 * deployment_context.md §5: no host, IP or port literal appears in source. Every
 * cross-service URL lives in an env var. This proves it.
 *
 *   node ops/scripts/audit-env.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TARGETS = [
  { dir: join(ROOT, 'web', 'src'), skip: ['_legacy'] },
  { dir: join(ROOT, 'server'), skip: ['node_modules', 'data'] },
];

/** Allowed because they are documented defaults or third-party service endpoints that
 *  are themselves configurable. None of them is an ERSS service: the rule this script
 *  enforces is that nothing in source knows where OUR backend lives. */
const ALLOWED = [
  /localhost/,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /fonts\.(googleapis|gstatic)\.com/,
  /basemaps\.cartocdn\.com/,
  /router\.project-osrm\.org/,
  /postgis\.net/,
  /example\.com/,
  // A deep link handed to the phone's own map app, not a service this app calls —
  // app/responder/ResponderSurface.tsx "open in Google Maps".
  /google\.com\/maps/,
  // The assistant seam's per-provider default base URLs (server/lib/llm.js). Each is
  // overridden by LLM_BASE_URL, and with no LLM_PROVIDER set none is ever reached.
  /api\.groq\.com/,
  /openrouter\.ai/,
  /generativelanguage\.googleapis\.com/,
  /api\.anthropic\.com/,
  /api\.openai\.com/,
];

/** Files that legitimately hold configuration defaults. */
const CONFIG_FILES = [
  'config/env.js',
  'config/jurisdiction.js',
  'vite.config.ts',
];

const CHECKS = [
  { name: 'bare IPv4 address', re: /\b(?!0\.0\.0\.0|127\.0\.0\.1)(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { name: 'hard-coded https host', re: /https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-z]{2,}/ },
  { name: 'hard-coded port literal', re: /:\s*(?:3327|4327|5432|8443|3009|3209|4001)\b/ },
];

function walk(dir, skip, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (skip.includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, skip, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(p);
  }
  return out;
}

let failures = 0;
console.log('\n  Env audit — no host, IP or port literal outside configuration\n');

for (const check of CHECKS) {
  const hits = [];
  for (const target of TARGETS) {
    for (const file of walk(target.dir, target.skip)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (CONFIG_FILES.some((c) => rel.endsWith(c))) continue;

      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const stripped = line.trim();
        if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) return;
        if (!check.re.test(line)) return;
        if (ALLOWED.some((a) => a.test(line))) return;
        hits.push(`${rel}:${i + 1}  ${stripped.slice(0, 100)}`);
      });
    }
  }

  if (hits.length === 0) {
    console.log(`  [32mPASS[0m  ${check.name}`);
  } else {
    failures += hits.length;
    console.log(`  [31mFAIL[0m  ${check.name} — ${hits.length} hit(s)`);
    hits.slice(0, 8).forEach((h) => console.log(`        ${h}`));
  }
}

// .env must never be committed; .env.example must document every key .env uses.
const envExample = join(ROOT, 'server', '.env.example');
const envActual = join(ROOT, 'server', '.env');
if (existsSync(envExample) && existsSync(envActual)) {
  const keysOf = (p) => new Set(
    readFileSync(p, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.split('=')[0].trim()),
  );
  const undocumented = [...keysOf(envActual)].filter((k) => !keysOf(envExample).has(k));
  if (undocumented.length) {
    failures++;
    console.log(`  [31mFAIL[0m  .env keys missing from .env.example: ${undocumented.join(', ')}`);
  } else {
    console.log('  [32mPASS[0m  every .env key is documented in .env.example');
  }
}

console.log('');
if (failures) { console.log(`  [31m${failures} violation(s)[0m\n`); process.exit(1); }
console.log('  [32mAll checks pass[0m\n');
