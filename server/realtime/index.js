/**
 * Socket.IO wiring: rooms, presence, fan-out.
 *
 * The rules that govern what goes over this socket, from docs/02-ARCHITECTURE §6:
 *
 *   1. Writes go over REST. Fan-out goes over the socket. A client cannot create an
 *      incident, acknowledge an assignment or act on an advisory by emitting an event.
 *      The ONE deliberate exception is `unit:position`, which is high-frequency and
 *      lossy by nature.
 *   2. REST is the floor, the socket is enrichment. A dropped connection degrades
 *      liveness, never correctness. On reconnect the client refetches; there is no
 *      event replay buffer, because a replay buffer is a source of subtle inconsistency.
 */

import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { resolveSession, ROLES } from '../lib/auth.js';
import { clock, nowIso } from '../lib/clock.js';
import { query, pool } from '../lib/db.js';
import { listUnits } from '../repos/fleet.js';
import { reportPosition } from '../services/positions.js';

/** Rooms. Names are the addressing scheme — see docs/04 §10. */
export const room = {
  console: (role) => `console:${role}`,
  /** Unscoped console users: every incident. A zone-scoped user is NOT in here. */
  consoleAll: 'console:all',
  /** Every console user: fleet positions, snapshots, KPI ticks. */
  consoleFleet: 'console:fleet',
  zone: (ref) => `zone:${ref}`,
  incident: (ref) => `incident:${ref}`,
  unit: (ref) => `unit:${ref}`,
  agency: (code) => `agency:${code}`,
  hospital: (ref) => `hospital:${ref}`,
  sos: (ref) => `sos:${ref}`,
  run: (ref) => `run:${ref}`,
};

let io = null;

/** Presence: userRef → { socketIds, role, unitRef, lastSeen } */
const presence = new Map();

/**
 * True while a responder device bound to this unit is connected. The live simulation
 * leaves such a unit alone — a person holding the phone drives it, not the simulator.
 */
export function unitDeviceOnline(unitId) {
  if (!unitId) return false;
  for (const v of presence.values()) {
    if (v.role === 'responder' && v.unitId === unitId && v.socketIds.size > 0) return true;
  }
  return false;
}

export function attachRealtime(server) {
  io = new Server(server, {
    cors: { origin: env.corsOrigins, credentials: true },
    // The Android WebView behind a flaky hotspot benefits from a generous window.
    pingTimeout: 25_000,
    pingInterval: 20_000,
    maxHttpBufferSize: 1e6,
  });

  // Authenticate with the SAME session token the REST API uses: the per-tab token from the
  // handshake when the client sends one, the cookie otherwise.
  io.use(async (socket, next) => {
    try {
      const handshakeToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
      const raw = handshakeToken ?? parseCookie(socket.handshake.headers.cookie ?? '')[env.auth.cookieName];
      const user = raw ? await resolveSession(raw) : null;
      if (!user) return next(new Error('unauthorised'));
      socket.data.user = user;
      next();
    } catch (err) {
      logger.warn({ err }, '[ws] handshake failed');
      next(new Error('unauthorised'));
    }
  });

  io.on('connection', (socket) => onConnection(socket));

  // Broadcast clock changes so every open page's transport control stays in step.
  clock.on('change', (snap) => {
    if (!io) return;
    io.emit('run:clock', snap);
  });

  logger.info('[ws] realtime attached');
  return io;
}

async function onConnection(socket) {
  const user = socket.data.user;
  const { ref, role, unit_id: unitId, agency_code: agencyCode, zone_scope: zoneScope } = user;
  const surface = ROLES[role]?.surface ?? 'none';

  // Join ONLY the rooms this identity is entitled to. A citizen or responder socket must
  // never sit in a console room: that would broadcast every incident in the emirate to a
  // phone, which is exactly the client-side filtering docs/04 §1 forbids.
  if (surface === 'console') {
    socket.join(room.console(role));
    socket.join(room.consoleFleet);
    if (zoneScope?.length) {
      for (const zref of await zoneRefsFor(zoneScope)) socket.join(room.zone(zref));
    } else {
      socket.join(room.consoleAll);
    }
  }
  if (role === 'responder' && unitId) {
    socket.data.unitRef = await unitRefFor(unitId);
    if (socket.data.unitRef) socket.join(room.unit(socket.data.unitRef));
  }
  if (agencyCode && role !== 'citizen') socket.join(room.agency(agencyCode));

  markPresent(ref, socket.id, { role, unitId });
  logger.debug({ user: ref, role }, '[ws] connected');

  // A console opening gets the fleet at once, rather than waiting up to 30 s.
  if (surface === 'console') {
    listUnits(pool).then((units) => socket.emit('units:snapshot', { at: nowIso(), units }))
      .catch((err) => logger.warn({ err }, '[ws] join snapshot failed'));
  }

  // ── Client → server ────────────────────────────────────────────────────────

  socket.on('presence:ping', () => markPresent(ref, socket.id, { role, unitId }));

  socket.on('incident:watch', async ({ ref: incRef } = {}) => {
    if (typeof incRef !== 'string') return;
    if (await mayWatchIncident(user, surface, incRef)) socket.join(room.incident(incRef));
  });
  socket.on('incident:unwatch', ({ ref: incRef } = {}) => {
    if (typeof incRef === 'string') socket.leave(room.incident(incRef));
  });
  socket.on('run:watch', ({ ref: runRef } = {}) => {
    if (typeof runRef === 'string' && surface === 'console') socket.join(room.run(runRef));
  });

  /**
   * The one socket-only write. services/positions.js throttles persistence and batches
   * the fan-out — the same path a simulated crew's movement takes.
   */
  socket.on('unit:position', async (payload = {}) => {
    if (role !== 'responder') return;                // only a responder reports position
    const { lng, lat, speed = null, heading = null } = payload;
    if (!isFinite(lng) || !isFinite(lat)) return;
    if (!socket.data.unitRef) socket.data.unitRef = await unitRefFor(unitId);
    const unitRef = socket.data.unitRef;
    if (!unitRef) return;
    await reportPosition({ unitId, unitRef, lng, lat, speed, heading, status: await unitStatusFor(unitId) });
  });

  socket.on('disconnect', () => {
    markAbsent(ref, socket.id);
    logger.debug({ user: ref }, '[ws] disconnected');
  });
}

