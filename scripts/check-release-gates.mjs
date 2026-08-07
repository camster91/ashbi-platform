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
  const production = read('deploy-coolify.yml');
  const staging = read('deploy-coolify-staging.yml');
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
  ];
  for (const command of commands) {
    if (!release.includes(command)) failures.push(`release-gates.yml is missing ${command}`);
  }
  if (!/^\s*workflow_call:\s*$/m.test(release)) failures.push('release-gates.yml is not reusable');

  for (const [name, source] of [['ci.yml', ci], ['deploy-coolify.yml', production], ['deploy-coolify-staging.yml', staging]]) {
    if (!/uses:\s*\.\/\.github\/workflows\/release-gates\.yml/.test(source)) {
      failures.push(`${name} does not invoke the canonical release gates`);
    }
  }
  for (const [name, source] of [['deploy-coolify.yml', production], ['deploy-coolify-staging.yml', staging]]) {
    if (!/needs:\s*release-gates/.test(source)) failures.push(`${name} can deploy without the release gates`);
    if (!/if:\s*github\.ref == 'refs\/heads\/main'/.test(source)) failures.push(`${name} can deploy from an unprotected branch`);
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
