// Adopt an existing database that predates Prisma migration history.
//
// The database must match the schema produced by the BASELINE migration
// (prisma/migrations/20260808040000_baseline/migration.sql) exactly. Only then
// is the baseline recorded as applied; every later migration is applied
// normally by `prisma migrate deploy`, so their data backfills still run.
//
// Fails closed at every step: no migration metadata is written unless the
// target has no history, the shadow database is empty, and the live schema
// has zero drift from the baseline.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const BASELINE = '20260808040000_baseline';
export const SHADOW_ENV = 'BASELINE_SHADOW_DATABASE_URL';

const RELATION_COUNT_SQL = `
  SELECT
    EXISTS (SELECT 1 FROM pg_class WHERE relname = '_prisma_migrations' AND relkind IN ('r', 'p')) AS "hasMigrationsTable",
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp%') AS "relationCount"`;

function databaseIdentity(url) {
  try {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return null;
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!parsed.hostname || !database) return null;
    return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${database}`;
  } catch {
    return null;
  }
}

// Static checks on the environment. Returns null when adoption may continue,
// otherwise { code, message } describing why it is refused.
export function checkConfiguration(env) {
  if (!env.DATABASE_URL) return { code: 1, message: 'DATABASE_URL is required.' };
  if (env.ALLOW_BASELINE_ADOPTION !== BASELINE) {
    return { code: 1, message: `Refusing baseline adoption. Set ALLOW_BASELINE_ADOPTION=${BASELINE} after taking a verified backup.` };
  }
  const shadow = env[SHADOW_ENV];
  if (!shadow) {
    return {
      code: 1,
      message: `Refusing baseline adoption. Set ${SHADOW_ENV} to an empty, disposable PostgreSQL database (with pgvector available). `
        + 'The baseline migration is built there to compare against; Prisma resets it.',
    };
  }
  const target = databaseIdentity(env.DATABASE_URL);
  const shadowIdentity = databaseIdentity(shadow);
  if (!target || !shadowIdentity) {
    return { code: 1, message: `Refusing baseline adoption: DATABASE_URL and ${SHADOW_ENV} must be postgresql:// URLs naming a host and database.` };
  }
  if (target === shadowIdentity) {
    return { code: 1, message: `Refusing baseline adoption: ${SHADOW_ENV} must be a different database from DATABASE_URL.` };
  }
  return null;
}

export async function inspectDatabase(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(RELATION_COUNT_SQL);
    return { hasMigrationsTable: Boolean(rows[0].hasMigrationsTable), relationCount: Number(rows[0].relationCount) };
  } finally {
    await client.end();
  }
}

// Builds a migrations directory holding only the baseline migration (byte for
// byte) and a Prisma config that reads both URLs from the environment, so no
// credential is written to disk.
export function stageBaselineMigrations(root = process.cwd()) {
  const source = path.join(root, 'prisma', 'migrations', BASELINE, 'migration.sql');
  if (!fs.existsSync(source)) throw new Error(`Baseline migration not found at ${source}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-baseline-adoption-'));
  const migrationsPath = path.join(dir, 'migrations');
  fs.mkdirSync(path.join(migrationsPath, BASELINE), { recursive: true });
  fs.copyFileSync(source, path.join(migrationsPath, BASELINE, 'migration.sql'));
  fs.writeFileSync(path.join(migrationsPath, 'migration_lock.toml'), 'provider = "postgresql"\n');
  const configPath = path.join(dir, 'prisma.config.mjs');
  fs.writeFileSync(configPath, [
    'export default {',
    `  schema: ${JSON.stringify(path.join(root, 'prisma', 'schema.prisma'))},`,
    `  migrations: { path: ${JSON.stringify(migrationsPath)} },`,
    `  datasource: { url: process.env.DATABASE_URL, shadowDatabaseUrl: process.env.${SHADOW_ENV} },`,
    '};',
    '',
  ].join('\n'));
  return { configPath, migrationsPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function runPrisma(args, { root = process.cwd(), env = process.env } = {}) {
  const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, stdio: 'inherit' });
  if (result.error) console.error(`Unable to launch Prisma CLI: ${result.error.message}`);
  return result.status ?? 1;
}

function refuse(log, code, message) {
  log.error(message);
  return code;
}

// Orchestrates adoption. Every side effect is injected so the decision logic
// is unit-tested; returns the process exit code.
export async function adoptBaseline({
  env = process.env,
  prisma = (args) => runPrisma(args, { env }),
  inspect = inspectDatabase,
  stage = () => stageBaselineMigrations(),
  log = console,
} = {}) {
  const configError = checkConfiguration(env);
  if (configError) return refuse(log, configError.code, configError.message);

  const target = await inspect(env.DATABASE_URL);
  if (target.hasMigrationsTable) {
    return refuse(log, 1, 'Refusing baseline adoption: the database already has a _prisma_migrations table. Use `prisma migrate deploy` / `prisma migrate status` instead.');
  }
  if (target.relationCount === 0) {
    return refuse(log, 1, 'Refusing baseline adoption: the database is empty. Use `prisma migrate deploy` for a fresh database.');
  }
  const shadow = await inspect(env[SHADOW_ENV]);
  if (shadow.hasMigrationsTable || shadow.relationCount !== 0) {
    return refuse(log, 1, `Refusing baseline adoption: ${SHADOW_ENV} is not empty (${shadow.relationCount} relations). Prisma resets the shadow database, so it must be a new, disposable database.`);
  }

  log.log(`Checking that the existing database exactly matches the ${BASELINE} migration (built in the shadow database)...`);
  const staged = stage();
  let diff;
  try {
    diff = prisma([
      'migrate', 'diff',
      '--config', staged.configPath,
      '--exit-code',
      '--from-migrations', staged.migrationsPath,
      '--to-config-datasource',
    ]);
  } finally {
    staged.cleanup();
  }
  if (diff === 2) {
    return refuse(log, 2, `Refusing baseline adoption: the database does not match the ${BASELINE} schema. Reconcile and review the diff first; no migration metadata was written.`);
  }
  if (diff !== 0) return refuse(log, diff || 1, `Unable to verify the database against ${BASELINE} (exit ${diff}); no migration metadata was written.`);

  log.log(`Database matches ${BASELINE}. Recording only ${BASELINE} as applied without executing its CREATE statements...`);
  const resolve = prisma(['migrate', 'resolve', '--applied', BASELINE]);
  if (resolve !== 0) return refuse(log, resolve || 1, `Unable to record ${BASELINE} as applied (exit ${resolve}).`);

  log.log('Applying every later migration with prisma migrate deploy...');
  const deploy = prisma(['migrate', 'deploy']);
  if (deploy !== 0) {
    return refuse(log, deploy || 1, `prisma migrate deploy failed (exit ${deploy}) after ${BASELINE} was recorded. Keep writers stopped; inspect \`prisma migrate status\` and repair forward or restore the backup.`);
  }

  log.log('Verifying the migrated database has no drift from prisma/schema.prisma...');
  const final = prisma(['migrate', 'diff', '--exit-code', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma']);
  if (final !== 0) {
    return refuse(log, final || 1, `Migrations applied but the database ${final === 2 ? 'drifts from' : 'could not be compared with'} prisma/schema.prisma (exit ${final}). Keep writers stopped and investigate before serving.`);
  }
  log.log('Baseline adoption complete: baseline recorded, later migrations applied, zero drift from prisma/schema.prisma.');
  return 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  adoptBaseline().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Baseline adoption failed before writing migration metadata: ${error.message}`); process.exitCode = 1; },
  );
}
