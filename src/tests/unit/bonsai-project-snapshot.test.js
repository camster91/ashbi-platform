import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyBonsaiProjectSnapshot } from '../../services/bonsaiProjectSnapshot.service.js';

function snapshot() {
  return {
    format: 'bonsai-project-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:12:42.150Z',
    captureEvidence: {
      connector: 'bonsai', operation: 'list_projects', pageSize: 100,
      allStatusPagesFetched: 1, allStatusFinalHasMore: false, projectCount: 3,
      lifecycleQueries: [
        { status: 'active', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
        { status: 'completed', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
        { status: 'archived', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
      ],
      lifecyclePartitionComplete: true,
    },
    projects: [
      { id: 1, title: 'Active project', public_url_token: 'active1', number: 'ACT-1', board_group_id: null, company_name: 'Client A', url: 'https://app.hellobonsai.com/projects/active1', status: 'active' },
      { id: 2, title: 'Completed project', public_url_token: 'complete2', number: 'COM-2', board_group_id: 'group', company_name: 'Client B', url: 'https://app.hellobonsai.com/projects/complete2', status: 'completed' },
      { id: 3, title: 'Archived project', public_url_token: 'archive3', number: null, board_group_id: null, company_name: 'Client C', url: 'https://app.hellobonsai.com/projects/archive3', status: 'archived' },
    ],
  };
}

test('accepts a complete all-status project snapshot with a complete lifecycle partition', () => {
  const report = verifyBonsaiProjectSnapshot(snapshot());
  assert.equal(report.valid, true);
  assert.equal(report.migrationReady, true);
  assert.equal(report.projectCount, 3);
  assert.deepEqual(report.statusCounts, { active: 1, completed: 1, archived: 1 });
  assert.deepEqual(report.findings, []);
});

test('rejects a pagination count or lifecycle partition mismatch', () => {
  const value = snapshot();
  value.captureEvidence.lifecycleQueries[0].projectCount = 2;
  const report = verifyBonsaiProjectSnapshot(value);
  assert.equal(report.valid, false);
  assert.deepEqual(report.integrityFindings, [{ code: 'INVALID_PAGINATION_OR_LIFECYCLE_EVIDENCE' }]);
});

test('separates valid capture from a project needing client identity review', () => {
  const value = snapshot();
  value.projects[0].company_name = null;
  const report = verifyBonsaiProjectSnapshot(value);
  assert.equal(report.valid, true);
  assert.equal(report.migrationReady, false);
  assert.deepEqual(report.migrationFindings, [{ code: 'PROJECT_REQUIRES_SOURCE_REVIEW', index: 0, projectId: 1, fields: ['company_name'] }]);
});

test('rejects duplicate stable project identities', () => {
  const value = snapshot();
  value.projects[1].id = 1;
  value.projects[1].public_url_token = 'active1';
  value.projects[1].url = 'https://app.hellobonsai.com/projects/active1';
  const report = verifyBonsaiProjectSnapshot(value);
  assert.equal(report.valid, false);
  assert.deepEqual(report.integrityFindings, [
    { code: 'DUPLICATE_PROJECT_ID', id: 1, indexes: [0, 1] },
    { code: 'DUPLICATE_PUBLIC_URL_TOKEN', token: 'active1', indexes: [0, 1] },
  ]);
});

test('verification command is read-only and reports generic read failures', () => {
  const script = fs.readFileSync('scripts/verify-bonsai-project-snapshot.mjs', 'utf8');
  assert.doesNotMatch(script, /writeFile|appendFile|createWriteStream|prisma|fetch\(/);
  assert.match(script, /SNAPSHOT_READ_FAILED/);
});
