# 12 · Deployment

Follows `deployment_context.md` exactly. Two ports, two nginx files, one backend block.

---

## 1 · Port allocation

| Tier | Band | ERSS |
|---|---|---|
| Frontend | `33XX` | **3327** |
| Backend (REST + socket, one port) | `43XX` | **4327** |

Slot `27`. Both odd, sharing the last two digits, per the convention. Add this row to
the registry in `deployment_context.md` §6 **before** deploying:

| POC | Frontend | Backend | Status |
|---|---|---|---|
| dso | 3301 | 4301 | live |
| erss | **3327** | **4327** | ready to deploy |

**The FastAPI is retired.** DSO's third port (4001, `dso_api.astrikos.xyz`) has no
equivalent here — §2 of the deployment convention says one backend port, and this build
has one. Remove the `fastapi` nginx file's ERSS block if one is ever added by habit.

### Derived values

| Thing | Value |
|---|---|
| Frontend subdomain | `erss.astrikos.xyz` |
| Backend subdomain | `erss-api.astrikos.xyz` |
| pm2 frontend | `erss_3327` |
| pm2 backend | `erss_be_4327` |
| Cloudflare — frontend | **Orange** (proxied) |
| Cloudflare — backend | **Gray** (DNS-only; it carries WebSockets) |

---

## 2 · Local development

```bash
# once
git clone <repo> && cd ers
npm install                       # installs web/ and server/ workspaces

# database — see §3
createdb erss_db
psql erss_db -c "CREATE EXTENSION postgis;"

cp server/.env.example server/.env    # fill DB_PASSWORD and SESSION_SECRET
cp web/.env.example    web/.env

npm run seed                      # ~5 min, idempotent
npm run dev                       # web :3327 + server :4327, concurrently
```

| URL | Surface |
|---|---|
| `http://localhost:3327/` | Command console |
| `http://localhost:3327/app` | Mobile app |
| `http://localhost:4327/health` | Backend liveness + DB |

### Testing on a phone over the LAN

```bash
npm run dev:lan       # vite --host + basic-ssl, server bound to 0.0.0.0
```

Then open `https://<your-lan-ip>:3327/app` on the phone and accept the self-signed
certificate.

**HTTPS is not optional here.** `navigator.geolocation` and `getUserMedia` refuse to
run on a plain-HTTP LAN IP in modern mobile browsers. Without `basic-ssl` the citizen
app cannot get a location and the responder app cannot open the camera to scan an
Emirates ID — which is the single most common way a mobile demo fails, and it fails
silently.

`CORS_ORIGINS` in `server/.env` must include the LAN origin.

---

## 3 · Database

⚠ Depends on [O-1](00-DECISIONS.md#open-items).

**Option A — fresh database (recommended, and what the scripts assume):**

```sql
CREATE ROLE erss LOGIN PASSWORD '<set this, put it in server/.env>';
CREATE DATABASE erss_db OWNER erss;
\c erss_db
CREATE EXTENSION postgis;
CREATE EXTENSION pgcrypto;
```

**Option B — reuse the existing instance's superuser.** Put the credentials in
`server/.env`; `npm run seed` creates and owns its own schema either way.

Requires PostgreSQL 14+ with PostGIS 3.2+. PostgreSQL 16 is what the scripts are
written against.

`DB_PASSWORD` lives in `server/.env` and nowhere else. It is never committed, never
logged, never sent to the client, and never appears in an error message returned to a
browser — the `/health` route reports the *target* (`host:port/db`) and the *user*, but
never the password, matching the existing DSO pattern which got this right.

---

## 4 · Production

### Build

```bash
# Frontend
cd web
npm ci
npm run build                     # → web/dist
pm2 start serve --name "erss_3327" -- ./dist -s -p 3327

# Backend
cd ../server
npm ci
PORT=4327 pm2 start index.js --name "erss_be_4327"

pm2 save
```

`ops/pm2/ecosystem.config.cjs` does both:

```bash
pm2 start ops/pm2/ecosystem.config.cjs && pm2 save
```

### Verify

```bash
curl -k https://erss.astrikos.xyz:8443              # the SPA HTML
curl -k https://erss-api.astrikos.xyz:8443/health   # {"status":"ok","db":"up"}
curl -k https://erss-api.astrikos.xyz:8443/version
# websocket upgrade
curl -k -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGVzdA==" \
     "https://erss-api.astrikos.xyz:8443/socket.io/?EIO=4&transport=websocket"
```

---

## 5 · nginx

Two files, one concern each. Two new blocks total.

### `astrikos.conf` — frontend (plain proxy)

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name erss.astrikos.xyz;

    location / {
        proxy_pass http://127.0.0.1:3327;
        proxy_set_header Host $host;
    }
}
```

### `astriverse.conf` — backend (REST **and** WebSocket, one block)

Requires `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` once at
the top of the file.

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name erss-api.astrikos.xyz;

    client_max_body_size 12m;          # field photos

    location / {
        proxy_pass http://127.0.0.1:4327;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 7d;
        proxy_send_timeout    7d;
        proxy_read_timeout    7d;
        proxy_buffering off;
    }
}
```

