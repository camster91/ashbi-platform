import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const backup = readFileSync(new URL('../../../scripts/backup-vps.sh', import.meta.url), 'utf8');
const restore = readFileSync(new URL('../../../scripts/restore-drill-vps.sh', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../scripts/systemd/ashbi-backup.service', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../../../scripts/systemd/ashbi-backup.timer', import.meta.url), 'utf8');

test('production backup is encrypted, atomic, locked, and validates the database dump', () => {
  assert.match(backup, /flock -n/);
  assert.match(backup, /pg_restore -l/);
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
  assert.match(restore, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(restore, /pgvector\/pgvector:pg16/);
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
