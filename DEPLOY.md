# ERSS Dubai — deployment

Everything needed to put this POC on `astrikos.xyz`. Written against
`deployment_context.md`, which is the authoritative convention; this file is that
convention with ERSS's two ports filled in. The longer background (local development,
the database, backup, the mobile APK) is `docs/12-DEPLOYMENT.md`.

> **Deploying on Hostinger instead?** See [`HOSTINGER.md`](HOSTINGER.md). There the app
> runs as one process on one port (the backend also serves the built frontend), and none
> of the two-port / nginx setup below applies.

> This file replaced the DSO deployment notes that used to sit here. Those described
> the retired **three**-file / three-port scheme (`fastapi` + a separate socket port).
> ERSS uses the current one: **two ports, two nginx files, one backend**.

---

## 1 · The two ports

ERSS holds slot **27**. Frontend `33`27, backend `43`27 — the tier is the hundreds
digit, the POC is the last two digits.

| Piece | Port | Subdomain | pm2 name | Cloudflare |
| --- | --- | --- | --- | --- |
| Frontend — static SPA from `web/dist` | **3327** | `erss.astrikos.xyz` | `erss_3327` | **Orange** (proxied) |
| Backend — REST **and** websocket, one process | **4327** | `erss-api.astrikos.xyz` | `erss_be_4327` | **Gray** (DNS-only) |

**One backend, one port, one nginx block.** REST and Socket.IO share a single Express
`http.Server` (`server/index.js`), so there is no separate socket port, no separate API
port and no `fastapi` file. The backend subdomain is Gray because it carries websockets.

Both subdomains are served on **:8443**, which is where the wildcard cert listens.

### Port registry

Append the row before deploying anything new, so a pair is never reused.

| POC | Frontend | Backend | Status |
| --- | --- | --- | --- |
| dso | 3301 | 4301 | live |
| **erss** | **3327** | **4327** | **ready to deploy** |

---

## 2 · Environment — nothing is hardcoded

`npm run audit:env` proves it: no host, IP or port literal exists in `web/src` or
`server/` outside `server/config/env.js`, `server/config/jurisdiction.js` and
`web/vite.config.ts`. It passes clean and is worth running before every deploy.

### Frontend — `VITE_API_URL` / `VITE_SOCKET_URL` at build time

`web/.env.production` is committed with **empty** API/socket URLs (same origin, the
Hostinger layout) and the map/OSRM defaults. For this split layout, pass the backend
subdomain as environment variables at build time. Real env vars override the file:

```
VITE_API_URL=https://erss-api.astrikos.xyz:8443
VITE_SOCKET_URL=https://erss-api.astrikos.xyz:8443
```

Both URLs are the same host — one backend. Nothing secret may go in this file; it is
served to the browser. `web/.env` stays empty-valued for development, where Vite's proxy
gives the browser one origin so cookies and CORS behave exactly as they do behind nginx.

The bundle addresses the backend by **subdomain**, never by port, so renumbering the
backend's local port needs no rebuild — only `ops/pm2/ecosystem.config.cjs` and the nginx
`proxy_pass`. Changing the **subdomain** does need a rebuild.

### Backend — `server/.env` on the server

Copy `server/.env.production.example` to `server/.env` and fill the four blanks
(`DB_PASSWORD`, `SESSION_SECRET`, `EID_HASH_SALT`, and `OSRM_URL` if self-hosting).
The process loads `.env` and only `.env` — a file named `.env.production` would be read
by nobody.

```
PORT=4327
NODE_ENV=production
CORS_ORIGINS=https://erss.astrikos.xyz:8443      # scheme, host AND port. Never `*`.
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=erss_db
DB_USER=erss
DB_PASSWORD=<set>
SESSION_SECRET=<48 random bytes>
EID_HASH_SALT=<32 random bytes>
```

`server/config/env.js` **refuses to start** in production without `SESSION_SECRET`
(32+ chars), `EID_HASH_SALT` and `DB_PASSWORD`, or with `CORS_ORIGINS` containing `*` —
a cookie session needs a specific origin plus `Allow-Credentials`, which `*` cannot
satisfy. Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 3 · Database

PostgreSQL 16 + PostGIS. Schema and seed are idempotent; run them in this order.

```bash
cd server
npm run db:schema      # tables, indexes, additive ALTERs — safe to re-run
npm run db:views       # analytic views
npm run seed           # reference data, 24 months of history, derived tables
npm run seed:verify    # asserts row counts and geometry sanity
```

`db:schema` needs **plpgsql** available to the server (it uses `DO $$ … $$` blocks for
the idempotent constraint adds). On a host where plpgsql is blocked, the two statements
this release adds can be applied on their own:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username))
  WHERE username IS NOT NULL;
