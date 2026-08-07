# tests/e2e — Magic-login End-to-End Smoke (Plan 11 / Plan 12 / PR-G)

End-to-end integration gate for the WP bridge + magic-login stack. Boots
a real WordPress 6.6 site running `ashbi-agency-wp-bridge` (PR #37 +
dispatch fix from PR-F) via wp-env plus a docker-compose Postgres +
migrate + seed + hub stack, then walks the full magic-login lifecycle.

## 14 steps

| # | Step | Assertion |
|---|------|-----------|
| 1-2 | wp-env up with plugin activated + `ashbi_secret_key` configured | `wp plugin list` shows `ashbi-agency-wp-bridge active`; `wp option get ashbi_secret_key` = `test-e2e-secret-12345` |
| 3-5 | Hub stack up with matching `WP_BRIDGE_SECRET`, JWT, admin user | `GET /api/health` → 200; HMAC-signed `POST /api/wp-bridge` → 201 |
| 6-7 | Plugin → hub self-registration creates `wp_sites` row | `SELECT FROM wp_sites WHERE url = $1` returns row; `siteUuid` captured |
| 8-9 | Plugin → hub health ping updates `lastPingAt` + `lastPingStatus=ok` | `PUT /api/wp-bridge` → 200; `lastPingAt > beforeTs`; `lastPingStatus='ok'` |
| 10-11 | Hub → plugin fan-out magic-login returns URL with `?ashbi_sso=` | `POST /api/wp-bridge/fleet/magic-login` → results[0].url matches `/ashbi_sso=[a-f0-9]+/` |
| 12 | Visiting magic URL creates WP session + redirects to `/wp-admin` | `fetch(url, {redirect:'manual'})` → 302 to `/wp-admin`; followed fetch has `wordpress_logged_in` cookie |
| 13 | Audit row in BOTH plugin-side `wp_options` ring buffer + hub `wp_magic_login_log` | Plugin `ashbi_magic_login_log` option contains row with `magic_token_hash === our hash`; hub `wp_magic_login_log` has rows for `siteUrl` |
| 14 | Revoke POST with `{hash}` routes to `revoke_by_hash` (NOT `revoke`) | Plugin audit row's `magic_token_hash === our hash` (NOT `sha256(hash)`); active transient `ashbi_ml_active_<hash>` deleted; hub-side `wp_magic_login_log` has `status='revoked'` row |

Step 14 is the regression guard for the PR-F dispatch fix: if the plugin
ever reverts to passing the hub-side hash through `Ashbi_Magic_Login::revoke()`
(which would compute `sha256(hash)` and miss the active transient), the
audit row's `magic_token_hash` would differ from the hash passed and the
assertion fails.

## Source-of-truth contracts (verified against live source)

These were the bugs the verifier caught in attempt 1. All fixed:

| What | Source | Wire shape |
|------|--------|------------|
| Plugin audit option name | `OPTION_AUDIT_LOG = 'ashbi_magic_login_log'` (line 29) | `wp option get ashbi_magic_login_log` |
| Plugin active-transient prefix | `TRANSIENT_PREFIX = 'ashbi_ml_active_'` (line 27) | `wp transient get ashbi_ml_active_<sha256>` |
| Plugin audit row field name | `magic_token_hash` (line 76+) | not `tokenHash` (camelCase, JavaScript convention) |
| Plugin hash function | `hash('sha256', token)` lowercase hex | revoke_by_hash requires `^[0-9a-f]{64}$` strict |
| Plugin dispatch fix | c42795b — `revoke_by_hash($hash)` not `revoke($hash)` | Plugin-side; test asserts the audit row carries the SAME hash |
| Hub admin login response | `setCookie('token', token, httpOnly)` then `.send({user})` | token in cookie `token`, NOT in response body |
| Hub admin seed user | prisma/seed.js requires `ADMIN_SEED_PASSWORD`, creates `cameron@ashbi.ca` ADMIN | docker-compose.test.yml seed service runs the seed with `ADMIN_SEED_PASSWORD=TestPass123!` |
| Hub migrations | production docker-compose.yml uses one-shot `migrate` service | docker-compose.test.yml mirrors it; setup.sh also runs `prisma migrate deploy` from host as belt-and-suspenders |

## Files

```
tests/e2e/
├── README.md                   this file
├── docker-compose.test.yml     Postgres + migrate + seed + hub stack
├── setup.sh                    boot wp-env + compose + wait healthy
├── teardown.sh                 wipe volumes + containers
├── vitest.config.mjs           vitest runner config (single worker)
├── magic-login.test.mjs        the 14-step smoke
├── helpers/
│   ├── hmac.mjs                hub-side + plugin-side HMAC helpers
│   └── db.mjs                  Postgres assertion helpers
└── wp-env/
    ├── .wp-env.json            wp-env config (plugin mount + hub URL)
    └── setup-plugin.sh         install + activate the pinned plugin fixture
```

## Local run

```bash
# 1. one-time prereqs
brew install --cask docker        # Docker Desktop
npm ci --no-audit --no-fund

# 2. boot everything (~3 min on cold cache; <30s warm)
npm run test:e2e:setup

# 3. run the 14 steps (<90s after setup)
npm run test:e2e

# 4. wipe state for next iteration
npm run test:e2e:teardown
```

