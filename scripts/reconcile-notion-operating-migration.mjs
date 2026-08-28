#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  prepareNotionOperatingMigrationReconciliation,
  verifyNotionOperatingMigrationReconciliation,
} from '../src/services/notionOperatingMigrationReconciliation.service.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const readArtifact = (filePath) => {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};
const paths = {
  notion: option('--notion'), before: option('--before-inventory'), after: option('--after-inventory'),
  plan: option('--plan'), result: option('--result'), output: option('--output'),
};
const organizationId = option('--organization-id')?.trim();
const reconciledAt = option('--reconciled-at');

if (Object.values(paths).some(value => !value) || !organizationId || !reconciledAt) {
  console.error('Usage: npm run reconcile:notion-operating-migration -- --organization-id <sandbox-id> --notion <snapshot.json> --before-inventory <inventory.json> --after-inventory <inventory.json> --plan <ready-plan.json> --result <completed-result.json> --reconciled-at <ISO> --output <new-reconciliation.json>');
  process.exitCode = 2;
} else {
  let descriptor;
  try {
    const notion = readArtifact(paths.notion);
    const before = readArtifact(paths.before);
    const after = readArtifact(paths.after);
    const plan = readArtifact(paths.plan);
    const result = readArtifact(paths.result);
    const inputs = {
      organizationId, notionSnapshotSha256: notion.sha256,
      beforeInventory: before.value, beforeInventorySha256: before.sha256,
      afterInventory: after.value, afterInventorySha256: after.sha256,
      plan: plan.value, planSha256: plan.sha256,
      result: result.value, resultSha256: result.sha256,
      reconciledAt,
    };
    const reconciliation = prepareNotionOperatingMigrationReconciliation(inputs);
    const verification = verifyNotionOperatingMigrationReconciliation({ ...inputs, record: reconciliation });
    if (!verification.valid) throw new Error('the generated reconciliation did not verify');
    const output = path.resolve(paths.output);
    descriptor = fs.openSync(output, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(reconciliation, null, 2)}\n`, 'utf8');
    fs.chmodSync(output, 0o600);
    console.log(`${reconciliation.status}: ${reconciliation.summary.actionsApplied} planned action(s), ${reconciliation.summary.findings} finding(s); no records changed.`);
    if (!reconciliation.complete) process.exitCode = 2;
  } catch (error) {
    console.error(`Notion operating migration reconciliation failed: ${error.message}`);
    process.exitCode = 2;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
