/**
 * DSO Emergency Response â€” Real-Time Socket Server
 *
 * Auth flow (persistent across restarts via data/users.json):
 *   register   { userId, name, role, password }  â†’ save to file
 *   login      { userId, password }              â†’ verify â†’ mark online
 *   rejoin     { userId, password }              â†’ silent re-auth on reconnect
 *   disconnect                                   â†’ mark offline, persist last GPS
 *
 * All clients receive the FULL registered team list with online/offline status
 * so the dashboard always sees who is registered, who is online, and where they are.
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');
const fs         = require('fs');
const os         = require('os');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// â”€â”€ Persistent store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadRegistered() {
  try {
    ensureDataDir();
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return {}; }
}
function saveRegistered() {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(registered, null, 2));
}

// registered: { [userId]: { userId, name, role, passwordHash, registeredAt, lastLat, lastLng } }
const registered = loadRegistered();

// online (in-memory): userId â†’ { socketId, status, lastLat, lastLng }
const online = new Map();

const SALT = 'dso-smartcity-2024';
function hashPwd(p) {
  return crypto.createHash('sha256').update(p + SALT).digest('hex');
}

// ── Auto-generate unique userId ───────────────────────────────────────────────
const ROLE_PREFIX = {
  'Traffic Police':      'TP',
  'Ambulance':           'AM',
  'Fire':                'FR',
  'Maintenance':         'MC',
  'Water Engineer':      'WE',
  'HVAC Technician':     'HV',
  'Electrical Engineer': 'EE',
  'Fire Safety Officer': 'FS',
  'Facility Manager':    'FM',
  'Waste Collector':     'WC',
  'Sanitation Engineer': 'SE',
};
function generateUserId(role) {
  const prefix = ROLE_PREFIX[role] || 'RS';
  let id;
  do { id = `${prefix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`; }
  while (registered[id]); // ensure uniqueness
  return id;
}

// ── Assign a random starting location within ~1.5km of DSO centre ─────────────
// DSO (Dubai Science Park) centre: 25.1264 N, 55.3823 E
const DSO_CENTER = { lat: 25.1264, lng: 55.3823 };
function randomNearbyLocation() {
  // 1.5 – 3 km away from DSO centre so movement is clearly visible on map
  const r     = (0.0135 + 0.0135 * Math.random()); // ~1.5–3 km
  const angle = Math.random() * 2 * Math.PI;
  return {
    lat: +(DSO_CENTER.lat + r * Math.cos(angle)).toFixed(6),
    lng: +(DSO_CENTER.lng + r * Math.sin(angle)).toFixed(6),
  };
}

// ── Startup: relocate any registered user whose saved position is within 1 km
// of DSO centre (left there after arriving at a scene). Guarantees every member
// shows a realistic travel distance on the dashboard.
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
(function relocateCloseUsers() {
  let changed = false;
  for (const u of Object.values(registered)) {
    if (u.lastLat == null || u.lastLng == null ||
        distKm(u.lastLat, u.lastLng, DSO_CENTER.lat, DSO_CENTER.lng) < 1.2) {
      const loc = randomNearbyLocation();
      u.lastLat = loc.lat;
      u.lastLng = loc.lng;
      changed = true;
    }
  }
  if (changed) {
    saveRegistered();
    console.log('[relocate] Reset close users to far starting positions');
  }
})();

// â”€â”€ Build full team list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function teamList() {
  return Object.values(registered).map(u => {
    const sess = online.get(u.userId);
    return {
      userId:  u.userId,
      name:    u.name,
      role:    u.role,
      online:  !!sess,
      status:  sess?.status  ?? 'offline',
      lastLat: sess?.lastLat ?? u.lastLat ?? null,
      lastLng: sess?.lastLng ?? u.lastLng ?? null,
    };
  });
}
function broadcast() { io.emit('users_update', teamList()); }

// â”€â”€ Helper: mark socket as online for a user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function markOnline(socket, id, user) {
  const prev = online.get(id);
  online.set(id, {
    socketId: socket.id,
    status:   prev?.status ?? 'available',
    lastLat:  prev?.lastLat ?? user.lastLat ?? null,
    lastLng:  prev?.lastLng ?? user.lastLng ?? null,
  });
  socket.userId = id;
  socket.join(id);
}

// â”€â”€ REST endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health',    (_, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/api/users', (_, res) => res.json(teamList()));

// ── Traffic signals — 12 real DSO intersections served to mobile map ──────
const DSO_SIGNALS = [
  { id:'DSO-SIG-101', name:'DSO Central Roundabout',            location:[55.3823,25.1264], state:'GREEN'  },
  { id:'DSO-SIG-102', name:'DSO West Boulevard Junction',        location:[55.3796,25.1219], state:'RED'    },
  { id:'DSO-SIG-103', name:'Academic City Road Entry',           location:[55.3842,25.1189], state:'GREEN'  },
  { id:'DSO-SIG-104', name:'Inner Residential Junction',         location:[55.3817,25.1284], state:'YELLOW' },
  { id:'DSO-SIG-105', name:'DSO HQ Entrance',                    location:[55.3868,25.1238], state:'GREEN'  },
  { id:'DSO-SIG-106', name:'West Ring Road Entry',           location:[55.3780,25.1247], state:'RED'    },
  { id:'DSO-SIG-107', name:'North Tech Boulevard',           location:[55.3857,25.1292], state:'GREEN'  },
  { id:'DSO-SIG-108', name:'South Academic Link',            location:[55.3802,25.1175], state:'YELLOW' },
  { id:'DSO-SIG-109', name:'Residential North Gate',         location:[55.3836,25.1312], state:'GREEN'  },
  { id:'DSO-SIG-110', name:'West Service Interchange',       location:[55.3760,25.1215], state:'RED'    },
  { id:'DSO-SIG-111', name:'East Tech Zone Entry',           location:[55.3890,25.1195], state:'GREEN'  },
  { id:'DSO-SIG-112', name:'Academic City Southern Gate',    location:[55.3872,25.1152], state:'YELLOW' },
];
// Allow dashboard to push GREEN override for a signal (broadcast to all mobiles)
app.post('/api/signals/:id/green', (req, res) => {
  const sig = DSO_SIGNALS.find(s => s.id === req.params.id);
  if (!sig) return res.status(404).json({ error: 'Signal not found' });
  sig.state = 'GREEN';
  io.emit('signal_override', { id: sig.id, state: 'GREEN' });
  res.json({ ok: true });
});
app.get('/api/signals', (_, res) => res.json(DSO_SIGNALS));

// ── Dashboard: create predefined team member ───────────────────────────────
app.post('/api/users', (req, res) => {
  const { name, role, password, userId: reqId } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'name and password are required' });
  const id = reqId ? reqId.toUpperCase().trim() : generateUserId(role || 'Traffic Police');
  if (registered[id]) return res.status(409).json({ error: `ID ${id} already exists` });
  const loc = randomNearbyLocation();
  registered[id] = {
    userId: id, name: name.trim(), role: role || 'Traffic Police',
    passwordHash: hashPwd(password), registeredAt: Date.now(),
    lastLat: loc.lat, lastLng: loc.lng,
  };
  saveRegistered();
  console.log(`[+] Dashboard created: ${name} → ${id} (${role})`);
  broadcast();
  res.json({ userId: id, name: name.trim(), role: role || 'Traffic Police', lastLat: loc.lat, lastLng: loc.lng });
});

// ── Dashboard: delete team member ─────────────────────────────────────────
app.delete('/api/users/:id', (req, res) => {
  const id = req.params.id.toUpperCase().trim();
  if (!registered[id]) return res.status(404).json({ error: 'User not found' });
  delete registered[id];
  saveRegistered();
  broadcast();
  res.json({ ok: true });
});

// ── Dashboard: update name / role / reset password ────────────────────────
app.put('/api/users/:id', (req, res) => {
  const id = req.params.id.toUpperCase().trim();
  if (!registered[id]) return res.status(404).json({ error: 'User not found' });
  const { name, role, password } = req.body;
  if (name)     registered[id].name = name.trim();
  if (role)     registered[id].role = role;
  if (password) registered[id].passwordHash = hashPwd(password);
  saveRegistered();
  broadcast();
  res.json({ ok: true, user: { userId: id, name: registered[id].name, role: registered[id].role } });
});

// â”€â”€ Socket events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // â”€â”€ Register new team member â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('login', ({ userId, password }) => {
    const id   = (userId || '').toUpperCase().trim();
    const user = registered[id];
    if (!user)                                  { socket.emit('login_error', { message: 'Responder ID not found' }); return; }
    if (user.passwordHash !== hashPwd(password)){ socket.emit('login_error', { message: 'Incorrect password' });    return; }
    markOnline(socket, id, user);
    socket.emit('login_success', { userId: id, name: user.name, role: user.role, lastLat: user.lastLat, lastLng: user.lastLng });
    console.log(`[â†’] Login: ${user.name} (${id})`);
    broadcast();
  });

  // â”€â”€ Re-join (silent, on socket reconnect) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('rejoin', ({ userId, password }) => {
    const id   = (userId || '').toUpperCase().trim();
    const user = registered[id];
    if (!user || user.passwordHash !== hashPwd(password)) {
      console.warn(`[!] Rejoin FAILED for ${id} — bad/missing password`);
      return;
    }
    markOnline(socket, id, user);
    socket.emit('login_success', { userId: id, name: user.name, role: user.role, lastLat: user.lastLat, lastLng: user.lastLng });
    broadcast();
  });

  // â”€â”€ Dashboard: get full team list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('get_users', () => socket.emit('users_update', teamList()));

  // â”€â”€ Dashboard: dispatch task to responder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('send_task', (taskData) => {
    const { responderId, responderName, taskId } = taskData;
    console.log(`[â†’] Task ${taskId} â†’ ${responderId} (${responderName})`);
    const sess = online.get(responderId);
    if (sess) { online.set(responderId, { ...sess, status: 'busy' }); broadcast(); }
    io.to(responderId).emit('new_task', taskData);
  });

  // ── Dashboard: push bulk signal state changes → relay to all mobiles ──────
  // payload: [{ id: 'DSO-SIG-101', state: 'RED' }, ...]
  socket.on('push_signals', (updates) => {
    if (!Array.isArray(updates)) return;
    updates.forEach((u, i) => {
      const sig = DSO_SIGNALS.find(s => s.id === u.id);
      if (!sig) return;
      sig.state = u.state;
      // Small stagger (60 ms each) so rapid events are seen individually on client
      setTimeout(() => io.emit('signal_override', { id: u.id, state: u.state }), i * 60);
    });
  });

  // â”€â”€ Mobile: accepted â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('task_accepted', ({ taskId, userId }) => {
    const sess = online.get(userId);
    if (sess) { online.set(userId, { ...sess, status: 'en_route' }); broadcast(); }
    io.emit('task_status_update', { taskId, status: 'ACCEPTED', userId, ts: Date.now() });
  });

  // â”€â”€ Mobile: rejected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('task_rejected', ({ taskId, userId }) => {
    const sess = online.get(userId);
    if (sess) { online.set(userId, { ...sess, status: 'available' }); broadcast(); }
    io.emit('task_status_update', { taskId, status: 'REJECTED', userId, ts: Date.now() });
  });

  // â”€â”€ Mobile: GPS position â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('location_update', ({ userId, lat, lng, taskId }) => {
    const sess = online.get(userId);
    if (sess) online.set(userId, { ...sess, lastLat: lat, lastLng: lng });
    if (registered[userId]) { registered[userId].lastLat = lat; registered[userId].lastLng = lng; }
    io.emit('responder_location', { userId, lat, lng, taskId, ts: Date.now() });
    broadcast(); // dashboard distance updates in real-time
  });

  // â”€â”€ Mobile: arrived â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('mark_arrived', ({ taskId, userId }) => {
    const sess = online.get(userId);
    if (sess) { online.set(userId, { ...sess, status: 'on_scene' }); broadcast(); }
    io.emit('task_status_update', { taskId, status: 'ARRIVED', userId, ts: Date.now() });
    // After 4 s on-scene, teleport the responder back to a new far starting
    // position so the next dispatch shows a real travel distance again.
    // The mobile app also auto-relocates after 4 s, keeping both in sync.
    setTimeout(() => {
      const current = online.get(userId);
      if (!current || current.status !== 'on_scene') return; // already handled by task_completed
      const loc = randomNearbyLocation();
      online.set(userId, { ...current, status: 'available', lastLat: loc.lat, lastLng: loc.lng });
      if (registered[userId]) {
        registered[userId].lastLat = loc.lat;
        registered[userId].lastLng = loc.lng;
        saveRegistered();
      }
      console.log(`[↩] ${userId} relocated to new far position after scene`);
      broadcast();
    }, 4000);
  });

  // â”€â”€ Mobile: completed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ── Mobile: relay road route geometry to dashboard ──────────────────────────
  socket.on('route_update', ({ taskId, coords }) => {
    io.emit('task_route', { taskId, coords });
  });

  socket.on('task_completed', ({ taskId, userId }) => {
    // Teleport to a new far position immediately so distance resets to 1.5–3 km
    const loc = randomNearbyLocation();
    const sess = online.get(userId);
    if (sess) {
      online.set(userId, { ...sess, status: 'available', lastLat: loc.lat, lastLng: loc.lng });
    }
    if (registered[userId]) {
      registered[userId].lastLat = loc.lat;
      registered[userId].lastLng = loc.lng;
      saveRegistered();
    }
    io.emit('task_status_update', { taskId, status: 'RESOLVED', userId, ts: Date.now() });
    console.log(`[↩] ${userId} relocated to new far position after task completed`);
    broadcast();
  });

  // â”€â”€ Disconnect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('disconnect', () => {
    const id = socket.userId;
    if (!id) return;
    const sess = online.get(id);
    if (sess) {
      if (registered[id] && sess.lastLat != null) {
        registered[id].lastLat = sess.lastLat;
        registered[id].lastLng = sess.lastLng;
        saveRegistered();
      }
      online.delete(id);
      console.log(`[-] Offline: ${id}`);
      broadcast();
    }
  });
});

// ── Live position drift: gently moves available/on_scene responders so the
// dashboard live-distance counter keeps ticking (realistic patrol movement).
setInterval(() => {
  if (online.size === 0) return;
  let changed = false;
  for (const [id, sess] of online) {
    if (sess.lastLat == null || sess.status === 'en_route' || sess.status === 'busy') continue;
    // ~40-80 m random walk every 3 s — looks alive, not teleporting
    const drift = () => (Math.random() - 0.5) * 0.0009;
    online.set(id, { ...sess, lastLat: +(sess.lastLat + drift()).toFixed(6), lastLng: +(sess.lastLng + drift()).toFixed(6) });
    changed = true;
  }
  if (changed) broadcast();
}, 3000);

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0'; // bind to all interfaces so phone on same WiFi can connect

// Detect LAN IP for friendly console output
function getLanIP() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, HOST, () => {
  const lan = getLanIP();
  console.log('\n🚀 DSO Emergency Response Server');
  console.log(`   Local          : http://localhost:${PORT}`);
  console.log(`   Network (LAN)  : http://${lan}:${PORT}  ← open this on your phone`);
  console.log(`   Mobile App     : http://${lan}:${PORT}`);
  console.log(`   Team List API  : http://${lan}:${PORT}/api/users`);
  console.log(`   Registered     : ${Object.keys(registered).length} members\n`);
});
