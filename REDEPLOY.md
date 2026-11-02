# ERSS Dubai — redeploy over a running deployment

`DEPLOY.md` is the **first** deploy: it creates the pm2 processes, writes the nginx
blocks and seeds an empty database. This file is the **second and every later** deploy —
the ports, the nginx blocks, the database and `server/.env` already exist and must
survive. Everything here assumes `DEPLOY.md` §1–§5 has been done once already.

Nothing in `DEPLOY.md` is contradicted here. Where this file is shorter, it is because
the step is already done on the server and must not be redone.

| | First deploy (`DEPLOY.md`) | Redeploy (this file) |
| --- | --- | --- |
| nginx | write the two blocks | `nginx -t` + reload only |
| pm2 | `pm2 start` | `pm2 stop` → `pm2 start` → `pm2 save` |
| database | `db:schema` + `db:views` + `seed` | `db:schema` + `db:views`, **no reseed** |
| `server/.env` | create from the template | **leave untouched** |
| Cloudflare | set Orange / Gray | nothing |

---

## 0 · The one thing that breaks a redeploy

**`server/.env` on the server holds the production secrets. The copy in this repo is the
development one.** Overwrite it and `server/config/env.js` refuses to boot — it demands
`SESSION_SECRET` (32+ chars), `EID_HASH_SALT` and `DB_PASSWORD`, and rejects a
`CORS_ORIGINS` containing `*`. The failure surfaces as a pm2 crash loop, not as a bad
file copy, so it costs more to diagnose than it should.

`ops/scripts/package-release.ps1` therefore **cannot** put that file in the bundle. If
you upload by some other means — WinSCP, a drag into the folder, `rsync` without
`--exclude` — exclude `server/.env` by hand, and take a copy first:

```bash
cp ~/erss/server/.env ~/erss-env-$(date +%F).bak
```

`web/.env.production` is the opposite case: it holds no secret, it is what bakes
`erss-api.astrikos.xyz:8443` into the bundle, and it **must** ship.

---

## 1 · On this machine — build the bundle

```powershell
.\ops\scripts\package-release.ps1
```

Runs `DEPLOY.md` §7's four gates (`audit:env`, `typecheck`, `lint`, `build`), refuses to
package if any of them fails, then writes `ops/release/erss-<stamp>.tar.gz` — source
only. After writing it verifies that `node_modules`, `server/.env` and `web/dist` are
absent from the archive. About 9 MB.

`node_modules` is excluded because the server reinstalls it: the Windows tree carries
Windows-native rollup and bcrypt binaries that do not run on Linux. `web/dist` is
excluded because step 3 rebuilds it there.

```bash
scp ops/release/erss-<stamp>.tar.gz user@astrikos.xyz:/tmp/
```

---

## 2 · On the server — replace the files

Keep the old tree until §7 has passed; it is the rollback.

```bash
cd ~
mv erss erss-prev                       # the rollback, one command away
mkdir erss && tar -xzf /tmp/erss-<stamp>.tar.gz -C erss

cp erss-prev/server/.env erss/server/.env      # the production secrets, carried across
```

That `cp` is not optional — the new tree has no `server/.env` in it at all. Confirm
before going further:

```bash
test -s erss/server/.env && echo "env present"
grep -q '^SESSION_SECRET=.\{32,\}' erss/server/.env && echo "secret looks set"
```

---

## 3 · Install and build

```bash
cd ~/erss
npm ci                 # the root is an npm workspace: installs web AND server in one pass
npm run build          # tsc -b && vite build -> web/dist
```

`npm ci` at the root is enough — `package.json` declares `workspaces: ["web","server"]`,
so the two `npm ci` calls in `DEPLOY.md` §4 collapse into this one. It deletes and
rebuilds `node_modules` from `package-lock.json`; use `npm ci`, never `npm install`, so
the server gets the resolved tree this release was tested against.

A `vite build` warning about `@__PURE__` comment position inside `node_modules/zod` is
expected and harmless, as is `Generated an empty chunk: "three"`. `web/dist` should come
out around 12 MB: ~3.2 MB of hashed JS/CSS in `assets/`, the rest the copied `brand/`,
`media/` and self-hosted `fonts/`.

---

## 4 · Database — schema forward, data intact

