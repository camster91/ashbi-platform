import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('ClickUp dry-run CLI writes one reconciled report and never overwrites it', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-clickup-'));
  const input = path.join(directory, 'tasks.csv');
  const report = path.join(directory, 'report.json');
  await fs.writeFile(input, 'Task ID,Task Name,Status,Priority\n1,Launch site,In Progress,High\n');
  const script = path.resolve('scripts/import-clickup-tasks.js');
  const first = spawnSync(process.execPath, [script, '--input', input, '--summary-file', report], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(await fs.readFile(report, 'utf8')).summary.complete, true);
  const second = spawnSync(process.execPath, [script, '--input', input, '--summary-file', report], { encoding: 'utf8' });
  assert.notEqual(second.status, 0);
  await fs.rm(directory, { recursive: true, force: true });
});
