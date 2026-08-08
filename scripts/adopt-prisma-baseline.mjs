import { spawnSync } from 'node:child_process';
import path from 'node:path';

const baseline = '20260808040000_baseline';
const confirmation = process.env.ALLOW_BASELINE_ADOPTION;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

if (confirmation !== baseline) {
  console.error(`Refusing baseline adoption. Set ALLOW_BASELINE_ADOPTION=${baseline} after taking a verified backup.`);
  process.exit(1);
}

function prisma(args) {
  const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) console.error(`Unable to launch Prisma CLI: ${result.error.message}`);
  return result;
}

console.log('Checking that the existing database exactly matches prisma/schema.prisma...');
const diff = prisma([
  'migrate', 'diff',
  '--exit-code',
  '--from-config-datasource',
  '--to-schema', 'prisma/schema.prisma',
]);

if (diff.status === 2) {
  console.error('Refusing baseline adoption: schema drift exists. Reconcile and review the diff first.');
  process.exit(2);
}

if (diff.status !== 0) {
  console.error(`Unable to verify schema drift (exit ${diff.status ?? 'unknown'}).`);
  process.exit(diff.status || 1);
}

console.log(`Schema matches. Recording ${baseline} as applied without executing its CREATE statements...`);
const resolve = prisma(['migrate', 'resolve', '--applied', baseline]);
if (resolve.status !== 0) process.exit(resolve.status || 1);

console.log('Baseline adoption complete. Running migrate deploy as a final consistency check...');
const deploy = prisma(['migrate', 'deploy']);
process.exit(deploy.status || 0);
