# ERSS Dubai — deploying on Hostinger

On Hostinger the whole product runs as **one Node.js process on one port**: the backend
serves the REST API, the Socket.IO realtime channel **and** the built frontend
(`web/dist`). There is no second port, no nginx block to write and no separate API
subdomain. The browser talks to one origin, so cookies, CORS and websockets need no setup.

| Setting | Value |
| --- | --- |
| Node.js version | **22.x** (or 24.x). Needs ≥ 22.9 |
| Install | `npm install` (Hostinger's default) |
| Build command | `npm run build` → `web/dist` |
| Start command / entry file | `npm start` / **`server.js`** (repo root) |
| Port | whatever Hostinger sets in `PORT`. Nothing to configure |

**The database is PostgreSQL 16 + PostGIS.** Hostinger's web and cloud hosting include
only MySQL, which this app cannot use. You need a Postgres that has PostGIS:

- **Hostinger Node.js web app** (Business / Cloud plans): use a managed Postgres from
  somewhere else, e.g. [Neon](https://neon.tech) or [Supabase](https://supabase.com).
  Both have free tiers and support PostGIS. See §1.
- **Hostinger VPS**: install Postgres + PostGIS on the VPS itself. See §2.

---

## 1 · Hostinger Node.js web app (hPanel, deploy from GitHub)

### 1a. Create the database (Neon example)

1. Create a project at neon.tech. Pick a region close to your Hostinger server.
2. Copy the connection string. It looks like
   `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.

PostGIS does not need to be enabled by hand: `schema.sql` runs
`CREATE EXTENSION IF NOT EXISTS postgis` itself.

### 1b. Create the web app

hPanel → **Websites → Add website → Node.js Apps → Import Git repository**. Choose this
repository and branch `main`. Then:

- Framework: **Express** (or *Other*)
- Node version: **22.x**
- Root directory: `/` (the repository root)
- Entry file: `server.js`
- Build command: `npm run build`
- Start command: `npm start`

### 1c. Environment variables

Add these in the app's **Environment variables** section:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the connection string from 1a |
| `DB_AUTO_SETUP` | `true` — builds the schema and seeds the demo data on first boot |
| `SESSION_SECRET` | 48 random bytes, see below |
| `EID_HASH_SALT` | 32 random bytes, see below |

Generate each secret on any machine with Node:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`CORS_ORIGINS` is **not** needed. The frontend is served from the same origin as the API.
Only set it if some *other* site must call this API.

### 1d. Deploy and wait for the first seed

Click **Deploy**. The API comes up immediately. On the first boot `DB_AUTO_SETUP` builds
the database in the background: it applies the schema and views, then generates 24 months
of history. That takes a few minutes, and the logs show `[setup:…]` lines until
`[setup] database ready`. Later boots see the schema and skip this step, so the flag can
stay on.

If the host's memory or time limits cut the seed short, generate less history by adding
`SEED_MONTHS=6`. Or seed from your own machine instead: put the same `DATABASE_URL` in
`server/.env` locally and run `npm run setup:db`.

### 1e. Check it

```bash
curl https://<your-domain>/health       # {"status":"ok","database":"up","postgis":"3.x",…}
curl https://<your-domain>/version
```

Then open `https://<your-domain>` and sign in as `admin` / `Astrikos2026`. The field app
is at `/app`. All demo accounts are listed in `DEPLOY.md` §3.

`/health` returning `"database":"down"` includes the reason in `detail`. It is almost
always a wrong `DATABASE_URL`, or the database still being set up.

---

## 2 · Hostinger VPS (Ubuntu)

```bash
# Node 22, PostgreSQL 16 + PostGIS, pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-contrib postgis nginx
sudo npm i -g pm2

# Database + role
sudo -u postgres psql -c "CREATE ROLE erss LOGIN PASSWORD '<db-password>';"
sudo -u postgres psql -c "CREATE DATABASE erss_db OWNER erss;"
sudo -u postgres psql -d erss_db -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# App
git clone https://github.com/productastrikos/ERSS.git && cd ERSS
cp server/.env.example server/.env    # set NODE_ENV=production, DB_PASSWORD, SESSION_SECRET, EID_HASH_SALT
npm install
npm run build
npm run setup:db                      # schema + views + seed
PORT=3000 pm2 start server.js --name erss && pm2 save && pm2 startup
```

nginx (`/etc/nginx/sites-available/erss`, then symlink into `sites-enabled`). The
upgrade headers carry the websocket:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1d;
        proxy_buffering off;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your-domain.com
```

The process must stay **one** instance (pm2 fork mode, no cluster). The simulation clock
and the socket rooms are in-process state.

---

## Updating

Push to `main`. On the web app, click **Redeploy** (or turn on auto-deploy). On a VPS, run
`git pull && npm install && npm run build && pm2 restart erss`.
