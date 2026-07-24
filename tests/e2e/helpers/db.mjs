// tests/e2e/helpers/db.mjs
//
// Postgres query helpers for asserting hub-side state in wp_sites +
// wp_magic_login_log. Uses the `pg` driver so we don't have to spin up
// a Prisma client in the test process.
//
// Connection params come from the test Postgres exposed by
// docker-compose.test.yml on host port 54329 (5432 inside the container).

import pg from 'pg';

const PORT = Number(process.env.HUB_DB_PORT || 54329);

let cached = null;
export async function getClient() {
  if (cached) return cached;
  const client = new pg.Client({
    host: process.env.HUB_DB_HOST || 'localhost',
    port: PORT,
    user: process.env.HUB_DB_USER || 'ashbi_test',
    password: process.env.HUB_DB_PASSWORD || 'ashbi_test',
    database: process.env.HUB_DB_NAME || 'ashbi_test'
  });
  await client.connect();
  cached = client;
  return client;
}

export async function close() {
  if (cached) {
    await cached.end();
    cached = null;
  }
}

/**
 * Find a wp_sites row by URL.
 * @returns the row or null. Throws on connection errors.
 */
export async function findSiteByUrl(siteUrl) {
  const c = await getClient();
  const r = await c.query(
    'SELECT id, url, name, status, "lastPingAt", "lastPingStatus", "bridgeVersion", "healthScore" FROM wp_sites WHERE url = $1',
    [siteUrl]
  );
  return r.rows[0] || null;
}

/**
 * Magic-login audit rows for a siteUrl (DESC by ts). Used in step 13 to
 * verify hub-side audit log captured the same transition the plugin did.
 */
export async function findMagicLoginLogBySiteUrl(siteUrl, opts = {}) {
  const c = await getClient();
  const limit = opts.limit || 50;
  const r = await c.query(
    `SELECT id, "siteUrl", "userId", "hubUserId", ip, status, reason, "tokenHash", ts
     FROM wp_magic_login_log
     WHERE "siteUrl" = $1
     ORDER BY ts DESC
     LIMIT $2`,
    [siteUrl, limit]
  );
  return r.rows;
}

/**
 * Count magic-login audit rows matching the given status (e.g. 'revoked').
 */
export async function countMagicLoginLogBySiteUrl(siteUrl, status) {
  const c = await getClient();
  const r = await c.query(
    `SELECT COUNT(*)::int AS n
     FROM wp_magic_login_log
     WHERE "siteUrl" = $1 AND status = $2`,
    [siteUrl, status]
  );
  return r.rows[0].n;
}