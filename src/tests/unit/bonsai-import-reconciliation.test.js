import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  isReconciliationComplete,
  ownerKey,
  summaryFileProblem,
  timeEntryKey,
} from '../../../scripts/import-bonsai-full.js';

const importer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/import-bonsai-full.js');
const present = [{ filename: 'clients.csv', present: true }];

test('a Bonsai reconciliation with findings is not complete, even in a dry run', () => {
  assert.equal(isReconciliationComplete(present, []), true);
  assert.equal(isReconciliationComplete(present, ['TimeEntry: no project match for "X" / "Y"']), false);
  assert.equal(isReconciliationComplete([...present, { filename: 'expenses.csv', present: false }], []), false);
});

test('time entries with the same project, user, date and duration share one key', () => {
  const entry = { projectId: 'p', userId: 'u', date: new Date('2025-02-03'), duration: 60 };
  assert.equal(timeEntryKey(entry), timeEntryKey({ ...entry, date: new Date('2025-02-03T00:00:00Z') }));
  assert.notEqual(timeEntryKey(entry), timeEntryKey({ ...entry, duration: 61 }));
  assert.notEqual(timeEntryKey(entry), timeEntryKey({ ...entry, userId: 'v' }));
});

test('a blank owner name is blank, not a match-anything pattern', () => {
  assert.equal(ownerKey('  '), '');
  assert.equal(ownerKey(undefined), '');
  assert.equal(ownerKey(' Amy Admin '), 'amy admin');
});

test('the report path is checked before the import starts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-summary-'));
  try {
    const existing = path.join(directory, 'report.json');
    fs.writeFileSync(existing, 'earlier evidence\n');
    assert.match(summaryFileProblem(existing), /already exists/);
    assert.match(summaryFileProblem(path.join(directory, 'missing-dir', 'report.json')), /missing or not writable/);
    assert.equal(summaryFileProblem(path.join(directory, 'new.json')), null);

    // The CLI refuses before it connects to any database (this URL is unreachable).
    const result = spawnSync(process.execPath, [importer, '--confirm', '--organization-id', 'org', '--csv-dir', directory, '--summary-file', existing], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none' },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /summary file already exists/);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'earlier evidence\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
