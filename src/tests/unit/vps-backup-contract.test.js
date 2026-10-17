import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const backup = readFileSync(new URL('../../../scripts/backup-vps.sh', import.meta.url), 'utf8');
const restore = readFileSync(new URL('../../../scripts/restore-drill-vps.sh', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../scripts/systemd/ashbi-backup.service', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../../../scripts/systemd/ashbi-backup.timer', import.meta.url), 'utf8');

test('production backup is encrypted, atomic, locked, and validates the database dump', () => {
  assert.match(backup, /flock -n/);
  assert.match(backup, /pg_restore -l/);
  assert.ok(backup.includes('docker exec -i "$POSTGRES_CONTAINER" pg_restore -l < "$work/database.dump"'));
  assert.doesNotMatch(backup, /for command[^\n]*pg_restore/);
  assert.match(backup, /age --encrypt --recipients-file/);
  assert.match(backup, /archive\.tmp/);
  assert.match(backup, /mv "\$archive\.tmp" "\$archive"/);
  assert.match(backup, /chmod 0600/);
  assert.match(backup, /status":"ok"/);
  assert.match(backup, /data\/config\/backup-status\.json/);
  assert.match(backup, /chmod 0644 "\$status_tmp"/);
  const statusTemplate = backup.match(/printf '(\{\\"status.*?\})\\n'/)?.[1] || '';
  assert.doesNotMatch(statusTemplate, /archive|sha256|credential|tenant/i);
});

test('backup includes database, persistent files, runtime configuration, and bounded retention', () => {
  assert.match(backup, /database\.dump/);
  assert.match(backup, /runtime\/data/);
  assert.match(backup, /runtime\/environment/);
  assert.match(backup, /RETENTION_DAYS >= 7 && RETENTION_DAYS <= 365/);
  assert.match(backup, /find "\$BACKUP_DIR" -maxdepth 1/);
});

test('restore drill is isolated, integrity checked, representative, and self-cleaning', () => {
  assert.match(restore, /sha256sum --check manifest\.sha256/);
  assert.match(restore, /--network none/);
  assert.ok(restore.includes('--tmpfs "$restore_tmpfs:rw'));
  assert.match(restore, /pgvector\/pgvector@sha256:[a-f0-9]{64}/);
  assert.ok(restore.includes('-e PGDATA="$restore_pgdata"'));
  assert.match(restore, /--entrypoint postgres/);
  assert.match(restore, /--exit-on-error --single-transaction/);
  assert.doesNotMatch(restore, /docker cp/);
  assert.match(restore, /pg_restore/);
  for (const table of ['organizations', 'users', 'clients', 'projects', 'invoices', 'internal_notes', 'attachments']) {
    assert.match(restore, new RegExp(`FROM ${table}`));
  }
  assert.match(restore, /trap cleanup EXIT/);
});

test('restore drill waits for stable PostgreSQL readiness across the initialization restart', () => {
  assert.match(restore, /stable_ready_count=0/);
  assert.match(restore, /stable_ready_count=\$\(\(stable_ready_count \+ 1\)\)/);
  assert.match(restore, /stable_ready_count >= 3/);
  assert.match(restore, /stable_ready_count=0/);
  assert.doesNotMatch(restore, /pg_isready[^\n]+&& break/);
});

test('systemd schedule is persistent and the service is root-only and fail-visible', () => {
  assert.match(timer, /OnCalendar=\*-\*-\* 02:00:00 UTC/);
  assert.match(timer, /Persistent=true/);
  assert.match(service, /User=root/);
  assert.match(service, /UMask=0077/);
  assert.doesNotMatch(service, /^-/m, 'ExecStart must not suppress a non-zero backup exit');
});

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

test('restore target selects versioned storage from the selected binary and rejects unsupported engines', () => {
  const selection = restore.slice(restore.indexOf('restore_version='), restore.indexOf('docker run -d --name'));
  for (const [version, expected] of [['18.6', '/var/lib/postgresql/18/docker|/var/lib/postgresql'], ['16.15', '/var/lib/postgresql/data|/var/lib/postgresql/data']]) {
    const result = spawnSync(bash, ['-ec', `die() { exit 1; }; docker() { printf 'postgres (PostgreSQL) %s\n' "$TEST_VERSION"; }; ${selection}
printf '%s|%s' "$restore_pgdata" "$restore_tmpfs"`], {
      encoding: 'utf8', env: { ...process.env, TEST_VERSION: version, RESTORE_IMAGE: 'synthetic-image' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
  const rejected = spawnSync(bash, ['-ec', `die() { exit 1; }; docker() { printf 'postgres (PostgreSQL) 17.1\n'; }; ${selection}`], {
    encoding: 'utf8', env: { ...process.env, RESTORE_IMAGE: 'synthetic-image' },
  });
  assert.equal(rejected.status, 1);
});

test('restore catalog streams the original bytes and blocks restore after a reader failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ashbi-catalog-unit-'));
  const bytes = Buffer.from('PGDMP synthetic private archive\u0000bytes');
  const catalog = restore.split('\n').find(line => line.startsWith('docker exec -i "$container" pg_restore -l'));
  assert.ok(catalog);
  try {
    writeFileSync(join(directory, 'database.dump'), bytes);
    for (const exitCode of [0, 1]) {
      const script = `work="$PWD"; container=synthetic; die() { printf '%s' "$*" >&2; exit 1; }; docker() { cat > captured.dump; printf 'PRIVATE ERROR' >&2; return ${exitCode}; }; ${catalog}; printf 'RESTORE_REACHED'`;
      const result = spawnSync(bash, ['-ec', script], { cwd: directory, encoding: 'utf8' });
      assert.deepEqual(readFileSync(join(directory, 'captured.dump')), bytes);
      assert.equal(result.status, exitCode, result.stderr);
      assert.equal(result.stdout, exitCode === 0 ? 'RESTORE_REACHED' : '');
      assert.doesNotMatch(result.stderr, /PRIVATE ERROR/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
