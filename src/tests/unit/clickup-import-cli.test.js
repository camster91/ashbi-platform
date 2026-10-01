import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/import-clickup-tasks.js');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

async function withDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-clickup-'));
  try { await callback(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('ClickUp dry-run CLI writes one reconciled report and never overwrites it', () => withDirectory(async (directory) => {
  const input = path.join(directory, 'tasks.csv');
  const report = path.join(directory, 'report.json');
  await fs.writeFile(input, 'Task ID,Task Name,Status,Priority\n1,Launch site,In Progress,High\n');
  const first = run('--input', input, '--summary-file', report);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(await fs.readFile(report, 'utf8')).summary.complete, true);
  const second = run('--input', input, '--summary-file', report);
  assert.notEqual(second.status, 0);
}));

test('ClickUp CLI strips a UTF-8 byte-order mark from the header', () => withDirectory(async (directory) => {
  const input = path.join(directory, 'tasks.csv');
  const report = path.join(directory, 'report.json');
  await fs.writeFile(input, '\uFEFFTask ID,Task Name,Status\n1,Launch site,Complete\n2,Write copy,To Do\n');
  const result = run('--input', input, '--summary-file', report);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.tasks.map((task) => [task.sourceId, task.status]), [['1', 'COMPLETED'], ['2', 'PENDING']]);
}));

test('ClickUp CLI fails cleanly, without a report, when the input file is missing', () => withDirectory(async (directory) => {
  const report = path.join(directory, 'report.json');
  const result = run('--input', path.join(directory, 'missing.csv'), '--summary-file', report);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ClickUp CSV could not be read: .*missing\.csv/);
  assert.doesNotMatch(result.stderr, /Unhandled|node:events|at ReadStream/);
  await assert.rejects(fs.access(report));
}));

test('ClickUp CLI reports fallback warnings without failing the dry run', () => withDirectory(async (directory) => {
  const input = path.join(directory, 'tasks.csv');
  const report = path.join(directory, 'report.json');
  await fs.writeFile(input, 'Task ID,Task Name,Status,Priority\n1,Launch site,Client Review,High\n');
  const result = run('--input', input, '--summary-file', report);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(parsed.summary.complete, true);
  assert.equal(parsed.summary.warnings, 1);
  assert.equal(parsed.warnings[0].code, 'STATUS_FALLBACK');
}));
