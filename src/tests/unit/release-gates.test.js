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

  it('fails closed when the full-stack browser journeys are removed', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('npm run test:e2e:journeys', 'echo skipped'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('test:e2e:journeys')));
  });

  it('fails closed when the Redis service for the realtime integration tests is removed', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('REDIS_URL: redis://localhost:6379', 'REDIS_URL: ""'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('Redis realtime integration tests')));
  });

  it('fails closed when the Redis realtime tests may skip in the required gates', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace("REQUIRE_REDIS_TESTS: '1'", ''));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('REQUIRE_REDIS_TESTS')));
  });

  it('fails closed when a quality command is removed', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('npm run type-check', 'echo skipped'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('type-check')));
  });

  it('fails closed when the secret leak scan is removed from the required job', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    fs.writeFileSync(workflow, fs.readFileSync(workflow, 'utf8').replace('npm run check:secrets', 'echo skipped'));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('check:secrets')));
  });

  // Moved from the retired enterprise-compliance.yml: the quality job is the
  // only place these run, so each removal must fail the contract.
  for (const [label, needle, replacement] of [
    ['multi-tenancy route import guard', `! grep -r "import prisma from '../config/db.js'" src/routes/`, 'echo skipped'],
    ['baseline adoption rehearsal', 'CREATE DATABASE baseline_adoption;', 'SELECT 1;'],
    ['baseline drift-refusal proof', 'CREATE DATABASE baseline_drift;', 'SELECT 1;'],
    ['baseline drift-refusal requires exit 2', 'if [ "$adopt_status" -ne 2 ]; then', 'if [ "$adopt_status" -eq 0 ]; then'],
    ['baseline drift-refusal requires exit 2', 'adopt_status=$?\n', 'adopt_status=2\n'],
    ['baseline drift-refusal requires exit 2', 'got $adopt_status" >&2\n            exit 1', 'got $adopt_status" >&2\n            true'],
    ['baseline drift-refusal migration-table assertion', 'node scripts/assert-no-prisma-migrations.mjs', 'echo skipped'],
    ['frontend unit tests with coverage instrumentation', 'npm --prefix web test -- --coverage', 'npm --prefix web test'],
  ]) {
    it(`fails closed when the ${label} is removed from the quality job`, () => {
      const root = copyWorkflows();
      const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
      const source = fs.readFileSync(workflow, 'utf8').replaceAll('\r\n', '\n');
      assert.ok(source.includes(needle), `fixture text for ${label} must exist`);
      fs.writeFileSync(workflow, source.replaceAll(needle, replacement));
      assert.ok(validateReleaseGates(root).some((failure) => failure.includes(label)));
    });
  }

  it('fails closed when the baseline adoption rehearsal moves out of the quality job', () => {
    const root = copyWorkflows();
    const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
    const source = fs.readFileSync(workflow, 'utf8');
    // Keep the text in the file but outside the quality job (inside stack-e2e).
    const moved = source.replace('CREATE DATABASE baseline_adoption;', 'SELECT 1;')
      .replace('  stack-e2e:', '  # CREATE DATABASE baseline_adoption;\n  stack-e2e:');
    fs.writeFileSync(workflow, moved);
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('baseline adoption rehearsal')));
  });

  // The rehearsal must adopt a database built from the baseline SQL alone
  // (the real pre-migration scenario) through an empty shadow database.
  for (const [label, needle, replacement] of [
    ['baseline adoption rehearsal', 'CREATE DATABASE baseline_adoption_shadow;', 'SELECT 1;'],
    ['baseline adoption rehearsal', 'export BASELINE_SHADOW_DATABASE_URL=postgresql://postgres:testpass@localhost:5432/baseline_adoption_shadow', 'true'],
    ['baseline adoption rehearsal', 'node scripts/assert-baseline-adoption.mjs applied', 'echo skipped'],
    ['baseline adoption rehearsal', '          npm run db:adopt-baseline\n          npx prisma migrate diff --exit-code --from-config-datasource --to-schema prisma/schema.prisma\n', '          npm run db:adopt-baseline\n'],
    ['baseline drift-refusal proof', 'CREATE DATABASE baseline_drift_shadow;', 'SELECT 1;'],
    ['baseline drift-refusal proof', 'node scripts/assert-baseline-adoption.mjs shadow-built', 'echo skipped'],
    ['baseline drift-refusal proof', `printf 'ALTER TABLE "clients" ADD COLUMN "unexpectedBaselineDrift" TEXT;' | npx prisma db execute --stdin`, 'true'],
  ]) {
    it(`fails closed when the ${label} step loses ${needle.trim().split('\n')[0].slice(0, 60)}`, () => {
      const root = copyWorkflows();
      const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
      const source = fs.readFileSync(workflow, 'utf8').replaceAll('\r\n', '\n');
      assert.ok(source.includes(needle), `fixture text for ${label} must exist`);
      fs.writeFileSync(workflow, source.replace(needle, replacement));
      assert.ok(validateReleaseGates(root).some((failure) => failure.includes(`${label} step`)));
    });
  }

  for (const label of ['baseline adoption rehearsal', 'baseline drift-refusal proof']) {
    it(`fails closed when the ${label} builds its database with db push instead of the baseline SQL`, () => {
      const root = copyWorkflows();
      const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
      const source = fs.readFileSync(workflow, 'utf8').replaceAll('\r\n', '\n');
      const marker = label === 'baseline adoption rehearsal' ? 'baseline_adoption_shadow\n' : 'baseline_drift_shadow\n';
      const sql = 'npx prisma db execute --file prisma/migrations/20260808040000_baseline/migration.sql';
      const start = source.indexOf(`export BASELINE_SHADOW_DATABASE_URL=postgresql://postgres:testpass@localhost:5432/${marker}`);
      const at = source.indexOf(sql, start);
      assert.ok(start >= 0 && at > start, `fixture text for ${label} must exist`);
      fs.writeFileSync(workflow, `${source.slice(0, at)}npx prisma db push${source.slice(at + sql.length)}`);
      const failures = validateReleaseGates(root);
      assert.ok(failures.some((failure) => failure.includes(`${label} step builds its database with prisma db push`)));
      assert.ok(failures.some((failure) => failure.includes(`${label} step is missing ${sql}`)));
    });

    it(`fails closed when the ${label} step loses its adoption confirmation`, () => {
      const root = copyWorkflows();
      const workflow = path.join(root, '.github', 'workflows', 'release-gates.yml');
      const source = fs.readFileSync(workflow, 'utf8').replaceAll('\r\n', '\n');
      const marker = label === 'baseline adoption rehearsal' ? 'CREATE DATABASE baseline_adoption;' : 'CREATE DATABASE baseline_drift;';
      const start = source.indexOf(marker);
      const confirmation = 'ALLOW_BASELINE_ADOPTION: 20260808040000_baseline';
      const at = source.indexOf(confirmation, start);
      assert.ok(start >= 0 && at > start, `fixture text for ${label} must exist`);
      fs.writeFileSync(workflow, `${source.slice(0, at)}ALLOW_BASELINE_ADOPTION: 'no'${source.slice(at + confirmation.length)}`);
      assert.ok(validateReleaseGates(root).some((failure) => failure.includes(`${label} step is missing the baseline adoption confirmation`)));
    });
  }

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

  it('fails closed when the rollback fallback to the public health probe is removed', () => {
    const root = copyWorkflows();
    const deploy = path.join(root, 'scripts', 'deploy-vps-direct.sh');
    const source = fs.readFileSync(deploy, 'utf8');
    assert.match(source, /\|\| curl -fsS --max-time 5 "http:\/\/127\.0\.0\.1:\$\{HOST_PORT\}\/api\/health"/);
    fs.writeFileSync(deploy, source.replace(/\n\s*\|\| curl -fsS --max-time 5 "http:\/\/127\.0\.0\.1:\$\{HOST_PORT\}\/api\/health" 2>\/dev\/null \\/, ''));
    assert.ok(validateReleaseGates(root).some((failure) => failure.includes('operator rollback')));
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
