/**
 * Who did it. Every write records an actor, and the actor's KIND decides how the
 * timeline reads: a crew pressing "on scene", a dispatcher logging it from the radio, or
 * the system timing an offer out.
 */

import { ROLES } from '../lib/auth.js';

/** @param {object} user  req.user from lib/auth.js */
export function actorFrom(user) {
  return {
    id: user.id,
    ref: user.ref,
    name: user.name,
    role: user.role,
    kind: user.role === 'responder' ? 'unit' : ROLES[user.role]?.surface === 'console' ? 'dispatcher' : 'citizen',
    agencyCode: user.agency_code ?? null,
    agencyId: user.agency_id ?? null,
    unitId: user.unit_id ?? null,
    zoneScope: user.zone_scope ?? [],
  };
}

/** The server acting on its own — acknowledge timeouts, automatic re-dispatch. */
export const SYSTEM = Object.freeze({
  id: null, ref: 'SYSTEM', name: 'ERSS', role: 'system', kind: 'system',
  agencyCode: null, agencyId: null, unitId: null, zoneScope: [],
});

/** For lib/audit.js, which wants { id, ref }. */
export const auditActor = (a) => (a.id ? { id: a.id, ref: a.ref } : { id: null, ref: a.ref });