// ── Emit helpers — realtime/fanout.js is built on these ───────────────────────

/** Emit to one room or several. A socket in more than one of the rooms receives it once. */
export function emitTo(roomName, event, payload) {
  if (!io) return;
  const rooms = Array.isArray(roomName) ? roomName.filter(Boolean) : [roomName];
  if (!rooms.length) return;
  io.to(rooms).emit(event, payload);
}

/** Correctness backstop: full fleet state every 30s, so drift cannot accumulate. */
export function startSnapshotLoop() {
  const t = setInterval(async () => {
    if (!io || io.sockets.adapter.rooms.get(room.consoleFleet)?.size == null) return;
    try {
      emitTo(room.consoleFleet, 'units:snapshot', { at: nowIso(), units: await listUnits(pool) });
    } catch (err) {
      logger.warn({ err }, '[ws] snapshot failed');
    }
  }, 30_000);
  t.unref();
  return () => clearInterval(t);
}

export function presenceList() {
  return [...presence.entries()].map(([userRef, v]) => ({
    userRef, role: v.role, unitId: v.unitId, lastSeen: v.lastSeen, online: v.socketIds.size > 0,
  }));
}

// ── Internals ────────────────────────────────────────────────────────────────

function markPresent(userRef, socketId, meta) {
  const cur = presence.get(userRef) ?? { socketIds: new Set(), ...meta };
  cur.socketIds.add(socketId);
  cur.lastSeen = nowIso();
  Object.assign(cur, meta);
  presence.set(userRef, cur);
}

function markAbsent(userRef, socketId) {
  const cur = presence.get(userRef);
  if (!cur) return;
  cur.socketIds.delete(socketId);
  cur.lastSeen = nowIso();
  if (cur.socketIds.size === 0) cur.online = false;
}

const unitRefCache = new Map();
async function unitRefFor(unitId) {
  if (!unitId) return null;
  if (unitRefCache.has(unitId)) return unitRefCache.get(unitId);
  const { rows } = await query('SELECT ref FROM units WHERE id = $1', [unitId]);
  const ref = rows[0]?.ref ?? null;
  if (ref) unitRefCache.set(unitId, ref);
  return ref;
}

async function unitStatusFor(unitId) {
  const { rows } = await query('SELECT status FROM units WHERE id = $1', [unitId]);
  return rows[0]?.status ?? null;
}

async function zoneRefsFor(zoneIds) {
  const { rows } = await query('SELECT ref FROM zones WHERE id = ANY($1::uuid[])', [zoneIds]);
  return rows.map((r) => r.ref);
}

/**
 * Incident rooms carry the timeline, notes and clinical updates. A console user may
 * watch an incident inside their zone scope; a responder only one their unit is
 * assigned to; a citizen none (their own SOS has its own room, Phase 8).
 */
async function mayWatchIncident(user, surface, incRef) {
  try {
    if (surface === 'console') {
      if (!user.zone_scope?.length) return true;
      const { rows } = await query(
        `SELECT 1 FROM incidents i LEFT JOIN zones z ON z.id = i.zone_id
          WHERE i.ref = $1 AND (i.zone_id = ANY($2::uuid[]) OR z.parent_id = ANY($2::uuid[]))`,
        [incRef, user.zone_scope],
      );
      return rows.length > 0;
    }
    if (user.role === 'responder' && user.unit_id) {
      const { rows } = await query(
        `SELECT 1 FROM assignments a JOIN incidents i ON i.id = a.incident_id
          WHERE i.ref = $1 AND a.unit_id = $2 LIMIT 1`,
        [incRef, user.unit_id],
      );
      return rows.length > 0;
    }
    return false;
  } catch (err) {
    logger.warn({ err, incRef }, '[ws] watch check failed');
    return false;
  }
}

function parseCookie(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
