import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBonsaiProjectCsvSnapshotBinding, assessBonsaiOperatingSourceRecord } from '../../services/bonsaiOperatingSourceRegistry.service.js';

const HASH = 'a'.repeat(64);
function snapshot() {
  return {
    format: 'bonsai-project-snapshot', version: 1, scope: 'all', complete: true, capturedAt: '2026-08-28T01:00:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_projects', pageSize: 100, allStatusPagesFetched: 1,
      allStatusFinalHasMore: false, projectCount: 1, lifecyclePartitionComplete: true,
      lifecycleQueries: [{ status: 'active', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
        { status: 'completed', pagesFetched: 1, finalHasMore: false, projectCount: 0 },
        { status: 'archived', pagesFetched: 1, finalHasMore: false, projectCount: 0 }] },
    projects: [{ id: 101, title: 'Client Site', status: 'active', public_url_token: 'clientsite', number: 'P-101',
      board_group_id: null, company_name: 'Client Inc', url: 'https://app.hellobonsai.com/projects/clientsite' }],
  };
}

test('binds every project CSV row to the complete native project snapshot', () => {
  const result = verifyBonsaiProjectCsvSnapshotBinding({ snapshot: snapshot(), snapshotSha256: HASH,
    projectRows: [{ project_id: '101', title: 'Client Site', status: 'active', client_or_company_name: 'Client Inc' }] });
  assert.deepEqual(result, { valid: true, snapshotSha256: HASH, snapshotProjects: 1, csvProjects: 1, findings: [] });
});

test('preserves missing, extra, duplicate, and changed project identities as blockers', () => {
  const changed = verifyBonsaiProjectCsvSnapshotBinding({ snapshot: snapshot(), snapshotSha256: HASH,
    projectRows: [{ project_id: '101', title: 'Other', status: 'completed', client_or_company_name: 'Other Client' },
      { project_id: '101', title: 'Client Site', status: 'active', client_or_company_name: 'Client Inc' },
      { project_id: '202', title: 'Extra', status: 'active', client_or_company_name: 'Client Inc' }] });
  assert.equal(changed.valid, false);
  assert.deepEqual(changed.findings.map(item => item.code), [
    'PROJECT_CSV_SNAPSHOT_MISMATCH', 'DUPLICATE_PROJECT_CSV_ID', 'PROJECT_CSV_ID_NOT_IN_SNAPSHOT',
  ]);
  const missing = verifyBonsaiProjectCsvSnapshotBinding({ snapshot: snapshot(), snapshotSha256: HASH, projectRows: [] });
  assert.equal(missing.findings[0].code, 'PROJECT_SNAPSHOT_ID_MISSING_FROM_CSV');
});

test('creates or exactly reuses one tenant-bound source identity', () => {
  const input = { organizationId: 'org-1', entityType: 'TASK', sourceId: 'task-1', destinationId: 'hub-task-1', sourceFingerprint: HASH };
  const created = assessBonsaiOperatingSourceRecord(input);
  assert.equal(created.operation, 'CREATE');
  assert.deepEqual(created.record, { organizationId: 'org-1', sourceSystem: 'BONSAI', entityType: 'TASK', sourceId: 'task-1',
    destinationId: 'hub-task-1', outcome: 'IMPORTED', sourceFingerprint: HASH, decisionCandidateId: null, decisionFingerprint: null });
  assert.equal(assessBonsaiOperatingSourceRecord({ ...input, existingRecord: created.record }).operation, 'REUSE');
});

test('fails closed instead of moving an existing source identity to another destination or generation', () => {
  const expected = { organizationId: 'org-1', entityType: 'PROJECT', sourceId: '101', destinationId: 'hub-project-1', sourceFingerprint: HASH };
  const original = assessBonsaiOperatingSourceRecord(expected).record;
  const moved = assessBonsaiOperatingSourceRecord({ ...expected, destinationId: 'hub-project-2', existingRecord: original });
  assert.equal(moved.operation, 'CONFLICT');
  assert.ok(moved.findings.includes('EXISTING_DESTINATION_ID_MISMATCH'));
  const changed = assessBonsaiOperatingSourceRecord({ ...expected, sourceFingerprint: 'b'.repeat(64), existingRecord: original });
  assert.ok(changed.findings.includes('EXISTING_SOURCE_FINGERPRINT_MISMATCH'));
});