The schema is additive and idempotent. Re-run it: this release's `ALTER TABLE … ADD
COLUMN IF NOT EXISTS` statements (`users.username`, `incidents.is_resting`,
`assignments.route_hospital*`) are how an already-populated database catches up.

```bash
cd ~/erss/server
npm run db:schema      # additive ALTERs + indexes, safe on live data
npm run db:views       # analytic views, CREATE OR REPLACE
```

**Do not run `npm run seed`.** On a populated database it regenerates all 24 months of
history. You do not need it: the backend carries the existing history forward to "now" at
start-up (`HISTORY_CATCHUP=on`), so the dashboard is current the moment §5 finishes.

Two exceptions, both deliberate:

```bash
npm run seed:reference   # only to restore the demo-account passwords (DEPLOY.md §3)
npm run seed             # only when you WANT a fresh 24-month dataset
```

If `db:schema` fails on a `DO $$ … $$` block because plpgsql is unavailable, apply the
two statements this release adds by hand — they are written out in `DEPLOY.md` §3.

---

## 5 · pm2 — stop, start, save

```bash
cd ~/erss
pm2 stop erss_3327 erss_be_4327
pm2 start ops/pm2/ecosystem.config.cjs
pm2 save
```

`pm2 save` is what survives a server reboot; skipping it means the processes come back as
whatever the *previous* release registered.

If pm2 complains that the names are already in its list, clear them and start fresh — the
config file is the authority on both ports and both names:

```bash
pm2 delete erss_3327 erss_be_4327
pm2 start ops/pm2/ecosystem.config.cjs && pm2 save
```

Restart, not `pm2 reload`. The backend is `instances: 1`, fork mode on purpose: the
simulation clock, the dispatch engine and the socket rooms are in-process state, and a
reload's overlap would briefly run two simulations against one database.

```bash
pm2 status                                    # both online, restart counts not climbing
pm2 logs erss_be_4327 --lines 40 --nostream   # listening on 4327, no env validation error
```

A backend that exits immediately and restarts forever is almost always §0 — the wrong
`server/.env`.

---

## 6 · nginx

The two blocks are already in place from the first deploy and the ports have not changed,
so there is nothing to edit. Test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
systemctl status nginx --no-pager
```

`reload` over `restart`: it re-reads the config without dropping live connections — which
matters here, because the backend block carries the websocket. Use
`sudo systemctl restart nginx` only if a reload will not take.

Edit a block only if a **port or subdomain** moved — and a changed subdomain means
`web/.env.production` changes and §1–§3 must run again, because that value is baked into
the bundle at build time.

Cloudflare needs nothing: `erss.astrikos.xyz` stays Orange, `erss-api.astrikos.xyz` stays
Gray.

---

## 7 · Verify, then drop the rollback

```bash
curl -k https://erss.astrikos.xyz:8443                 # the SPA HTML
curl -k https://erss-api.astrikos.xyz:8443/health      # {"status":"ok","database":"up",…}
curl -k https://erss-api.astrikos.xyz:8443/version     # startedAt = the restart you just did

curl -k -X POST https://erss-api.astrikos.xyz:8443/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"identifier":"admin","password":"Astrikos2026"}'

curl -k -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGVzdA==" \
     "https://erss-api.astrikos.xyz:8443/socket.io/?EIO=4&transport=websocket"   # expect 101
```

`/version` reports a pinned `1.0.0`, so it does not identify the release — read its
`startedAt` instead, which proves the process restarted when you think it did.

Then in a browser, because the curls cannot see this part: sign in at
`https://erss.astrikos.xyz:8443` as `admin` / `Astrikos2026`. Within about 45 seconds a
camera raises a road collision, the map flies to it and the right rail opens on the AI log
by itself. Hard-refresh once first — a rebuild changes every asset hash, so a cached
`index.html` pointing at the previous release's assets renders a blank screen.

- [ ] `pm2 status` — both online, restart counts flat
- [ ] `/health` reports `database: up`
- [ ] `/version` `startedAt` matches this deploy
- [ ] the websocket upgrade answers 101
- [ ] `admin` signs in and the Dashboard renders
- [ ] a collision raises itself within ~45s
- [ ] `/app` loads on a phone
- [ ] `pm2 save` was run

Only then:

```bash
rm -rf ~/erss-prev
```

---

## 8 · Rollback

Three commands, because §2 kept the tree and §0 kept the secrets:

```bash
cd ~ && rm -rf erss && mv erss-prev erss
cd erss && pm2 stop erss_3327 erss_be_4327 && pm2 start ops/pm2/ecosystem.config.cjs && pm2 save
```

`node_modules` and `web/dist` come back with the old tree, so there is nothing to
reinstall and nothing to rebuild.

The database does **not** roll back, and it does not need to: §4 only ever adds nullable
columns and indexes, which the previous release simply ignores.
