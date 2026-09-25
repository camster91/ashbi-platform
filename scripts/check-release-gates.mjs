import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateReleaseGates(root = process.cwd()) {
  const workflowsDir = path.join(root, '.github', 'workflows');
  const read = (name) => fs.readFileSync(path.join(workflowsDir, name), 'utf8');
  const allWorkflows = fs.readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, read(name)]);
  const release = read('release-gates.yml');
  const ci = read('required-release-gates.yml');
  const imageBuild = read('build-and-push.yml');
  const directDeploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-vps-direct.sh'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'src', 'jobs', 'worker.js'), 'utf8');
  const workerHealth = fs.readFileSync(path.join(root, 'scripts', 'worker-health.mjs'), 'utf8');
  const productionSmoke = fs.readFileSync(path.join(root, 'scripts', 'smoke-production-health.mjs'), 'utf8');
  const observabilityRunbook = fs.readFileSync(path.join(root, 'docs', 'observability-and-slos.md'), 'utf8');
  const credentialRunbook = fs.readFileSync(path.join(root, 'docs', 'credential-vault-security.md'), 'utf8');
  const credentialMigration = fs.readFileSync(
    path.join(root, 'prisma', 'migrations', '20260809094500_credential_vault_audit_rotation', 'migration.sql'),
    'utf8',
  );
  const credentialDrill = fs.readFileSync(path.join(root, 'scripts', 'drill-credential-rotation.mjs'), 'utf8');
  const nodeTestRunner = fs.readFileSync(path.join(root, 'scripts', 'run-node-tests.mjs'), 'utf8');
  const failures = [];

  for (const [name, source] of allWorkflows) {
    if (/continue-on-error:\s*true/.test(source)) {
      failures.push(`${name} contains continue-on-error: true`);
    }
  }

  const commands = [
    'npm run check:secrets',
    'npm run check:release-gates',
    'npm run type-check',
    'npm run lint',
    'npm --prefix web run lint',
    'npm test',
    'npm run test:integration',
    'npm --prefix web test',
    'npm run test:browser',
    'npm run test:e2e',
    'npm run build',
    'npm run check:frontend-budgets',
    'npm run test:lighthouse',
    'npm run test:public-routes',
    'npm run test:pwa-offline',
    'npm audit --omit=dev --audit-level=high',
    'npm --prefix web audit --omit=dev --audit-level=high',
  ];
  for (const command of commands) {
    if (!release.includes(command)) failures.push(`release-gates.yml is missing ${command}`);
  }
  if (!/^\s*workflow_call:\s*$/m.test(release)) failures.push('release-gates.yml is not reusable');
  if (!/TENANT_INTEGRATION_DATABASE_URL:\s*postgresql:\/\/postgres:testpass@localhost:5432\/testdb/.test(release)) {
    failures.push('release-gates.yml does not enable dedicated-database policy integration tests');
  }
  const browserJob = release.split(/^  browser:/m)[1]?.split(/^  stack-e2e:/m)[0] ?? '';
  if (!browserJob.includes('npm run build')) failures.push('release-gates.yml browser job does not build the production frontend');

  if (!/uses:\s*\.\/\.github\/workflows\/release-gates\.yml/.test(ci)) {
    failures.push('required-release-gates.yml does not invoke the canonical release gates');
  }
  if (!/COPY scripts\/check-frontend-budgets\.mjs \/app\/scripts\/check-frontend-budgets\.mjs/.test(dockerfile)) {
    failures.push('Dockerfile frontend builder is missing the performance budget verifier');
  }
  if (!/"start:api"\s*:/.test(packageJson) || !/"start:worker"\s*:/.test(packageJson)) {
    failures.push('package.json does not expose separate API and worker commands');
  }
  if (!/setupRecurringJobs\(\)/.test(worker) || !/worker\.close\(\)/.test(worker)) {
    failures.push('worker does not own scheduler bootstrap and graceful draining');
  }
  if (!/ashbi:workers:heartbeat/.test(workerHealth)) {
    failures.push('worker health check does not verify the Redis heartbeat');
  }
  if (!/EXPECTED_REVISION/.test(productionSmoke) || !/database.*redis.*worker/s.test(productionSmoke)) {
    failures.push('production health smoke does not verify the exact revision and required dependencies');
  }
  if (!/OBSERVABILITY_OWNER/.test(observabilityRunbook) || !/Telemetry data policy/.test(observabilityRunbook)) {
    failures.push('observability runbook does not define ownership and telemetry data policy');
  }
  if (!/"rotate:credential-keys"\s*:/.test(packageJson) || !/"audit:credential-access"\s*:/.test(packageJson)) {
    failures.push('package.json does not expose credential rotation and access-review controls');
  }
  if (!/CREDENTIALS_KEY_OWNER/.test(credentialRunbook) || !/Rollback and emergency procedure/.test(credentialRunbook)) {
    failures.push('credential vault runbook does not define key ownership and emergency rollback');
  }
  if (!/BEFORE UPDATE OR DELETE/.test(credentialMigration) || !/credentials_enforce_ownership/.test(credentialMigration)) {
    failures.push('credential migration does not enforce immutable audits and tenant ownership');
  }
  if (!/confirm-disposable/.test(credentialDrill) || !/localhost/.test(credentialDrill)) {
    failures.push('credential rotation drill is not guarded to a disposable local database');
  }
  if (!/spawnSync\(process\.execPath/.test(nodeTestRunner) || /find .*xargs/.test(packageJson)) {
    failures.push('backend test commands are not cross-platform or do not propagate the Node test exit status');
  }

  for (const [name, source] of allWorkflows) {
    if (/appleboy\/ssh-action|COOLIFY_TOKEN|applications\/.*\/start|deploy-vps\.yml/.test(source)) {
      failures.push(`${name} can mutate production outside the direct VPS controller`);
    }
  }
  if (/push:[\s\S]*branches:\s*\[main/.test(imageBuild.split('workflow_call:')[0])) failures.push('build-and-push.yml independently races main deployment');

  const directRequirements = [
    [/sha256sum "\$ARCHIVE"/, 'does not verify the uploaded archive checksum'],
    [/ACTUAL_IMAGE_ID.*docker image inspect/, 'does not verify the immutable image ID'],
    [/flock -n/, 'does not serialize production changes'],
    [/npx prisma migrate status/, 'does not perform migration preflight'],
    [/PREVIOUS_IMAGE=/, 'does not capture the previous image'],
    [/PREVIOUS_REVISION=.*tail -1 \|\| true/, 'does not support a first deployment without a prior container'],
    [/restore_previous/, 'does not implement automatic rollback'],
    [/trap emergency_rollback EXIT/, 'does not protect interrupted cutovers'],
    [/imageDigest.*IMAGE_ID/, 'does not verify revision-aware readiness'],
    [/database.*status.*ok[\s\S]*redis.*status.*ok[\s\S]*worker.*status.*ok/, 'does not require dependency-aware readiness'],
    [/start_worker_container/, 'does not start a dedicated worker'],
    [/health:worker/, 'does not require worker readiness'],
    [/ROLLBACK_WORKER_CONTAINER/, 'does not retain a worker rollback'],
    [/record deployed/, 'does not append a successful release record'],
  ];
  for (const [pattern, message] of directRequirements) {
    if (!pattern.test(directDeploy)) failures.push(`deploy-vps-direct.sh ${message}`);
  }

  return failures;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0 ? process.argv[rootArg + 1] : process.cwd();
  const failures = validateReleaseGates(root);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Release gate contract: PASS');
  }
}