```

Seeded history ends at the moment `seed` ran; the backend extends it to "now" at start-up
(`HISTORY_CATCHUP=on`), so today's figures are never empty.

### Demo accounts

Written by `npm run seed:reference`, listed once in `web/src/lib/demoAccounts.ts`, and
shown on both login screens so a demonstration never depends on a password read aloud.

| Sign in as | Password | Surface | Reaches |
| --- | --- | --- | --- |
| `admin` | `Astrikos2026` | console `/` | **everything** — every capability, every page |
| `DSP-4A1C` | `erss2026` | console `/` | Dashboard, Live operations, Command Centre |
| `DUT-1F09` | `erss2026` | console `/` | as dispatcher, plus dispatch rules |
| `LED-2C55` | `erss2026` | console `/` | Insights and the analytical pages |
| `RSP-AMB14` | `erss2026` | app `/app` | paramedic, bound to AMB-14 |
| `CIT-71BE` | `erss2026` | app `/app` | citizen |

The login field takes a **username**, a ref, an email or a phone number. `admin` is a
username; the rest are refs. Re-running the seed restores these passwords.

---

## 4 · Build and run

```bash
# ── Frontend ──────────────────────────────────────────────────────────────
cd web
npm ci
VITE_API_URL=https://erss-api.astrikos.xyz:8443 VITE_SOCKET_URL=https://erss-api.astrikos.xyz:8443 npm run build                     # tsc -b && vite build → web/dist
pm2 start serve --name "erss_3327" -- ./dist -s -p 3327

# ── Backend (REST + websocket, one port) ──────────────────────────────────
cd ../server
npm ci
PORT=4327 pm2 start index.js --name "erss_be_4327"

pm2 save
```

Or both at once, which is the same thing with the names and ports already filled in:

```bash
pm2 start ops/pm2/ecosystem.config.cjs && pm2 save
```

`serve -s` is not optional: every unknown path must return `index.html` or `/dashboard`
and `/app` break on refresh — the SPA owns its routing (`web/src/lib/router.ts`).

The backend runs as **one** process (`instances: 1`, fork mode). The simulation clock, the
dispatch engine and the socket rooms are in-process state; a second instance would run a
second simulation against the same database and fight the first over it.

---

## 5 · nginx — two blocks

### `/etc/nginx/conf/astrikos.conf` — frontend

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

> The DSO frontend block carries `add_header 'Access-Control-Allow-Origin' '*'`.
> **Do not copy that here.** The ERSS backend sets CORS from its own allow-list, and a
> wildcard at the edge would both duplicate and undermine it.

### `/etc/nginx/conf/astriverse.conf` — backend, REST **and** websocket

Needs this once at the top of the file:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name erss-api.astrikos.xyz;

    client_max_body_size 12m;          # field photos from the responder app

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

The websocket-upgrade shape serves plain HTTP transparently, which is why one block
carries both REST and the socket.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Cloudflare DNS

- `erss.astrikos.xyz` → **Orange** (proxied)
- `erss-api.astrikos.xyz` → **Gray** (DNS-only) — websockets bypass CF and hit nginx
  `:8443` directly

---

## 6 · Verify

```bash
curl -k https://erss.astrikos.xyz:8443                 # the SPA HTML
curl -k https://erss-api.astrikos.xyz:8443/health      # {"status":"ok","database":"up",…}
curl -k https://erss-api.astrikos.xyz:8443/version

# the administrator signs in
curl -k -X POST https://erss-api.astrikos.xyz:8443/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"identifier":"admin","password":"Astrikos2026"}'

# websocket upgrade (expect 101)
curl -k -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGVzdA==" \
     "https://erss-api.astrikos.xyz:8443/socket.io/?EIO=4&transport=websocket"
```

Then in a browser: `https://erss.astrikos.xyz:8443` → sign in as `admin` /
`Astrikos2026` → the Dashboard. Within about 45 seconds of a sign-in (or of pressing
**Restart PoC**) a camera raises a road collision, the map flies to it and the right rail
opens on the AI log by itself. `/app` on a phone shows the field app's login with its own
demo accounts.

---

## 7 · Pre-flight checklist

```bash
npm run audit:env     # no host/IP/port literal outside configuration   → PASS
npm run typecheck     # → clean
npm run lint          # → clean
npm run build         # → web/dist
```

- [ ] Registry row added (§1), ports not reused
- [ ] Frontend built with `VITE_API_URL` / `VITE_SOCKET_URL` = `https://erss-api.astrikos.xyz:8443`
- [ ] `server/.env` present on the server with the four secrets filled
- [ ] `CORS_ORIGINS` is exactly `https://erss.astrikos.xyz:8443`
- [ ] Schema + seed applied; `npm run seed:verify` clean
- [ ] Both pm2 processes up, `pm2 save` run
- [ ] Both nginx blocks added, `nginx -t` clean, nginx reloaded
- [ ] Cloudflare: frontend Orange, backend Gray
- [ ] All six curls in §6 answer