The websocket-upgrade shape serves plain HTTP transparently, which is why REST and the
socket share one block. Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### `Access-Control-Allow-Origin`

Note that the DSO frontend block carries `add_header 'Access-Control-Allow-Origin' '*'`.
**Do not copy that here.** The ERSS backend sets CORS from its own allow-list
(`CORS_ORIGINS`), and a wildcard header at the edge would both duplicate it and
undermine it. Cookie-based sessions require a specific origin and
`Access-Control-Allow-Credentials`, which `*` cannot satisfy.

---

## 6 · Environment, production

### `web/.env.production`
```
VITE_API_URL=https://erss-api.astrikos.xyz:8443
VITE_SOCKET_URL=https://erss-api.astrikos.xyz:8443
VITE_OSRM_URL=https://router.project-osrm.org
VITE_MAP_STYLE=https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
```

### `server/.env` (production)
```
PORT=4327
NODE_ENV=production
CORS_ORIGINS=https://erss.astrikos.xyz:8443
DB_HOST=127.0.0.1
DB_NAME=erss_db
DB_USER=erss
DB_PASSWORD=<set>
SESSION_SECRET=<set, 32+ random bytes>
OSRM_URL=https://router.project-osrm.org
```

`VITE_*` values are **baked into the bundle at build time**. Changing the backend
subdomain means a rebuild. Changing only its local port does not — that is the pm2
command and the nginx `proxy_pass`, nothing else. This is the same property the DSO
deployment doc calls out, and it is worth preserving.

---

## 7 · OSRM

⚠ [O-6](00-DECISIONS.md#open-items).

The public `router.project-osrm.org` is rate-limited and will throttle during a
scenario that requests many routes. Two mitigations, both built:

1. **Route cache.** `lib/routing.js` caches by rounded origin/destination pair. Scenario
   routes are pre-warmed at run start, so a demo makes almost no live calls.
2. **Self-hosted OSRM.** One Docker container with the Dubai extract:

```bash
wget https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf
docker run -t -v "${PWD}:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/gcc-states-latest.osm.pbf
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-partition /data/gcc-states-latest.osrm
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-customize /data/gcc-states-latest.osrm
docker run -d -p 5000:5000 -v "${PWD}:/data" --name osrm osrm/osrm-backend \
  osrm-routed --algorithm mld /data/gcc-states-latest.osrm
```

Then `OSRM_URL=http://127.0.0.1:5000`. **For any demo that matters, self-host.** A
throttled routing engine in front of an audience looks like a broken product.

---

## 8 · Android APK

```bash
cd web
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Toolchain: JDK 21 Temurin · Android SDK platform 36 · build-tools 36.0.0 ·
Gradle 8.14.3 · `minSdk 24`, `compileSdk`/`targetSdk 36`.

The APK's `VITE_API_URL` is baked at build time — a debug APK built for a LAN demo
points at the LAN IP and will not work elsewhere. Build one APK per environment and
label it.

Known trap from the jbvnl experience: the Gradle wrapper download can time out on a
corporate network. If it does, fetch the distribution manually and point
`gradle-wrapper.properties` at the local file.

---

## 9 · Demo-day checklist

Run this the day before, not the morning of.

- [ ] `npm run seed:verify` passes on the demo machine
- [ ] Self-hosted OSRM running and responding, or routes pre-warmed
- [ ] All six scenarios rehearsed end to end on the demo hardware
- [ ] `npm run seed:reset` returns to resting state in under 2 s — tested
- [ ] APK installed on two phones, both signed in, both on the demo network
- [ ] Phones: battery optimisation disabled for the app, screen timeout extended, do-not-disturb off
- [ ] Console open on the display at its actual resolution, video-wall mode checked
- [ ] Both themes checked on the actual projector — projectors distort dark themes badly
- [ ] Network: LAN tested, and a mobile-hotspot fallback tested
- [ ] `Ctrl+Shift+D` operator panel working; the STOP AND RESET path tested mid-scenario
- [ ] Every "simulated source" chip present where it should be — being asked "is this real data?" and having the screen already answer it is worth a great deal
- [ ] The compliance matrix printed and to hand
