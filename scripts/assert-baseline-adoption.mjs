// Assertions for the baseline-adoption rehearsal in the release gates.
//
//   node scripts/assert-baseline-adoption.mjs applied
//     DATABASE_URL's _prisma_migrations lists every committed migration, all
//     finished and none rolled back; the baseline was recorded (0 steps run)
//     and every later migration was executed by migrate deploy (>= 1 step).
//
//   node scripts/assert-baseline-adoption.mjs shadow-built
//     BASELINE_SHADOW_DATABASE_URL contains the baseline schema, proving a
//     refusal came from the schema comparison and not from a precondition.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { BASELINE, SHADOW_ENV } from './adopt-prisma-baseline.mjs';

export function committedMigrations(root = process.cwd()) {
  return fs.readdirSync(path.join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

// rows: { migration_name, applied_steps_count, finished, rolled_back }
export function migrationRecordFailures(expected, rows) {
  const failures = [];
  const seen = new Map();
  for (const row of rows) {
    if (seen.has(row.migration_name)) failures.push(`${row.migration_name} is recorded more than once`);
    seen.set(row.migration_name, row);
    if (!expected.includes(row.migration_name)) failures.push(`${row.migration_name} is recorded but not committed`);
    if (!row.finished) failures.push(`${row.migration_name} did not finish`);
    if (row.rolled_back) failures.push(`${row.migration_name} is rolled back`);
  }
  for (const name of expected) {
    const row = seen.get(name);
    if (!row) { failures.push(`${name} is not recorded`); continue; }
    if (name === BASELINE && row.applied_steps_count !== 0) failures.push(`${BASELINE} was executed instead of recorded as applied`);
    if (name !== BASELINE && !(row.applied_steps_count >= 1)) failures.push(`${name} was recorded without being executed by migrate deploy`);
  }
  if (!expected.includes(BASELINE)) failures.push(`${BASELINE} is not a committed migration`);
  return failures;
}

async function query(url, sql) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

async function main(mode) {
  if (mode === 'applied') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const rows = await query(process.env.DATABASE_URL, `
      SELECT migration_name, applied_steps_count,
        finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
      FROM _prisma_migrations`);
    const expected = committedMigrations();
    const failures = migrationRecordFailures(expected, rows);
    if (failures.length) throw new Error(`Baseline adoption did not record the migration chain:\n- ${failures.join('\n- ')}`);
    console.log(`All ${expected.length} migrations recorded: ${BASELINE} adopted, ${expected.length - 1} applied by migrate deploy.`);
    return;
  }
  if (mode === 'shadow-built') {
    const url = process.env[SHADOW_ENV];
    if (!url) throw new Error(`${SHADOW_ENV} is required`);
    const [{ count }] = await query(url, "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'");
    if (!(count > 0)) throw new Error('The baseline was never built in the shadow database; adoption was refused before comparing schemas');
    console.log(`Shadow database holds the baseline schema (${count} tables): the refusal came from the schema comparison.`);
    return;
  }
  throw new Error('Usage: assert-baseline-adoption.mjs applied|shadow-built');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
