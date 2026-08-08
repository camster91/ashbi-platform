import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { validateReleaseGates } from '../../../scripts/check-release-gates.mjs';

const temporaryRoots = [];

function copyWorkflows() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-release-gates-'));
  temporaryRoots.push(root);
  fs.cpSync(path.resolve('.github'), path.join(root, '.github'), { recursive: true });
  return root;
}

afterEach(() => {
  while (temporaryRoots.length) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe('mandatory release gates', () => {
  it('covers every canonical command and deployment dependency', () => {
    assert.deepEqual(validateReleaseGates(), []);
  });

  it('exposes revision-aware readiness and documents rollback rehearsal', () => {
    const server = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
    const runbook = fs.readFileSync(path.resolve('docs/deployment-and-rollback.md'), 'utf8');
    assert.match(server, /revision:\s*process\.env\.APP_REVISION/);
    assert.match(server, /imageDigest:\s*process\.env\.APP_IMAGE_DIGEST/);
    assert.match(runbook, /Automated rollback test/);
    assert.match(runbook, /Manual rollback/);
  });

  it('fails closed when a quality command is removed', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('npm run type-check', 'echo skipped'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('type-check')));
  });

  it('fails closed when a deploy bypass or continue-on-error is introduced', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'deploy-coolify.yml');
    const source = fs.readFileSync(workflow, 'utf8')
      .replace('needs: release-gates', 'needs: []')
      .concat('\ncontinue-on-error: true\n');
    fs.writeFileSync(workflow, source);
    const failures = validateReleaseGates(root);
    assert.ok(failures.some((failure) => failure.includes('continue-on-error')));
    assert.ok(failures.some((failure) => failure.includes('publish without')));
  });
});
