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
  const ci = read('ci.yml');
  const imageBuild = read('build-and-push.yml');
  const directDeploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-vps-direct.sh'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const failures = [];

  for (const [name, source] of allWorkflows) {
    if (/continue-on-error:\s*true/.test(source)) {
      failures.push(`${name} contains continue-on-error: true`);
    }
  }

  const commands = [
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
  ];
  for (const command of commands) {
    if (!release.includes(command)) failures.push(`release-gates.yml is missing ${command}`);
  }
  if (!/^\s*workflow_call:\s*$/m.test(release)) failures.push('release-gates.yml is not reusable');

  if (!/uses:\s*\.\/\.github\/workflows\/release-gates\.yml/.test(ci)) {
    failures.push('ci.yml does not invoke the canonical release gates');
  }
  if (!/COPY scripts\/check-frontend-budgets\.mjs \/app\/scripts\/check-frontend-budgets\.mjs/.test(dockerfile)) {
    failures.push('Dockerfile frontend builder is missing the performance budget verifier');
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
