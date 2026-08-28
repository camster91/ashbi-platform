#!/usr/bin/env node
import { assessMigrationSandboxTarget } from '../src/services/migrationSandboxTarget.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const organizationId = option('--organization-id') || process.env.IMPORT_ORGANIZATION_ID;
if (!organizationId) {
  process.stderr.write('Usage: npm run check:migration-sandbox-target -- --organization-id <sandbox-org-id> [--confirm]\n');
  process.exit(2);
}

const report = assessMigrationSandboxTarget({
  environment: process.env,
  organizationId,
  requireMutationAuthorization: process.argv.includes('--confirm'),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
