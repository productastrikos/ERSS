/**
 * Seed script — registers all 10 demo users into the server's users.json
 * Run with: node seed-users.js
 * Safe to re-run; skips users that already exist.
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SALT       = 'dso-smartcity-2024';

function hashPwd(p) {
  return crypto.createHash('sha256').update(p + SALT).digest('hex');
}

function randomNearbyLocation() {
  const DSO = { lat: 25.1264, lng: 55.3823 };
  const r     = 0.0135 + 0.0135 * Math.random();
  const angle = Math.random() * 2 * Math.PI;
  return {
    lat: +(DSO.lat + r * Math.cos(angle)).toFixed(6),
    lng: +(DSO.lng + r * Math.sin(angle)).toFixed(6),
  };
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const registered = fs.existsSync(USERS_FILE)
  ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  : {};

const DEMO_USERS = [
  { userId: 'TP-001', name: 'Officer Ahmed',    role: 'Traffic Police',      password: 'Traffic@dso1' },
  { userId: 'TP-002', name: 'Officer Priya',    role: 'Traffic Police',      password: 'Traffic@dso2' },
  { userId: 'AM-001', name: 'Paramedic Raj',    role: 'Ambulance',           password: 'Ambul@dso1'   },
  { userId: 'FR-001', name: 'Firefighter Zaid', role: 'Fire',                password: 'Fire@dso1'    },
  { userId: 'MC-001', name: 'Tech Kumar',       role: 'Maintenance',         password: 'Maint@dso1'   },
  { userId: 'WE-001', name: 'Eng. Sara',        role: 'Water Engineer',      password: 'Water@dso1'   },
  { userId: 'HV-001', name: 'Tech Arjun',       role: 'HVAC Technician',     password: 'HVAC@dso1'    },
  { userId: 'EE-001', name: 'Eng. Sana',        role: 'Electrical Engineer', password: 'Elec@dso1'    },
  { userId: 'FS-001', name: 'Officer Jaya',     role: 'Fire Safety Officer', password: 'FSafe@dso1'   },
  { userId: 'FM-001', name: 'Manager Ravi',     role: 'Facility Manager',    password: 'Facil@dso1'   },
  { userId: 'WC-001', name: 'Collector Raju',   role: 'Waste Collector',     password: 'Waste@dso1'   },
  { userId: 'SE-001', name: 'Eng. Nadia',       role: 'Sanitation Engineer', password: 'Sanit@dso1'   },
];

let added = 0;
let skipped = 0;

for (const u of DEMO_USERS) {
  const id = u.userId;
  if (registered[id]) {
    console.log(`SKIP  ${id} — already exists`);
    skipped++;
    continue;
  }
  const loc = randomNearbyLocation();
  registered[id] = {
    userId:        id,
    name:          u.name,
    role:          u.role,
    passwordHash:  hashPwd(u.password),
    registeredAt:  Date.now(),
    lastLat:       loc.lat,
    lastLng:       loc.lng,
  };
  console.log(`ADD   ${id} — ${u.name} (${u.role})`);
  added++;
}

fs.writeFileSync(USERS_FILE, JSON.stringify(registered, null, 2));
console.log(`\nDone. Added: ${added}, Skipped: ${skipped}`);
console.log('Restart the socket server for changes to reload (or they are live if server reads file on login).');
