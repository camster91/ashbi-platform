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
  fs.copyFileSync(path.resolve('package.json'), path.join(root, 'package.json'));
  fs.mkdirSync(path.join(root, 'src', 'jobs'), { recursive: true });
  fs.copyFileSync(path.resolve('src/jobs/worker.js'), path.join(root, 'src', 'jobs', 'worker.js'));
  fs.copyFileSync(path.resolve('scripts/worker-health.mjs'), path.join(root, 'scripts', 'worker-health.mjs'));
  fs.copyFileSync(path.resolve('scripts/smoke-production-health.mjs'), path.join(root, 'scripts', 'smoke-production-health.mjs'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.copyFileSync(path.resolve('docs/observability-and-slos.md'), path.join(root, 'docs', 'observability-and-slos.md'));
  fs.copyFileSync(path.resolve('docs/credential-vault-security.md'), path.join(root, 'docs', 'credential-vault-security.md'));
  fs.copyFileSync(path.resolve('scripts/drill-credential-rotation.mjs'), path.join(root, 'scripts', 'drill-credential-rotation.mjs'));
  fs.copyFileSync(path.resolve('scripts/run-node-tests.mjs'), path.join(root, 'scripts', 'run-node-tests.mjs'));
  const migrationDir = path.join(root, 'prisma', 'migrations', '20260809094500_credential_vault_audit_rotation');
  fs.mkdirSync(migrationDir, { recursive: true });
  fs.copyFileSync(
    path.resolve('prisma/migrations/20260809094500_credential_vault_audit_rotation/migration.sql'),
    path.join(migrationDir, 'migration.sql'),
  );
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
    const runtimeHealth = fs.readFileSync(path.resolve('src/services/runtime-health.service.js'), 'utf8');
    const runbook = fs.readFileSync(path.resolve('docs/deployment-and-rollback.md'), 'utf8');
    assert.match(server, /revision:\s*process\.env\.APP_REVISION/);
    assert.match(runtimeHealth, /imageDigest:\s*process\.env\.APP_IMAGE_DIGEST/);
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

  it('fails closed when worker readiness is removed from direct deployment', () => {
    const root = copyWorkflows();
    const deploy = path.join(root, 'scripts', 'deploy-vps-direct.sh');
    fs.writeFileSync(deploy, fs.readFileSync(deploy, 'utf8').replaceAll('health:worker', 'worker-check-omitted'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('worker readiness')));
  });

  it('fails closed when dependency-aware readiness is removed from direct deployment', () => {
    const root = copyWorkflows();
    const deploy = path.join(root, 'scripts', 'deploy-vps-direct.sh');
    fs.writeFileSync(deploy, fs.readFileSync(deploy, 'utf8').replace('database\\":{\\"status\\":\\"ok', 'database check omitted'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('dependency-aware readiness')));
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

  it('fails closed when dedicated-database policy tests are allowed to skip in release gates', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(
      workflow,
      fs.readFileSync(workflow, 'utf8').replace('TENANT_INTEGRATION_DATABASE_URL:', 'DISABLED_TENANT_DATABASE_URL:'),
    );
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('dedicated-database')));
  });

  it('fails closed when credential audit immutability is removed', () => {
    const root = copyWorkflows();
    const migration = path.join(root, 'prisma', 'migrations', '20260809094500_credential_vault_audit_rotation', 'migration.sql');
    fs.writeFileSync(migration, fs.readFileSync(migration, 'utf8').replace('BEFORE UPDATE OR DELETE', 'BEFORE INSERT'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('immutable audits')));
  });
});
