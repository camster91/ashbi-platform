import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateCoolifyReleaseWorkflow } from '../../../scripts/check-release-gates.mjs';

const source = fs.readFileSync(new URL('../../../.github/workflows/checked-coolify-deploy.yml', import.meta.url), 'utf8');
test('Coolify adoption workflow preserves checked revision and current production owner until enabled', () => {
  assert.deepEqual(validateCoolifyReleaseWorkflow(source), []);
  for (const gate of ["vars.COOLIFY_RELEASE_ENABLED == 'true'", "github.event.workflow_run.conclusion == 'success'", "github.event.workflow_run.event == 'push'", 'github.event.workflow_run.head_repository.full_name == github.repository', 'github.event.workflow_run.head_branch == github.event.repository.default_branch', 'ref.data.object.sha === run.head_sha', 'cancel-in-progress: false', 'environment: production', 'ref: ${{ github.event.workflow_run.head_sha }}']) {
    assert.ok(validateCoolifyReleaseWorkflow(source.replace(gate, 'gate removed')).length > 0, gate);
  }
});
test('manual, PR, direct push and SSH deployment paths cannot bypass release CI', () => {
  for (const trigger of ['workflow_dispatch', 'push', 'pull_request', 'repository_dispatch', 'schedule']) {
    assert.ok(validateCoolifyReleaseWorkflow(source + `\n  ${trigger}:\n`).length > 0);
  }
  assert.ok(validateCoolifyReleaseWorkflow(source + '\n  - uses: appleboy/ssh-action@v1\n').length > 0);
});
test('backup verification and encrypted artifact persistence must precede deployment', () => {
  for (const gate of ['node scripts/deploy/production-backup.mjs', 'ASHBI_VPS_KNOWN_HOSTS: ${{ vars.ASHBI_VPS_KNOWN_HOSTS }}', 'if-no-files-found: error']) {
    assert.ok(validateCoolifyReleaseWorkflow(source.replace(gate, 'removed')).length > 0);
  }
  assert.ok(validateCoolifyReleaseWorkflow(source.replace('name: Retain verified encrypted pre-deployment backup', 'name: omitted backup retention')).length > 0);
});
