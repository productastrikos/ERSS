import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { one } from '../lib/db.js';
import { wrap, unauthorised, validation } from '../lib/errors.js';
import {
  checkPassword, createSession, revokeSession, cookieOptions,
  capabilitiesFor, ROLES, sessionTokenFrom,
} from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

const loginSchema = z.object({
  identifier: z.string().min(2).max(120),   // username, ref, email or phone — one field,
                                            // because a responder in a vehicle should not
                                            // have to remember which kind of identifier
                                            // they have
  password: z.string().min(1).max(200),
});

router.post('/login', wrap(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
  const { identifier, password } = parsed.data;

  const user = await one(
    `SELECT u.id, u.ref, u.name, u.role, u.password_hash, u.agency_id, u.zone_scope,
            u.unit_id, u.locale, a.code AS agency_code
       FROM users u
       LEFT JOIN agencies a ON a.id = u.agency_id
      WHERE u.archived_at IS NULL
        AND (upper(u.ref) = upper($1) OR lower(u.username) = lower($1)
             OR lower(u.email) = lower($1) OR u.phone = $1)`,
    [identifier],
  );

  // Same error and comparable timing whether the account is absent or the password is
  // wrong — an attacker should not learn which accounts exist.
  const ok = user ? await checkPassword(password, user.password_hash) : await checkPassword(password, DUMMY_HASH);
  if (!user || !ok) {
    await audit({ action: 'auth.login_failed', entity: 'user', entityId: identifier, payload: { identifier } });
    throw unauthorised('Incorrect credentials');
  }

  const { cookie, expiresAt } = await createSession(user.id, {
    ua: req.get('user-agent'), ip: req.ip,
  });
  res.cookie(env.auth.cookieName, cookie, cookieOptions());

  await audit({
    action: 'auth.login', entity: 'user', entityId: user.id,
    actor: { id: user.id, ref: user.ref }, payload: { role: user.role },
  });

  // The token is returned as well as set as a cookie: the browser surfaces keep it per tab
  // and send it as a Bearer header (lib/auth.js sessionTokenFrom).
  res.json({ user: publicUser(user), expiresAt, token: cookie });
}));

router.post('/logout', wrap(async (req, res) => {
  const raw = sessionTokenFrom(req);
  if (raw) await revokeSession(raw);
  if (req.user) {
    await audit({
      action: 'auth.logout', entity: 'user', entityId: req.user.id,
      actor: { id: req.user.id, ref: req.user.ref },
    });
  }
  res.clearCookie(env.auth.cookieName, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}));

router.get('/me', wrap(async (req, res) => {
  if (!req.user) throw unauthorised();
  res.json({ user: publicUser(req.user) });
}));

function publicUser(u) {
  return {
    id: u.id,
    ref: u.ref,
    name: u.name,
    role: u.role,
    roleLabel: ROLES[u.role]?.label ?? u.role,
    surface: ROLES[u.role]?.surface ?? 'console',
    agencyId: u.agency_id ?? null,
    agencyCode: u.agency_code ?? null,
    zoneScope: u.zone_scope ?? [],
    unitId: u.unit_id ?? null,
    locale: u.locale ?? 'en',
    capabilities: capabilitiesFor(u.role),
  };
}

// A real bcrypt hash of a value nobody knows, so the "no such user" path costs the
// same as the "wrong password" path.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7Dh6pjkSUdbCFXk1EQvZ1VJtGCNUuCa';

export default router;
