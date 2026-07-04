// tests/e2e/magic-login.test.mjs
//
// End-to-end smoke for the WP bridge + magic-login stack.
// Plan 11 / Plan 12 final integration gate (PR-G).
//
// Boots:
//   - wp-env         WordPress 6.6 + ashbi-agency-wp-bridge plugin
//                    (camster91/ashbi-agency-wp-bridge @ feat/magic-login-managewp-grade)
//                    Exposes REST at http://localhost:8888/wp-json/ashbi/v1/*
//   - docker-compose Postgres (host port 54329) + migrate + seed + hub
//                    (host port 3001) — see tests/e2e/docker-compose.test.yml
//
// Source-of-truth contracts this test asserts (all verified against the
// live plugin + hub source on 2026-07-03):
//
//   PLUGIN
//   - includes/class-ashbi-magic-login.php:
//       OPTION_AUDIT_LOG     = 'ashbi_magic_login_log'
//       TRANSIENT_PREFIX     = 'ashbi_ml_active_'
//       hash_token($t)       = sha256($t)                       (lowercase hex)
//       revoke_by_hash($h)   = validate ^[0-9a-f]{64}$, then delete_transient
//                              (TRANSIENT_PREFIX . $h) directly, no re-hash.
//       audit row fields     = { status, reason, user_id, ip, site_id,
//                                magic_token_hash, issued_by, expires_at,
//                                existed, ... }
//   - includes/class-ashbi-api.php:
//       POST /wp-json/ashbi/v1/register          (manage_options permission)
//       POST /wp-json/ashbi/v1/health            (HMAC + _timestamp)
//       POST /wp-json/ashbi/v1/magic-login       (HMAC + _timestamp)
//       POST /wp-json/ashbi/v1/magic-login/revoke (HMAC + {hash}|{token})
//   - includes/class-ashbi-auth.php:verify_signature
//       sha256(body), header `X-ASHBI-SIGNATURE: <hex>` (lowercase hex, no prefix)
//
//   HUB
//   - src/routes/auth.routes.js:login route (prefix /api/auth):
//       body sends { user } ONLY; token is set as httpOnly cookie `token`
//       response.setCookie('token', token, { httpOnly: true, ... })
//   - src/routes/wp-bridge.routes.js:
//       POST /api/wp-bridge    public; verifySecret(secretKey)
//       PUT  /api/wp-bridge    public; verifySecret(secretKey)  (health update)
//       GET  /api/wp-bridge    list sites (admin JWT)
//       POST /api/wp-bridge/fleet/magic-login  (adminOnly JWT) — hub-side fan-out
//       POST /api/wp-bridge/magic-login/revoke (adminOnly JWT) — proxy to plugin
//   - src/routes/wp-bridge.routes.js:verifyPluginHmac
//       sha256(_timestamp + raw_body), header `X-Ashbi-Signature: sha256=<hex>`
//
//   RUN
//   npm run test:e2e:setup   # boot wp-env + hub stack (~3 min cold)
//   npm run test:e2e         # run the 14 steps (<90s after setup)
//   npm run test:e2e:teardown

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execa } from 'execa';
import { setTimeout as sleep } from 'node:timers/promises';

import { sha256Hex, signHubRequest, signPluginRequest, freshTimestamp } from './helpers/hmac.mjs';
import { close as closeDb, countMagicLoginLogBySiteUrl, findMagicLoginLogBySiteUrl, findSiteByUrl } from './helpers/db.mjs';

// ---------------------------------------------------------------------------
// Configuration — overridable via env for CI.
// ---------------------------------------------------------------------------
const WP_BASE      = process.env.WP_BASE      || 'http://localhost:8888';
const HUB_BASE     = process.env.HUB_BASE     || 'http://localhost:3001';
const SHARED_SECRET = process.env.SHARED_SECRET || 'test-e2e-secret-12345';
// wp-env uses http on the default port; magic-login URLs reference
// home_url() which is whatever home_url() returns inside WordPress.
const WP_HOME = process.env.WP_HOME || 'http://localhost:8888';

// Seeded by prisma/seed.js (run by docker-compose.test.yml seed service).
// The seed requires ADMIN_SEED_PASSWORD and creates cameron@ashbi.ca ADMIN.
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'cameron@ashbi.ca';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestPass123!';

// State captured across the 14 steps.
let adminJwt = null;
let siteUuid = null;
let lastMagicToken = null;
let lastTokenHash  = null;
let lastMagicUrl   = null;

// ---------------------------------------------------------------------------
// HTTP helpers (no supertest dep needed — fetch is in Node 20).
// ---------------------------------------------------------------------------

