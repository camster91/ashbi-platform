import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const FLOOR_MIGRATIONS = ['20260927030000_chat_message_visibility'];
const validName = name => /^[0-9]{14}_[a-z0-9_]+$/.test(name);

async function appliedMigrations() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  try {
    await client.connect();
    const result = await client.query('SELECT migration_name FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    return result.rows.map(row => row.migration_name);
  } finally { await client.end(); }
}

export async function migrateWithFloor({ stateDir = '/release-state', migrationDir = '/app/prisma/migrations',
  readApplied = appliedMigrations, migrate = () => promisify(execFile)('npx', ['prisma', 'migrate', 'deploy'], { timeout: 600000, maxBuffer: 4 * 1024 * 1024 }) } = {}) {
  await fs.access(stateDir, fs.constants.W_OK);
  const file = path.join(stateDir, 'rollback-floor');
  let previous = [];
  try { previous = (await fs.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous.some(name => !validName(name))) throw new Error('Invalid persisted rollback floor');
  const before = await readApplied();
  const required = [...new Set([...previous, ...FLOOR_MIGRATIONS.filter(name => before.includes(name))])];
  for (const name of required) {
    try { await fs.access(path.join(migrationDir, name, 'migration.sql')); }
    catch { throw new Error('Candidate is below the database rollback floor'); }
  }
  let failed = false;
  try { await migrate(); } catch { failed = true; }
  // A security migration may succeed before a later migration fails. Persist
  // the applied floor even then; never permit a confidentiality regression.
  const after = await readApplied();
  const raised = [...new Set([...required, ...FLOOR_MIGRATIONS.filter(name => after.includes(name))])].sort();
  const temporary = file + `.tmp-${process.pid}`;
  try {
    await fs.writeFile(temporary, raised.join('\n') + (raised.length ? '\n' : ''), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  if (failed) throw new Error('Migration failed; applied rollback floor retained');
  return raised;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateWithFloor().then(() => console.log('Production migrations and rollback floor verified')).catch(() => {
    console.error('Production migration/floor verification failed; application startup blocked'); process.exitCode = 1;
  });
}
