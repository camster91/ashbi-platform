import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assessMigrationSandboxInfrastructure } from '../../services/migrationSandboxInfrastructure.service.js';

function current() {
  return {
    composeText: fs.readFileSync('docker-compose.migration-sandbox.yml', 'utf8'),
    environmentTemplate: fs.readFileSync('docs/migration-sandbox.env.example', 'utf8'),
    runbookText: fs.readFileSync('docs/migration-sandbox-deployment.md', 'utf8'),
    releaseScriptText: fs.readFileSync('scripts/deploy-vps-direct.sh', 'utf8'),
  };
}

test('committed migration sandbox contract is isolated and ready for reviewed provisioning', () => {
  const report = assessMigrationSandboxInfrastructure(current());
  assert.equal(report.ready, true, JSON.stringify(report.checks));
  assert.equal(report.checks.every(item => item.ok), true);
});

test('rejects host data ports, production targets, live keys, and missing deployment overrides', () => {
  const value = current();
  value.composeText += '\nports:\n  - "5432:5432"\ncontainer_name: ashbi-platform\n';
  value.environmentTemplate = value.environmentTemplate.replace('STRIPE_SECRET_KEY=', 'STRIPE_SECRET_KEY=sk_live_example');
  value.runbookText = value.runbookText.replace('--host-port 13002 --network ashbi-migration-sandbox', '--host-port 3002');
  value.releaseScriptText = value.releaseScriptText.replace('MIGRATION_SANDBOX_PORT=13002', 'MIGRATION_SANDBOX_PORT=3002');
  const report = assessMigrationSandboxInfrastructure(value);
  assert.equal(report.ready, false);
  assert.ok(report.checks.some(item => item.id === 'no-datastore-host-ports' && !item.ok));
  assert.ok(report.checks.some(item => item.id === 'no-production-compose-targets' && !item.ok));
  assert.ok(report.checks.some(item => item.id === 'safe-environment-template' && !item.ok));
  assert.ok(report.checks.some(item => item.id === 'explicit-deployment-isolation' && !item.ok));
  assert.ok(report.checks.some(item => item.id === 'release-controller-fail-closed' && !item.ok));
});

test('checker is read-only and package-addressable', () => {
  const script = fs.readFileSync('scripts/check-migration-sandbox-infrastructure.mjs', 'utf8');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.doesNotMatch(script, /writeFile|appendFile|rmSync|unlink|fetch\s*\(|PrismaClient|docker\s/);
  assert.equal(pkg.scripts['check:migration-sandbox-infrastructure'], 'node scripts/check-migration-sandbox-infrastructure.mjs');
});