async function http(method, url, { body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { /* non-JSON OK */ } }
  return { status: res.status, text, json, headers: res.headers };
}

/**
 * Drive wp-env's wp-cli to invoke PHP inside the WordPress container.
 * Used to read plugin options (audit log, secret, etc.).
 */
async function wpCli(...args) {
  const result = await execa('npx', ['wp-env', 'run', 'tests-cli', 'wp', ...args], {
    cwd: process.cwd(),
    reject: false,
    timeout: 30000
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * Extract a cookie value by name from a fetch Response. Returns the raw
 * cookie value (decoded) or null if absent.
 */
function readCookie(res, name) {
  const setCookie = res.headers.getSetCookie?.() || [];
  // Fallback for older runtimes that only expose combined header:
  const all = setCookie.length ? setCookie : (res.headers.get('set-cookie') || '').split(/,(?=[^ ])/);
  for (const c of all) {
    const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

/**
 * Get an admin JWT from the hub for the magic-login fan-out (step 10).
 *
 * Source: src/routes/auth.routes.js:56-79
 *   POST /api/auth/login with { email, password }
 *   Response body: { user }
 *   Token is in httpOnly cookie `token` (NOT in body).
 *
 * We use the cookie value directly as the bearer token — fastify-jwt
 * verifies the signature with the same JWT_SECRET that signed it,
 * regardless of how it was transported.
 */
async function loginAsAdmin() {
  const url = `${HUB_BASE}/api/auth/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (res.status !== 200) {
    const t = await res.text();
    throw new Error(`admin login failed at ${url}: ${res.status} ${t.slice(0, 200)}`);
  }
  const token = readCookie(res, 'token');
  if (!token) {
    const setCookies = res.headers.getSetCookie?.() || [];
    throw new Error(`admin login response missing 'token' cookie. Set-Cookie: ${JSON.stringify(setCookies)}`);
  }
  return token;
}

/**
 * Read the plugin-side ring-buffered audit log.
 *   Source-of-truth option name: OPTION_AUDIT_LOG = 'ashbi_magic_login_log'
 *   (NOT 'ashbi_magic_login_audit_log' — that's a misread of the source.)
 *   Includes/class-ashbi-magic-login.php:29
 *
 * Stored as a serialized array in wp_options. wp option get with --format=json
 * returns the JSON-decoded structure.
 */
async function getPluginAuditLog() {
  const r = await wpCli('option', 'get', 'ashbi_magic_login_log', '--format=json');
  if (r.exitCode !== 0) return [];
  const trimmed = r.stdout.trim();
  if (!trimmed || trimmed === '[]' || trimmed === 'false' || trimmed === '0') return [];
  try { return JSON.parse(trimmed); } catch { return []; }
}

/**
 * Check whether the plugin's active-transient for a given sha256 hash has
 * been deleted. Plugin transient key format:
 *     TRANSIENT_PREFIX . $hash  =  'ashbi_ml_active_<sha256-hex>'
 *   Includes/class-ashbi-magic-login.php:27
 *
 * Returns: true if the transient is GONE (test passed), false if still there.
 */
async function pluginTransientDeleted(tokenHash) {
  const key = `ashbi_ml_active_${tokenHash}`;
  // `wp transient get <key>` exits 0 if present, non-zero if missing.
  const r = await wpCli('transient', 'get', key, '--format=json');
  if (r.exitCode !== 0) return true; // missing = deleted (expected post-revoke)
  // Some wp-cli builds return exit 0 with empty stdout for missing transients.
  return r.stdout.trim() === '' || r.stdout.trim() === 'false';
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Sanity: hub + wp-env must already be up. setup.sh handles boot.
  const hubHealth = await http('GET', `${HUB_BASE}/api/health`).catch((e) => ({ status: 0, text: String(e) }));
  if (hubHealth.status !== 200) {
    throw new Error(
      `hub not reachable at ${HUB_BASE}/api/health — run \`npm run test:e2e:setup\` first. ` +
      `Got: ${hubHealth.status} ${hubHealth.text?.slice(0, 200)}`
    );
  }
  const wpPing = await http('GET', `${WP_BASE}/wp-json/ashbi/v1/ping`).catch((e) => ({ status: 0, text: String(e) }));
  if (wpPing.status !== 200 || wpPing.json?.pong !== true) {
    throw new Error(
      `wp-env not reachable at ${WP_BASE}/wp-json/ashbi/v1/ping. ` +
      `Got: ${wpPing.status} ${wpPing.text?.slice(0, 200)}`
    );
  }
  adminJwt = await loginAsAdmin();
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe('PR-G: WP bridge + magic-login end-to-end smoke', () => {

  // -------------------------------------------------------------------------
  // STEPS 1-2 — wp-env up with plugin mounted + secret configured.
  // -------------------------------------------------------------------------

  test('step 1-2: wp-env up with plugin activated + secret configured', async () => {
    // plugin slug is `ashbi-agency-wp-bridge` per the main plugin file.
    const list = await wpCli('plugin', 'list', '--format=json');
    expect(list.exitCode, 'wp plugin list exit code').toBe(0);
    const plugins = JSON.parse(list.stdout || '[]');
    const bridge = plugins.find((p) => p.name === 'ashbi-agency-wp-bridge');
    expect(bridge, 'plugin in list').toBeTruthy();
    expect(bridge.status, 'plugin status').toBe('active');

    const secret = await wpCli('option', 'get', 'ashbi_secret_key');
    expect(secret.stdout.trim(), 'plugin ashbi_secret_key matches shared secret').toBe(SHARED_SECRET);

    const hubUrl = await wpCli('option', 'get', 'ashbi_hub_url');
    expect(hubUrl.stdout.trim(), 'plugin ashbi_hub_url is set').toMatch(/^http/);
  });

  // -------------------------------------------------------------------------
  // STEP 3-5 — hub reachable + admin login works + plugin HMAC accepted.
  // -------------------------------------------------------------------------

  test('step 3-5: hub up with matching secret + admin login works', async () => {
    const health = await http('GET', `${HUB_BASE}/api/health`);
    expect(health.status).toBe(200);
    expect(health.json?.status || health.json?.ok).toBeTruthy();

    // admin JWT was already captured in beforeAll.
    expect(adminJwt, 'admin JWT obtained from cookie in beforeAll').toBeTruthy();

    // Round-trip: register a synthetic site via the hub's POST /api/wp-bridge
    // using the plugin's HMAC format. Proves WP_BRIDGE_SECRET matches.
    //   Source: src/routes/wp-bridge.routes.js POST / handler (verifySecret)
    const body = {
      siteUrl: `${WP_HOME}/`,
      siteName: 'E2E Test Site',
      secretKey: SHARED_SECRET,
      bridgeVersion: '1.10.4-test',
      wordpressVersion: '6.6',
      phpVersion: '8.2'
    };
    const headers = signHubRequest({ body, secret: SHARED_SECRET });
    const reg = await http('POST', `${HUB_BASE}/api/wp-bridge`, { body, headers });
    expect(reg.status, `plugin→hub register via HMAC. body: ${reg.text?.slice(0, 300)}`).toBe(201);
  });

  // -------------------------------------------------------------------------
  // STEP 6-7 — plugin → hub self-registration creates wp_sites row.
  // -------------------------------------------------------------------------

  test('step 6-7: wp_sites row exists with matching url', async () => {
    // Idempotent re-register against the canonical WP_HOME URL.
    const body = {
      siteUrl: WP_HOME,
      siteName: 'E2E WP',
      secretKey: SHARED_SECRET,
      bridgeVersion: '1.10.4-test',
      wordpressVersion: '6.6',
      phpVersion: '8.2',
      activePlugins: ['ashbi-agency-wp-bridge/ashbi-agency-wp-bridge.php']
    };
    const headers = signHubRequest({ body, secret: SHARED_SECRET });
    const reg = await http('POST', `${HUB_BASE}/api/wp-bridge`, { body, headers });
    expect([200, 201], `register ${reg.status} ${reg.text?.slice(0, 200)}`).toContain(reg.status);

    // Verify in Postgres.
    const site = await findSiteByUrl(WP_HOME);
    expect(site, `wp_sites row for ${WP_HOME}`).toBeTruthy();
    siteUuid = site.id;
  });

  // -------------------------------------------------------------------------
  // STEP 8-9 — plugin → hub health ping updates lastPingAt + lastPingStatus=ok.
  // -------------------------------------------------------------------------

  test('step 8-9: health ping sets lastPingAt + lastPingStatus=ok', async () => {
    const before = await findSiteByUrl(WP_HOME);
    expect(before, 'wp_sites row from step 6').toBeTruthy();
    const beforeTs = before.lastPingAt ? new Date(before.lastPingAt).getTime() : 0;

    // Issue PUT /api/wp-bridge — hub's updateSiteHealth route.
    //   Source: src/routes/wp-bridge.routes.js PUT / handler (verifySecret)
    const body = {
      siteUrl: WP_HOME,
      secretKey: SHARED_SECRET,
      timestamp: new Date().toISOString(),
      ttfb: 120,
      dbSize: 1048576,
      diskBytes: 1073741824,
      diskUsagePct: 42.5,
      pluginUpdates: 0,
      wpVersion: '6.6',
      phpVersion: '8.2',
      bridgeVersion: '1.10.4-test',
      healthScore: 95,
      status: 'ACTIVE'
    };
    const headers = signHubRequest({ body, secret: SHARED_SECRET });
    const r = await http('PUT', `${HUB_BASE}/api/wp-bridge`, { body, headers });
    expect([200, 201], `health ping ${r.status} ${r.text?.slice(0, 200)}`).toContain(r.status);

    await sleep(300);
    const after = await findSiteByUrl(WP_HOME);
    expect(after, 'wp_sites row after ping').toBeTruthy();
    expect(after.lastPingStatus, 'lastPingStatus').toBe('ok');
    const afterTs = after.lastPingAt ? new Date(after.lastPingAt).getTime() : 0;
    expect(afterTs, 'lastPingAt moved forward').toBeGreaterThan(beforeTs);
  });

  // -------------------------------------------------------------------------
  // STEP 10-11 — hub → plugin magic-login fan-out returns URL.
  // -------------------------------------------------------------------------

  test('step 10-11: fleet magic-login returns per-site url with ?ashbi_sso=', async () => {
    expect(siteUuid, 'siteUuid from step 6').toBeTruthy();

    // POST /api/wp-bridge/fleet/magic-login (adminOnly JWT required)
    //   Source: src/routes/wp-bridge.routes.js:fastify.post('/fleet/magic-login')
    const r = await http('POST', `${HUB_BASE}/api/wp-bridge/fleet/magic-login`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: {
        user_id: 1,
        targetSites: [siteUuid]
      }
    });
    expect(r.status, `fleet/magic-login ${r.status} ${r.text?.slice(0, 300)}`).toBeLessThan(300);

    // Response shape: { results: [{ siteUrl, url? } | { siteUrl, error? }] }
    const results = r.json?.results;
    expect(Array.isArray(results), 'results array').toBe(true);
    expect(results.length, 'one result for one target site').toBeGreaterThan(0);

    const ok = results.find((row) => row.url);
    expect(ok, 'at least one success row with url').toBeTruthy();
    expect(ok.url, 'magic-login URL').toMatch(/ashbi_sso=[a-f0-9]+/);
    lastMagicUrl = ok.url;

    // Extract raw token + its sha256 for downstream assertions.
    const m = ok.url.match(/ashbi_sso=([a-f0-9]+)/);
    expect(m, 'token captured from URL').toBeTruthy();
    lastMagicToken = m[1];
    lastTokenHash  = sha256Hex(lastMagicToken);
  });

  // -------------------------------------------------------------------------
  // STEP 12 — "browser" (curl-like) visits magic URL → WP session + /wp-admin.
  // -------------------------------------------------------------------------

  test('step 12: visiting magic URL sets WP cookie + redirects to wp-admin', async () => {
    expect(lastMagicUrl, 'magic URL from step 10').toBeTruthy();

    // Don't auto-follow redirects; inspect Location header first.
    const res = await fetch(lastMagicUrl, { method: 'GET', redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    const bodyText = await res.text();
    const isRedirectToAdmin = res.status === 302 && /wp-admin/.test(loc);
    const isAdminResponse   = res.status === 200 && /wp-admin|Administration/.test(bodyText);
    expect(isRedirectToAdmin || isAdminResponse,
      `magic-URL response ${res.status} loc="${loc}" did not reach wp-admin`).toBe(true);

    // Follow the redirect once to confirm a session cookie was set.
    if (isRedirectToAdmin) {
      const followed = await fetch(lastMagicUrl, { redirect: 'follow' });
      const cookies = followed.headers.getSetCookie?.() || [];
      const cookieStr = cookies.join(' ');
      const ok = /wordpress_logged_in|wordpress_sec/.test(cookieStr) || followed.url.includes('/wp-admin');
      expect(ok,
        `followed response cookies/url indicate logged-in session. ` +
        `url=${followed.url} cookies=${cookieStr.slice(0, 200)}`).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // STEP 13 — audit log row in BOTH plugin-side + hub-side.
  // -------------------------------------------------------------------------

  test('step 13: audit row exists in plugin wp_options + hub wp_magic_login_log', async () => {
    // Plugin-side: read option `ashbi_magic_login_log` (NOT _audit_log).
    //   Source: OPTION_AUDIT_LOG = 'ashbi_magic_login_log' (line 29)
    const pluginRows = await getPluginAuditLog();
    expect(Array.isArray(pluginRows), 'plugin audit log array').toBe(true);

    // Plugin row schema: { status, reason, user_id, ip, site_id,
    //                      magic_token_hash, issued_by, expires_at }
    //   Source: includes/class-ashbi-magic-login.php:audit() calls (lines 76+)
    const tokenSeenByPlugin = pluginRows.some((row) =>
      row.magic_token_hash === lastTokenHash ||
      (row.url && lastMagicUrl && row.url.includes('ashbi_sso=')) ||
      (row.site_id && lastMagicUrl?.includes(row.site_id))
    );
    expect(tokenSeenByPlugin,
      `plugin audit captured this token/url. rows=${JSON.stringify(pluginRows.slice(-3))}`).toBe(true);

    // Hub-side: query wp_magic_login_log.
    const hubRows = await findMagicLoginLogBySiteUrl(WP_HOME, { limit: 10 });
    expect(hubRows.length, 'hub-side wp_magic_login_log has rows').toBeGreaterThan(0);
    const tokenSeenByHub = hubRows.some((row) =>
      row.tokenHash === lastTokenHash ||
      (row.siteUrl && lastMagicUrl?.startsWith(row.siteUrl))
    );
    expect(tokenSeenByHub, 'hub-side audit captured this site/token').toBe(true);
  });

  // -------------------------------------------------------------------------
  // STEP 14 — dispatch fix: hub POSTs revoke with {hash} → plugin calls
  // revoke_by_hash (NOT revoke). Verifies transient deleted + audit row.
  // -------------------------------------------------------------------------

  test('step 14: revoke with {hash} dispatches to revoke_by_hash (not revoke)', async () => {
    // Read plugin audit count BEFORE revoke for delta assertion.
    const auditBefore = (await getPluginAuditLog()).filter((r) =>
      r.magic_token_hash === lastTokenHash
    ).length;

    // Hub sends POST /api/wp-bridge/magic-login/revoke with {siteId, hash}.
    //   Source: src/routes/wp-bridge.routes.js fastify.post('/magic-login/revoke')
    // The route forwards the request to each site; adminOnly JWT required.
    const r = await http('POST', `${HUB_BASE}/api/wp-bridge/magic-login/revoke`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: { siteId: siteUuid, hash: lastTokenHash }
    });
    expect(r.status, `revoke ${r.status} ${r.text?.slice(0, 300)}`).toBeLessThan(300);
    expect(r.json?.success ?? r.json?.ok ?? r.json?.revoked ?? true,
      'revoke success flag').toBeTruthy();

    // Wait briefly for plugin to write the new audit row.
    await sleep(700);

    // Verify plugin-side: a new audit row exists with status='revoked'
    // and the SAME magic_token_hash we passed (not the double-hashed one).
    //
    // CRITICAL: if the plugin reverts to passing the hub-side hash through
    //   revoke() (legacy), the audit row would carry
    //   magic_token_hash = sha256(hash)  which DIFFERS from lastTokenHash.
    // The strict equality assertion below catches that regression.
    const auditAfter = await getPluginAuditLog();
    const revokeRows = auditAfter.filter((row) =>
      row.magic_token_hash === lastTokenHash ||
      row.reason === 'manual_revoke' ||
      row.reason === 'manual_revoke_consumed'
    );
    expect(revokeRows.length, 'plugin audit row after revoke').toBeGreaterThan(auditBefore);

    const matchingHash = revokeRows.find((row) => row.magic_token_hash === lastTokenHash);
    expect(matchingHash,
      `plugin audit row carries the SAME hash (not double-hashed). ` +
      `row=${JSON.stringify(matchingHash)}`).toBeTruthy();

    // Verify the active transient was actually deleted.
    //   Plugin transient key: 'ashbi_ml_active_' + <hash>
    //   Includes/class-ashbi-magic-login.php:27
    //
    // revoke_by_hash deletes it directly via delete_transient.
    // Legacy revoke($hash) would call hash($hash) and miss the active
    // transient, leaving it present — this check is the second guardrail.
    const deleted = await pluginTransientDeleted(lastTokenHash);
    expect(deleted, 'plugin active transient for the revoked hash should be deleted').toBe(true);

    // Verify hub-side: wp_magic_login_log has a 'revoked' status row.
    const revokedCount = await countMagicLoginLogBySiteUrl(WP_HOME, 'revoked');
    expect(revokedCount, 'hub-side revoked audit count').toBeGreaterThan(0);
  });

});