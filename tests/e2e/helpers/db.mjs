// tests/e2e/helpers/db.mjs
//
// Direct Postgres reads for asserting what the hub persisted. Uses the `pg`
// driver against the test database exposed by docker-compose.test.yml on
// host port 54329.

import pg from 'pg';

let cached = null;

async function getClient() {
  if (cached) return cached;
  const client = new pg.Client({
    host: process.env.HUB_DB_HOST || 'localhost',
    port: Number(process.env.HUB_DB_PORT || 54329),
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

export async function findUserByEmail(email) {
  const c = await getClient();
  const r = await c.query('SELECT id, email, role, "organizationId" FROM users WHERE email = $1', [email]);
  return r.rows[0] || null;
}

export async function findClientById(id) {
  const c = await getClient();
  const r = await c.query('SELECT id, name, "organizationId", "deletedAt" FROM clients WHERE id = $1', [id]);
  return r.rows[0] || null;
}
