/**
 * Authentication, sessions, and role/zone authorisation.
 *
 * Replaces the DSO server's SHA-256-with-a-fixed-salt password scheme, which was
 * unsalted per user and fast — not acceptable in a system shown to a security
 * authority. bcrypt at cost 12.
 *
 * Authorisation is enforced SERVER-SIDE on every route. There is no client-side
 * filtering of data a user may not see.
 */

import bcrypt from 'bcryptjs';
import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { one, query } from './db.js';
import { unauthorised, forbidden } from './errors.js';
import { nowIso } from './clock.js';

// ── Roles and permissions ────────────────────────────────────────────────────
// Console roles see pillar pages; mobile roles see neither.

export const ROLES = {
  admin:          { surface: 'console', label: 'Administrator' },
  dispatcher:     { surface: 'console', label: 'Dispatcher' },
  duty_officer:   { surface: 'console', label: 'Duty Officer' },
  service_lead:   { surface: 'console', label: 'Service Lead' },
  crisis_centre:  { surface: 'console', label: 'Crisis Centre' },
  police_command: { surface: 'console', label: 'Police Command' },
  hospital_coord: { surface: 'console', label: 'Hospital Coordinator' },
  infra_operator: { surface: 'console', label: 'Infrastructure Operator' },
  analyst:        { surface: 'console', label: 'Analyst' },
  responder:      { surface: 'mobile',  label: 'Responder' },
  citizen:        { surface: 'mobile',  label: 'Citizen' },
};

/** capability → roles that hold it. The nav is generated from this, so a role without
 *  a capability does not see a disabled item — it sees no item. */
export const PERMISSIONS = {
  'operations.view':    ['admin', 'dispatcher', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'hospital_coord'],
  'operations.dispatch':['admin', 'dispatcher', 'duty_officer'],
  'incident.create':    ['admin', 'dispatcher', 'duty_officer'],
  'incident.close':     ['admin', 'dispatcher', 'duty_officer'],
  'incident.note':      ['admin', 'dispatcher', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'hospital_coord', 'infra_operator'],
  'advisories.view':    ['admin', 'dispatcher', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'analyst'],
  'advisories.act':     ['admin', 'duty_officer', 'service_lead', 'crisis_centre'],
  'collaborate.view':   ['admin', 'dispatcher', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'hospital_coord', 'infra_operator'],
  'ranking.view':       ['admin', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'analyst'],
  'ranking.weights':    ['admin', 'service_lead'],
  'analytics.view':     ['admin', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'analyst'],
  'intelligence.view':  ['admin', 'service_lead', 'analyst'],
  'executive.view':     ['admin', 'service_lead', 'crisis_centre', 'police_command'],
  'agencies.view':      ['admin', 'dispatcher', 'duty_officer', 'service_lead', 'crisis_centre', 'police_command', 'infra_operator'],
  'clinical.view':      ['admin', 'hospital_coord', 'responder', 'dispatcher'],
  'scenario.control':   ['admin', 'dispatcher', 'duty_officer', 'service_lead'],
  // The automatic-dispatch policy (services/dispatchRules.js). A dispatcher works under it;
  // changing what the AI may do by itself is a supervisory decision.
  'dispatch.rules':     ['admin', 'duty_officer', 'service_lead'],
  'admin.view':         ['admin'],
  'audit.view':         ['admin', 'service_lead'],
  // mobile
  'assignment.act':     ['responder'],
  'sos.create':         ['citizen', 'admin'],
};

export function can(role, capability) {
  return PERMISSIONS[capability]?.includes(role) ?? false;
}

export function capabilitiesFor(role) {
  return Object.entries(PERMISSIONS).filter(([, roles]) => roles.includes(role)).map(([cap]) => cap);
}

// ── Passwords ────────────────────────────────────────────────────────────────

export const hashPassword = (plain) => bcrypt.hash(plain, env.auth.bcryptRounds);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** PDPL: the raw Emirates ID is never stored. Salted hash + last 3 for display. */
export function hashEmiratesId(eid) {
  const clean = String(eid).replace(/\D/g, '');
  return {
    hash: createHash('sha256').update(clean + env.auth.eidHashSalt).digest('hex'),
    last3: clean.slice(-3),
  };
}

// ── Sessions ─────────────────────────────────────────────────────────────────
// Opaque random token in an HTTP-only cookie; only its hash is stored, so a database
// read does not yield a usable session.

function signToken(raw) {
  const sig = createHmac('sha256', env.auth.sessionSecret).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

function verifyToken(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const raw = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac('sha256', env.auth.sessionSecret).update(raw).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return raw;
}

const tokenHash = (raw) => createHash('sha256').update(raw).digest('hex');

export async function createSession(userId, { ua, ip } = {}) {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.auth.sessionHours * 3600_000).toISOString();
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ua, ip) VALUES ($1,$2,$3,$4,$5)`,
    [userId, tokenHash(raw), expiresAt, ua ?? null, ip ?? null],
  );
  await query('UPDATE users SET last_login_at = $2 WHERE id = $1', [userId, nowIso()]);
  return { cookie: signToken(raw), expiresAt };
}

export async function revokeSession(signed) {
  const raw = verifyToken(signed);
  if (!raw) return;
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [tokenHash(raw)]);
}

export async function resolveSession(signed) {
  const raw = verifyToken(signed);
  if (!raw) return null;
  return one(
    `SELECT u.id, u.ref, u.name, u.role, u.agency_id, u.zone_scope, u.unit_id, u.locale,
            a.code AS agency_code
       FROM sessions s
       JOIN users u   ON u.id = s.user_id
       LEFT JOIN agencies a ON a.id = u.agency_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.archived_at IS NULL`,
    [tokenHash(raw)],
  );
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: env.auth.sessionHours * 3600_000,
    path: '/',
  };
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * The session token a request carries: a Bearer header first, then the cookie.
 *
 * The browser surfaces send the header, holding their token per tab (sessionStorage), so
 * a dispatcher, a responder and a citizen can be signed in side by side in one browser —
 * a cookie is shared by every tab on the origin and the last login would win everywhere.
 * The cookie stays for curl, the flow tests and anything else that relies on it.
 */
export function sessionTokenFrom(req) {
  const header = req.get?.('authorization') ?? req.headers?.authorization;
  const bearer = typeof header === 'string' ? header.match(/^Bearer\s+(\S+)$/i)?.[1] : null;
  return bearer ?? req.cookies?.[env.auth.cookieName] ?? null;
}

/** Attaches req.user when a valid session token is present. Never rejects. */
export async function attachUser(req, _res, next) {
  try {
    const raw = sessionTokenFrom(req);
    req.user = raw ? await resolveSession(raw) : null;
    next();
  } catch (err) { next(err); }
}

/** Requires a session. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorised());
  next();
}

/** Requires a capability. */
export function requireCap(capability) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorised());
    if (!can(req.user.role, capability)) {
      return next(forbidden(`Role "${req.user.role}" does not hold "${capability}"`));
    }
    next();
  };
}

/** Requires any one of several capabilities — a read shared by Operations and Collaborate. */
export function requireAnyCap(...capabilities) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorised());
    if (!capabilities.some((c) => can(req.user.role, c))) {
      return next(forbidden(`Role "${req.user.role}" holds none of ${capabilities.join(', ')}`));
    }
    next();
  };
}

/** Requires one of a set of roles. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorised());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

// Zone scope is enforced in the repositories (repos/incidents.js scopeClause) and on
// socket room joins (realtime/index.js). An empty scope means full visibility for the
// role — the scope narrows, it never grants.
