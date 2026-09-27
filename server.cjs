/**
 * CommonJS twin of server.js, for loaders that require() the entry file on a Node
 * without require(esm) support. Same behaviour: load .env, then import the backend.
 */

const { existsSync } = require('node:fs');
const { join } = require('node:path');

for (const file of [join(__dirname, 'server', '.env'), join(__dirname, '.env')]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

import('./server/index.js').catch((err) => {
  console.error('[boot] the backend failed to load:', err);
  process.exit(1);
});