The `test:e2e` runner is single-worker, sequential, with a 30s per-step
timeout and 120s hook timeout. Total wall clock should land between 2 and
5 minutes.

## Configuration

Override via env (defaults shown):

```bash
HUB_BASE=http://localhost:3001
WP_BASE=http://localhost:8888
WP_HOME=http://localhost:8888
SHARED_SECRET=test-e2e-secret-12345   # MUST match WP_BRIDGE_SECRET in compose
ADMIN_EMAIL=cameron@ashbi.ca          # from prisma/seed.js (seed requires ADMIN_SEED_PASSWORD)
ADMIN_PASSWORD=TestPass123!
HOST_PORT=3001                          # host port for hub (set by CI to avoid collision)
HUB_DB_PORT=54329                       # host port for test Postgres
```

The `SHARED_SECRET` value flows three places:
1. Hub container env `WP_BRIDGE_SECRET` (docker-compose.test.yml).
2. Plugin option `ashbi_secret_key` (setup-plugin.sh writes it).
3. `tests/e2e/helpers/hmac.mjs` — both `signHubRequest` and `signPluginRequest` use it.

Changing one without the other breaks the HMAC chain in step 6.

## How the wire protocol maps to the test

| Direction | Path | Auth |
|-----------|------|------|
| Plugin → Hub | `POST /api/wp-bridge` | `X-Ashbi-Signature: sha256=<hmac(_timestamp+body)>` |
| Plugin → Hub | `PUT  /api/wp-bridge` | `X-Ashbi-Signature: sha256=<hmac(_timestamp+body)>` |
| Hub → Plugin | `POST /wp-json/ashbi/v1/health` | `X-ASHBI-SIGNATURE: <hmac(body)>` |
| Hub → Plugin | `POST /wp-json/ashbi/v1/magic-login` | `X-ASHBI-SIGNATURE: <hmac(body)>` |
| Hub → Plugin | `POST /wp-json/ashbi/v1/magic-login/revoke` | `X-ASHBI-SIGNATURE: <hmac(body)>` |
| Browser → WP | `GET /?ashbi_sso=<token>` | none (cookie-on-success) |
| Test → Hub | `POST /api/auth/login` | body `{email, password}`; **token comes back as httpOnly cookie** |
| Test → Hub | `POST /api/wp-bridge/fleet/magic-login` | `Authorization: Bearer <jwt-from-cookie>` |
| Test → Hub | `POST /api/wp-bridge/magic-login/revoke` | `Authorization: Bearer <jwt-from-cookie>` |

The two HMAC formats are different on purpose:
- **Hub-side** (`signHubRequest`) signs `_timestamp + body` to give the
  hub replay protection independent of body content.
- **Plugin-side** (`signPluginRequest`) signs `body` only (and the body
  carries `_timestamp` + `timestamp` fields for replay protection per
  the plugin's own logic in `class-ashbi-auth.php`).

The login flow is asymmetric too: the hub's `auth.routes.js` sends the
JWT as an httpOnly `Set-Cookie: token=...` header, with only `{user}` in
the response body. The test reads the cookie from `res.headers.getSetCookie()`
and uses it as a bearer token for subsequent admin endpoints.

## CI

`.github/workflows/e2e.yml` runs this on PRs that touch any of:
`tests/e2e/**`, `prisma/**`, `src/routes/wp-bridge.routes.js`,
`src/services/wpBridge.service.js`, `src/validators/wp-bridge*`,
`Dockerfile`, `docker-compose*.yml`, `package.json`, or the workflow
itself. Manual dispatch available.

## Why wp-env and not bare WordPress

wp-env gives us a reproducible WordPress 6.6 + MariaDB stack with a
plugin-mount directory we control, plus a `tests-cli` wp-cli container
for reading plugin options (`ashbi_magic_login_log`, `ashbi_secret_key`)
without writing PHP. The 30-line lifecycle script in
`wp-env/setup-plugin.sh` is the only WordPress-specific glue.

## Why vitest

Vitest 4.x is already in `devDependencies` (the unit suite is
`node:test`). This test needs `fetch`, `setTimeout`, and shared state
across steps, which `node:test` handles fine but vitest's `expect.toMatch`
+ verbose reporter is friendlier for the file:line failure evidence the
acceptance criteria require.

## Known limitations

- Requires Docker Desktop or compatible (the wp-env + compose stack
  needs ~3GB RAM on Linux runners).
- The plugin is a pinned local fixture. Update it deliberately with its
  `UPSTREAM.md` provenance rather than depending on a moving remote branch.
- Tests run sequentially — no `fileParallelism` — because step 7
  depends on the `wp_sites` row step 6 created, step 9 reads
  `lastPingAt` step 8 set, step 13 reads the audit row step 10 wrote, etc.
- The migrate + seed services do a full locked `npm ci` inside the
  container (the production Dockerfile uses `--omit=dev` so the prisma
  CLI isn't present). On a warm cache that's ~30s; cold cache ~90s.
  Total boot target: 2-3 min warm, <5 min cold.
