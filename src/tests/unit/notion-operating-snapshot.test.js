import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NOTION_OPERATING_SOURCE,
  verifyNotionOperatingSnapshot,
} from '../../services/notionOperatingSnapshot.service.js';

function snapshot() {
  const projectUrl = 'https://app.notion.com/11111111111111111111111111111111';
  return {
    format: 'ashbi-notion-project-task-snapshot',
    version: 1,
    complete: true,
    capturedAt: '2026-08-28T00:33:38.418Z',
    workspaceHub: { pageId: NOTION_OPERATING_SOURCE.hubPageId },
    sources: {
      projects: {
        databaseId: NOTION_OPERATING_SOURCE.projectsDatabaseId,
        dataSourceUrl: NOTION_OPERATING_SOURCE.projectsDataSourceUrl,
        hasMore: false,
        rows: 1,
      },
      tasks: {
        databaseId: NOTION_OPERATING_SOURCE.tasksDatabaseId,
        dataSourceUrl: NOTION_OPERATING_SOURCE.tasksDataSourceUrl,
        hasMore: false,
        rows: 1,
      },
    },
    archivedSources: {
      projectsDataSourceUrl: NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl,
      tasksDataSourceUrl: NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl,
    },
    projects: [{
      url: projectUrl,
      createdTime: '2026-08-27 12:00:00Z',
      Project: 'Synthetic project',
      Status: 'Active',
    }],
    tasks: [{
      url: 'https://app.notion.com/22222222222222222222222222222222',
      createdTime: '2026-08-27 13:00:00Z',
      Task: 'Synthetic task',
      Status: 'To do',
      Project: JSON.stringify([projectUrl]),
    }],
  };
}

test('accepts a complete current Projects and Tasks snapshot', () => {
  const report = verifyNotionOperatingSnapshot(snapshot());
  assert.equal(report.valid, true);
  assert.equal(report.summary.projects, 1);
  assert.equal(report.summary.openTasks, 1);
  assert.deepEqual(report.findings, []);
});
test('rejects the archived legacy automation data sources as current', () => {
  const value = snapshot();
  value.sources.projects.dataSourceUrl = NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl;
  value.sources.tasks.dataSourceUrl = NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl;
  const report = verifyNotionOperatingSnapshot(value);
  assert.equal(report.valid, false);
  assert.deepEqual(report.findings, [{ code: 'OPERATING_SOURCE_IDENTITY_MISMATCH' }]);
});

test('rejects incomplete query evidence, duplicate titles, and orphan task relations', () => {
  const value = snapshot();
  value.sources.tasks.hasMore = true;
  value.projects.push({ ...value.projects[0], url: 'https://app.notion.com/33333333333333333333333333333333' });
  value.sources.projects.rows = 2;
  value.tasks[0].Project = JSON.stringify(['https://app.notion.com/44444444444444444444444444444444']);
  const report = verifyNotionOperatingSnapshot(value);
  assert.equal(report.valid, false);
  assert.deepEqual(report.findings, [
    { code: 'INCOMPLETE_QUERY_EVIDENCE' },
    { code: 'DUPLICATE_PROJECT_TITLE', value: 'synthetic project', indexes: [0, 1] },
    { code: 'INVALID_TASK_RECORD', index: 0, fields: ['Project target'] },
  ]);
});

test('verification command is read-only and emits generic read failures', () => {
  const script = fs.readFileSync('scripts/verify-notion-operating-snapshot.mjs', 'utf8');
  assert.doesNotMatch(script, /writeFile|appendFile|createWriteStream|prisma|fetch\(/);
  assert.match(script, /SNAPSHOT_READ_FAILED/);
});
