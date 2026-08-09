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
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/deploy-vps-direct.sh'), path.join(root, 'scripts', 'deploy-vps-direct.sh'));
  fs.copyFileSync(path.resolve('Dockerfile'), path.join(root, 'Dockerfile'));
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

  it('fails closed when a second deployment controller is introduced', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'rogue-deploy.yml');
    fs.writeFileSync(workflow, 'steps:\n  - uses: appleboy/ssh-action@v1\n');
    const failures = validateReleaseGates(root);
    assert.ok(failures.some((failure) => failure.includes('outside the direct VPS controller')));
  });

  it('fails closed when immutable artifact verification is removed', () => {
    const root = copyWorkflows();
    const deploy = path.join(root, 'scripts', 'deploy-vps-direct.sh');
    fs.writeFileSync(deploy, fs.readFileSync(deploy, 'utf8').replace('sha256sum "$ARCHIVE"', 'echo unverified'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('archive checksum')));
  });

  it('fails closed when the Docker frontend build bypasses performance budgets', () => {
    const root = copyWorkflows();
    const dockerfile = path.join(root, 'Dockerfile');
    fs.writeFileSync(
      dockerfile,
      fs.readFileSync(dockerfile, 'utf8').replace(
        'COPY scripts/check-frontend-budgets.mjs /app/scripts/check-frontend-budgets.mjs',
        '# verifier omitted',
      ),
    );
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('performance budget verifier')));
  });

  it('fails closed when the Lighthouse performance gate is removed', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('npm run test:lighthouse', 'echo skipped'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('test:lighthouse')));
  });

  it('fails closed when browser gates do not build their own production artifact', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    const source = fs.readFileSync(workflow, 'utf8');
    const start = source.indexOf('  browser:');
    const end = source.indexOf('  stack-e2e:');
    const browser = source.slice(start, end).replace('npm run build', 'echo build omitted');
    fs.writeFileSync(workflow, `${source.slice(0, start)}${browser}${source.slice(end)}`);
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('browser job')));
  });
});
