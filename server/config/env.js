/**
 * The ONLY place process.env is read.
 *
 * Everything else imports from here. This is what makes `npm run audit:env` able to
 * prove there is no host, IP or port literal anywhere else in the source, and what
 * makes a misconfiguration produce one clear error at boot instead of a mystery at
 * request time.
 */

/** @param {string} name @param {string} [fallback] */
function str(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) return undefined;
    return fallback;
  }
  return v;
}

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`env ${name} must be an integer, got "${v}"`);
  return n;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function list(name, fallback = []) {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: int('PORT', 4327),
  logLevel: str('LOG_LEVEL', 'info'),
  corsOrigins: list('CORS_ORIGINS', ['http://localhost:3327', 'https://localhost:3327']),

  db: {
    /** A full connection string (Neon, Supabase, Render, Hostinger VPS…). When set it
     *  takes precedence over the DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD fields. */
    url: str('DATABASE_URL', ''),
    host: str('DB_HOST', '127.0.0.1'),
    port: int('DB_PORT', 5432),
    name: str('DB_NAME', 'erss_db'),
    user: str('DB_USER', 'erss'),
    password: str('DB_PASSWORD', ''),
    poolMax: int('DB_POOL_MAX', 10),
    ssl: bool('DB_SSL', false),
    /** On boot, if the schema is missing, apply schema + views and run the full seed.
     *  For hosts with no shell (Hostinger Node.js web apps). Off by default. */
    autoSetup: bool('DB_AUTO_SETUP', false),
  },

  /** Serve the built SPA (web/dist) from this process, so the whole product runs on one
   *  port — what single-process hosts like Hostinger require. 'auto' = when dist exists. */
  serveWeb: str('SERVE_WEB', 'auto'),
  webDist: str('WEB_DIST', ''),

  auth: {
    sessionSecret: str('SESSION_SECRET', ''),
    sessionHours: int('SESSION_HOURS', 12),
    bcryptRounds: int('BCRYPT_ROUNDS', 12),
    eidHashSalt: str('EID_HASH_SALT', ''),
    cookieName: 'erss_sid',
  },

  osrmUrl: str('OSRM_URL', 'https://router.project-osrm.org'),

  /** Extend seeded history to "now" at start-up, so today's figures are never empty. */
  historyCatchup: str('HISTORY_CATCHUP', 'on') !== 'off',

  seed: {
    rng: str('SEED_RNG', 'erss-dubai-2026'),
    months: int('SEED_MONTHS', 24),
  },

  llm: {
    provider: str('LLM_PROVIDER', ''),
    apiKey: str('LLM_API_KEY', ''),
    model: str('LLM_MODEL', ''),
    baseUrl: str('LLM_BASE_URL', ''),
    get enabled() { return Boolean(this.provider && (this.apiKey || this.provider === 'ollama')); },
  },

  integrations: {
    makani: { apiKey: str('MAKANI_API_KEY', ''), baseUrl: str('MAKANI_BASE_URL', '') },
    nabidh: {
      baseUrl: str('NABIDH_BASE_URL', ''),
      clientId: str('NABIDH_CLIENT_ID', ''),
      clientSecret: str('NABIDH_CLIENT_SECRET', ''),
    },
    fcmKey: str('FCM_SERVER_KEY', ''),
  },
};

/**
 * Fail loudly at boot rather than quietly at request time.
 * In development we substitute dev-only defaults and say so; in production we refuse
 * to start, because a production server with a default session secret is not a server.
 */
export function validateEnv(log = console) {
  const problems = [];
  const warnings = [];

  if (!env.db.url && !env.db.password) {
    (env.isProd ? problems : warnings).push(
      'DB_PASSWORD (or DATABASE_URL) is empty — set it in server/.env (see docs/12-DEPLOYMENT.md §3)',
    );
  }

  if (!env.auth.sessionSecret) {
    if (env.isProd) {
      problems.push('SESSION_SECRET is required in production');
    } else {
      env.auth.sessionSecret = 'dev-only-insecure-session-secret-do-not-ship';
      warnings.push('SESSION_SECRET not set — using an insecure development default');
    }
  } else if (env.auth.sessionSecret.length < 32 && env.isProd) {
    problems.push('SESSION_SECRET must be at least 32 characters');
  }

  if (!env.auth.eidHashSalt) {
    if (env.isProd) {
      problems.push('EID_HASH_SALT is required in production (Emirates ID is never stored raw)');
    } else {
      env.auth.eidHashSalt = 'dev-only-eid-salt';
      warnings.push('EID_HASH_SALT not set — using a development default');
    }
  }

  if (env.isProd && env.corsOrigins.includes('*')) {
    problems.push('CORS_ORIGINS may not contain "*" in production — cookie sessions need a specific origin');
  }

  for (const w of warnings) log.warn?.(`[env] ${w}`) ?? console.warn(`[env] ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`[env] FATAL ${p}`);
    throw new Error(`${problems.length} fatal configuration problem(s) — refusing to start`);
  }

  return { warnings };
}
