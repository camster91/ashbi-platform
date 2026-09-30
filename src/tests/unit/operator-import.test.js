import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectMediaFile,
  normalizeEmail,
  parseCsv,
  parseIsoTimestamp,
  pendingRollbackFiles,
  readCsvTable,
  removeRolledBackFiles,
  removeUncommittedFiles,
  safeFileName,
  summaryWithPendingFiles,
  truncateCodePoints,
  withOrphanedFiles,
} from '../../services/operator-import-common.js';
import {
  LOOM_FILE_TYPES,
  parseLoomManifestRow,
  parseLoomUrl,
  readLoomImport,
  runLoomImport,
} from '../../services/loom-import.service.js';
import {
  markupCommentKey,
  markupSessionKey,
  parseMarkupCommentRow,
  parseMarkupPin,
  readMarkupImport,
  resolveMarkupThreads,
  runMarkupImport,
} from '../../services/markup-import.service.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const loomFixture = path.join(fixtures, 'loom-import-basic');
const markupFixture = path.join(fixtures, 'markup-import-basic');
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

function tempCopy(fixture) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-operator-import-'));
  fs.cpSync(fixture, directory, { recursive: true });
  return directory;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

test('parseCsv handles quotes, escaped quotes, embedded newlines, CRLF, a BOM and blank lines', () => {
  const records = parseCsv('\uFEFFa,b,c\r\n"x, y","say ""hi""","line 1\nline 2"\r\n\r\n1,,3\n');
  assert.deepEqual(records, [
    { line: 1, values: ['a', 'b', 'c'] },
    { line: 2, values: ['x, y', 'say "hi"', 'line 1\nline 2'] },
    { line: 5, values: ['1', '', '3'] },
  ]);
  assert.deepEqual(parseCsv('a,b'), [{ line: 1, values: ['a', 'b'] }], 'no trailing newline');
  assert.deepEqual(parseCsv('a,""\n'), [{ line: 1, values: ['a', ''] }]);
});

test('parseCsv rejects unterminated and stray quotes instead of guessing', () => {
  assert.throws(() => parseCsv('a,"b\n'), (error) => error.code === 'INVALID_CSV' && /unterminated/.test(error.message));
  assert.throws(() => parseCsv('a,b"c\n'), (error) => error.code === 'INVALID_CSV');
  assert.throws(() => parseCsv('a,"b"c\n'), (error) => error.code === 'INVALID_CSV');
});

test('readCsvTable requires the template columns and reports bad rows and unknown columns', () => {
  assert.throws(() => readCsvTable('a,b\n1,2\n', { columns: ['a', 'c'] }), (error) => error.code === 'MISSING_COLUMNS' && /c/.test(error.message));
  assert.throws(() => readCsvTable('', { columns: ['a'] }), (error) => error.code === 'INVALID_CSV');
  assert.throws(() => readCsvTable('a,a\n', { columns: ['a'] }), (error) => error.code === 'INVALID_CSV' && /repeats/.test(error.message));
  const table = readCsvTable(' A ,b,extra\n 1 , 2 ,x\n3,4\n', { columns: ['a', 'b'], optional: ['description'] });
  assert.deepEqual(table.rows, [{ __line: 2, a: '1', b: '2', description: '' }]);
  assert.deepEqual(table.rowErrors, [{ row: 3, error: 'Expected 3 fields, found 2' }]);
  assert.deepEqual(table.unknownColumns, ['extra']);
});

test('timestamps must be ISO 8601 with an offset; emails and file names are normalised strictly', () => {
  assert.equal(parseIsoTimestamp('2025-03-04T10:15:00-05:00').toISOString(), '2025-03-04T15:15:00.000Z');
  assert.equal(parseIsoTimestamp('2025-03-04T10:15Z').toISOString(), '2025-03-04T10:15:00.000Z');
  assert.equal(parseIsoTimestamp('2025-03-04T10:15:00.123+01:00').toISOString(), '2025-03-04T09:15:00.123Z');
  for (const bad of ['2025-03-04T10:15:00', '2025-03-04', '2025-13-01T00:00:00Z', '2025-03-04 10:15:00Z', 'yesterday', '', null]) {
    assert.equal(parseIsoTimestamp(bad), null, String(bad));
  }
  // Impossible calendar days are rejected instead of rolled into next month.
  for (const bad of ['2025-02-31T10:00:00Z', '2025-02-29T10:00:00Z', '1900-02-29T00:00:00Z', '2025-04-31T00:00:00+02:00', '2025-06-31T23:59:59-05:00']) {
    assert.equal(parseIsoTimestamp(bad), null, bad);
  }
  assert.equal(parseIsoTimestamp('2024-02-29T10:00:00Z').toISOString(), '2024-02-29T10:00:00.000Z', 'leap day');
  assert.equal(parseIsoTimestamp('2000-02-29T00:00:00Z').toISOString(), '2000-02-29T00:00:00.000Z', 'leap century');
  assert.equal(parseIsoTimestamp('2025-12-31T23:30:00-05:00').toISOString(), '2026-01-01T04:30:00.000Z', 'the offset may cross a month boundary');
  assert.equal(normalizeEmail(' Alice@Example.TEST '), 'alice@example.test');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail(''), null);
  assert.equal(safeFileName(' video.mp4 '), 'video.mp4');
  for (const bad of ['../secret.mp4', 'dir/video.mp4', 'dir\\video.mp4', '..', '.', '', 'bad\u0000.mp4', 'rtl\u202Egnp.mp4', 'x'.repeat(256)]) {
    assert.equal(safeFileName(bad), null, JSON.stringify(bad));
  }
});

test('inspectMediaFile applies the upload policy without reading oversized files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-inspect-'));
  try {
    fs.copyFileSync(path.join(loomFixture, 'kickoff.mp4'), path.join(directory, 'ok.mp4'));
    fs.writeFileSync(path.join(directory, 'big.mp4'), '');
    fs.truncateSync(path.join(directory, 'big.mp4'), MAX_UPLOAD_SIZE + 1);
    fs.writeFileSync(path.join(directory, 'fake.webm'), 'text, not EBML');
    fs.writeFileSync(path.join(directory, 'clip.mov'), 'x');
    fs.writeFileSync(path.join(directory, 'double.v2.mp4'), fs.readFileSync(path.join(loomFixture, 'kickoff.mp4')));
    fs.symlinkSync(path.join(directory, 'ok.mp4'), path.join(directory, 'link.mp4'));
    const code = async (name) => (await inspectMediaFile(directory, name, LOOM_FILE_TYPES)).problem?.code ?? null;
    assert.equal(await code('ok.mp4'), null);
    assert.equal(await code('big.mp4'), 'FILE_TOO_LARGE');
    assert.equal(await code('fake.webm'), 'INVALID_CONTENT');
    assert.equal(await code('clip.mov'), 'UNSUPPORTED_TYPE');
    assert.equal(await code('double.v2.mp4'), 'INVALID_CONTENT');
    assert.equal(await code('link.mp4'), 'UNSAFE_PATH');
    assert.equal(await code('absent.mp4'), 'MISSING_FILE');
    const ok = await inspectMediaFile(directory, 'ok.mp4', LOOM_FILE_TYPES);
    assert.match(ok.sha256, /^[0-9a-f]{64}$/);
    assert.equal(ok.mimeType, 'video/mp4');
    const big = await inspectMediaFile(directory, 'big.mp4', LOOM_FILE_TYPES);
    assert.equal(big.size, MAX_UPLOAD_SIZE + 1);
    assert.match(big.sha256, /^[0-9a-f]{64}$/, 'oversized files are still hashed for reconciliation');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ── Loom ─────────────────────────────────────────────────────────────────────

test('parseLoomUrl accepts share and embed links and canonicalises them', () => {
  const id = '0123456789abcdef0123456789abcdef';
  const canonical = { videoId: id, loomUrl: `https://www.loom.com/share/${id}` };
  assert.deepEqual(parseLoomUrl(`https://www.loom.com/share/${id}`), canonical);
  assert.deepEqual(parseLoomUrl(`https://loom.com/embed/${id}?sid=abc#t=10`), canonical);
  assert.deepEqual(parseLoomUrl(`https://www.loom.com/share/Client-Kickoff-${id.toUpperCase()}`), canonical);
  for (const bad of [
    `http://www.loom.com/share/${id}`, `https://loom.com.evil.test/share/${id}`, `https://user:pw@www.loom.com/share/${id}`,
    `https://www.loom.com/looms/${id}`, 'https://www.loom.com/share/', 'not a url', '',
  ]) {
    assert.equal(parseLoomUrl(bad), null, bad);
  }
});

test('parseLoomManifestRow reports every problem of an invalid row as one blocking finding', () => {
  const row = { __line: 7, loom_url: 'https://example.test/x', title: '', created_at: '2025-01-01', owner_email: 'x', file_name: 'a.mp4', project_id: '' };
  const { error } = parseLoomManifestRow(row);
  assert.equal(error.code, 'INVALID_ROW');
  assert.equal(error.row, 7);
  for (const column of ['loom_url', 'title', 'created_at', 'project_id']) assert.match(error.error, new RegExp(column));
  assert.equal(parseLoomManifestRow({ ...row, file_name: '../a.mp4' }).error.code, 'UNSAFE_PATH');
  const { item } = parseLoomManifestRow({
    __line: 2, loom_url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef', title: ' Demo\u202E ',
    created_at: '2025-01-01T00:00:00Z', owner_email: 'nobody', file_name: 'a.mp4', project_id: 'p1', description: '',
  });
  assert.equal(item.title, 'Demo');
  assert.equal(item.ownerEmail, null, 'a malformed owner email is treated as unknown, not fatal');
  assert.equal(item.description, null);
  // Title and description feed the content hash, so overlong values are
  // invalid rows, never truncated.
  const valid = {
    __line: 3, loom_url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef', title: 't'.repeat(200),
    created_at: '2025-01-01T00:00:00Z', owner_email: '', file_name: 'a.mp4', project_id: 'p1', description: 'd'.repeat(5000),
  };
  assert.equal(parseLoomManifestRow(valid).item.title, 't'.repeat(200));
  assert.equal(parseLoomManifestRow(valid).item.description, 'd'.repeat(5000));
  assert.match(parseLoomManifestRow({ ...valid, title: `${'t'.repeat(200)}!` }).error.error, /title is longer than 200 characters/);
  assert.match(parseLoomManifestRow({ ...valid, description: `${'d'.repeat(5000)}!` }).error.error, /description is longer than 5000 characters/);
});

test('readLoomImport inspects the fixture: supported, unsupported and mismatched files', async () => {
  const data = await readLoomImport(loomFixture);
  assert.deepEqual(data.findings, { errors: [], warnings: [] });
  assert.equal(data.rows, 4);
  assert.deepEqual(data.items.map((item) => [item.fileName, item.file.problem?.code ?? null]), [
    ['kickoff.mp4', null], ['homepage.webm', null], ['capture.mov', 'UNSUPPORTED_TYPE'], ['broken.mp4', 'INVALID_CONTENT'],
  ]);
  assert.ok(data.items.every((item) => /^[0-9a-f]{64}$/.test(item.contentSha256)));
});

test('readLoomImport blocks duplicate videos and files, bad rows, and refuses a ZIP or a missing manifest', async () => {
  const directory = tempCopy(loomFixture);
  try {
    const manifest = path.join(directory, 'loom-manifest.csv');
    const original = fs.readFileSync(manifest, 'utf8');
    fs.writeFileSync(manifest, `${original}`
      + 'https://www.loom.com/share/0123456789abcdef0123456789abcdef,Again,2025-01-01T00:00:00Z,,other.mp4,p,\n'
      + 'https://www.loom.com/share/ffffffffffffffffffffffffffffffff,Same file,2025-01-01T00:00:00Z,,kickoff.mp4,p,\n'
      + 'https://www.loom.com/share/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee,No date,,,e.mp4,p,\n'
      + 'too,few,fields\n');
    const data = await readLoomImport(directory);
    assert.deepEqual(data.findings.errors.map((error) => error.code).sort(), ['DUPLICATE_FILE', 'DUPLICATE_SOURCE', 'INVALID_ROW', 'INVALID_ROW']);
    fs.writeFileSync(path.join(directory, 'export.zip'), 'PK');
    await assert.rejects(readLoomImport(path.join(directory, 'export.zip')), (error) => error.code === 'ZIP_NOT_SUPPORTED');
    fs.rmSync(manifest);
    await assert.rejects(readLoomImport(directory), (error) => error.code === 'MISSING_FILE');
    await assert.rejects(readLoomImport(path.join(directory, 'absent')), (error) => error.code === 'MISSING_INPUT');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Minimal read-only Prisma stand-in for dry runs: equality and `in`.
function fakeDb(tables) {
  const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => (
    condition && typeof condition === 'object' && 'in' in condition ? condition.in.includes(row[key]) : row[key] === condition
  ));
  const writes = [];
  const delegate = (name) => ({
    findMany: async ({ where } = {}) => (tables[name] ?? []).filter((row) => matches(row, where)),
    findFirst: async ({ where } = {}) => (tables[name] ?? []).find((row) => matches(row, where)) ?? null,
    count: async ({ where } = {}) => (tables[name] ?? []).filter((row) => matches(row, where)).length,
    create: async () => { writes.push(name); throw new Error('dry run must not write'); },
    createMany: async () => { writes.push(name); throw new Error('dry run must not write'); },
  });
  return new Proxy({ writes }, { get: (target, name) => (name === 'writes' ? writes : delegate(name)) });
}

const people = [
  { id: 'op', organizationId: 'org', email: 'ops@example.test', role: 'ADMIN', isActive: true, name: 'Ops' },
  { id: 'alice', organizationId: 'org', email: 'alice@example.test', role: 'TEAM', isActive: true, name: 'Alice' },
  { id: 'carla', organizationId: 'org', email: 'carla@example.test', role: 'CLIENT', isActive: true, name: 'Carla' },
];

test('Loom dry run classifies the exception taxonomy and writes nothing', async () => {
  const directory = tempCopy(loomFixture);
  try {
    const manifest = path.join(directory, 'loom-manifest.csv');
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replaceAll('{{PROJECT_ID}}', 'p1').replaceAll('{{ALICE_EMAIL}}', 'alice@example.test')
      + 'https://www.loom.com/share/99999999999999999999999999999999,Gone,2025-01-01T00:00:00Z,carla@example.test,gone.mp4,p1,\n'
      + 'https://www.loom.com/share/88888888888888888888888888888888,Elsewhere,2025-01-01T00:00:00Z,alice@example.test,kickoff-2.mp4,p-other,\n');
    fs.copyFileSync(path.join(directory, 'kickoff.mp4'), path.join(directory, 'kickoff-2.mp4'));
    const importData = await readLoomImport(directory);
    const db = fakeDb({ user: people, project: [{ id: 'p1', organizationId: 'org' }] });
    await assert.rejects(runLoomImport(db, { organizationId: 'org', importData, operatorEmail: 'carla@example.test' }), (error) => error.code === 'UNKNOWN_OPERATOR');
    const report = await runLoomImport(db, { organizationId: 'org', importData, operatorEmail: 'OPS@example.test' });
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.complete, false);
    assert.deepEqual(report.errors.map((error) => error.code).sort(), ['MISSING_FILE', 'UNKNOWN_PROJECT']);
    assert.deepEqual(report.unsupported.map((item) => item.code), ['UNSUPPORTED_TYPE', 'INVALID_CONTENT']);
    assert.equal(report.totals.planned, 2);
    assert.deepEqual(report.exceptions, { MISSING_FILE: 1, UNKNOWN_PROJECT: 1, UNKNOWN_OWNER: 1, UNSUPPORTED_TYPE: 1, INVALID_CONTENT: 1 });
    assert.deepEqual(db.writes, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ── MarkUp.io ────────────────────────────────────────────────────────────────

test('parseMarkupPin normalises percent coordinates into the unit square', () => {
  assert.deepEqual(parseMarkupPin('', ''), { pin: null });
  assert.deepEqual(parseMarkupPin('25', '40'), { pin: { x: 0.25, y: 0.4 } });
  assert.deepEqual(parseMarkupPin('0', '100'), { pin: { x: 0, y: 1 } });
  assert.deepEqual(parseMarkupPin('33.33333', '66.666666'), { pin: { x: 0.333333, y: 0.666667 } });
  assert.equal(parseMarkupPin('100.1', '5').problem.code, 'COORDINATES_OUT_OF_RANGE');
  assert.equal(parseMarkupPin('-1', '5').problem.code, 'COORDINATES_OUT_OF_RANGE');
  assert.equal(parseMarkupPin('5', '').problem.code, 'INVALID_COORDINATES');
  assert.equal(parseMarkupPin('5px', '5').problem.code, 'INVALID_COORDINATES');
  assert.equal(parseMarkupPin('1e2', '5').problem.code, 'INVALID_COORDINATES');
});

test('parseMarkupCommentRow validates status, page, text and ids', () => {
  const row = {
    __line: 4, markup_project: 'Site', file_name: 'home.png', comment_id: 'c1', page: '', x_percent: '1', y_percent: '2',
    author_email: 'Someone@Example.test', author_name: '', comment: ' Hello ', status: 'Resolved',
    created_at: '2025-06-01T10:00:00+02:00', thread_id: 't1', parent_comment_id: '',
  };
  const { comment } = parseMarkupCommentRow(row);
  assert.equal(comment.body, 'Hello');
  assert.equal(comment.status, 'resolved');
  assert.equal(comment.authorEmail, 'someone@example.test');
  assert.equal(comment.authorName, 'someone', 'a blank display name falls back to the email local part');
  assert.equal(comment.sourceKey, 'markup:Site/home.png/c1');
  const invalid = (overrides) => parseMarkupCommentRow({ ...row, ...overrides }).error;
  assert.match(invalid({ status: 'pending' }).error, /status/);
  assert.match(invalid({ page: '0' }).error, /page/);
  assert.match(invalid({ page: 'two' }).error, /page/);
  assert.match(invalid({ comment: '   ' }).error, /empty/);
  assert.match(invalid({ comment: 'x'.repeat(5001) }).error, /5000/);
  assert.match(invalid({ comment_id: '' }).error, /comment_id/);
  assert.match(invalid({ parent_comment_id: 'c1' }).error, /itself/);
  assert.match(invalid({ created_at: '2025-06-01' }).error, /created_at/);
  assert.equal(invalid({ file_name: '../home.png' }).code, 'UNSAFE_PATH');
  // markup_project is part of the session identity, so it is never truncated.
  assert.equal(parseMarkupCommentRow({ ...row, markup_project: 'p'.repeat(200) }).comment.markupProject, 'p'.repeat(200));
  assert.match(invalid({ markup_project: `${'p'.repeat(200)}A` }).error, /markup_project is longer than 200/);
  // author_name is part of the content hash too: checked, never cut.
  assert.equal(parseMarkupCommentRow({ ...row, author_name: 'a'.repeat(120) }).comment.authorName, 'a'.repeat(120));
  assert.match(invalid({ author_name: 'a'.repeat(121) }).error, /author_name is longer than 120 characters/);
});

test('the MarkUp rollback locks attachments before review sessions (the insert order of a new version)', () => {
  const source = fs.readFileSync(new URL('../../services/markup-import.service.js', import.meta.url), 'utf8');
  const rollback = source.slice(source.indexOf('export async function rollbackMarkupImportRun'));
  const attachments = rollback.indexOf("lockRowsForUpdate(transaction, 'attachments'");
  const sessions = rollback.indexOf("lockRowsForUpdate(transaction, 'review_sessions'");
  assert.ok(attachments > 0 && sessions > 0 && attachments < sessions, 'attachment locks come first');
  assert.ok(rollback.indexOf('lockImportRun(transaction, runId)') < attachments, 'the run lock comes before both');
});

test('MarkUp source keys are unambiguous for names containing separators', () => {
  assert.notEqual(markupSessionKey('a/b', 'c'), markupSessionKey('a', 'b/c'));
  assert.equal(markupCommentKey('Site #1', 'home.png', 'c/1'), 'markup:Site%20%231/home.png/c%2F1');
});

test('readMarkupImport groups sessions and blocks page mismatches and duplicate comment ids', async () => {
  const data = await readMarkupImport(markupFixture);
  assert.deepEqual(data.findings, { errors: [], warnings: [] });
  assert.deepEqual(data.sessions.map((session) => [session.fileName, session.kind, session.file.problem?.code ?? null, session.comments.length]), [
    ['homepage.png', 'image', null, 7], ['brief.pdf', 'pdf', null, 2], ['logo.svg', null, 'UNSUPPORTED_TYPE', 1],
  ]);
  const directory = tempCopy(markupFixture);
  try {
    const csv = path.join(directory, 'markup-comments.csv');
    fs.appendFileSync(csv, ''
      + 'Website redesign,homepage.png,c1,,1,1,,Dup,Duplicate id,open,2025-06-01T10:00:00Z,t1,\n'
      + 'Website redesign,homepage.png,x1,3,1,1,,Page,Page on an image,open,2025-06-01T10:00:00Z,t5,\n'
      + 'Website redesign,brief.pdf,x2,,1,1,,Pin,Pin without page,open,2025-06-01T10:00:00Z,t6,\n');
    const withErrors = await readMarkupImport(directory);
    assert.deepEqual(withErrors.findings.errors.map((error) => [error.code, error.error]), [
      ['DUPLICATE_SOURCE', 'comment_id is already used on row 2 for this file'],
      ['INVALID_ROW', 'page must be blank for an image'],
      ['INVALID_ROW', 'A pin on a PDF needs its page'],
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('resolveMarkupThreads joins nested replies to their root and reports cycles', () => {
  const comment = (commentId, parentCommentId, minute) => ({
    commentId, parentCommentId, row: minute, sourceKey: commentId, createdAt: new Date(Date.UTC(2025, 0, 1, 0, minute)),
  });
  const session = { comments: [comment('r2', 'r1', 3), comment('r1', 'root', 2), comment('root', null, 1), comment('x', 'y', 4), comment('y', 'x', 5), comment('o', 'outside', 6)] };
  session.byId = new Map(session.comments.map((entry) => [entry.commentId, entry]));
  const errors = resolveMarkupThreads(session);
  assert.deepEqual(errors.map((error) => error.code), ['INVALID_ROW', 'INVALID_ROW']);
  const byId = session.byId;
  assert.equal(byId.get('r2').rootCommentId, 'root');
  assert.equal(byId.get('r1').rootCommentId, 'root');
  assert.equal(byId.get('o').externalParentId, 'outside');
  assert.ok(byId.get('x').cycle && byId.get('y').cycle);
  assert.equal(session.comments[0].commentId, 'root', 'roots are ordered before replies');
});

test('MarkUp dry run flags unknown authors, pins and parents, and refuses an unknown project', async () => {
  const directory = tempCopy(markupFixture);
  try {
    const csv = path.join(directory, 'markup-comments.csv');
    fs.writeFileSync(csv, fs.readFileSync(csv, 'utf8').replaceAll('{{ALICE_EMAIL}}', 'alice@example.test'));
    const importData = await readMarkupImport(directory);
    const db = fakeDb({ user: people, project: [{ id: 'p1', organizationId: 'org' }] });
    const report = await runMarkupImport(db, { organizationId: 'org', projectId: 'p1', importData, operatorEmail: 'ops@example.test' });
    assert.equal(report.complete, true);
    assert.equal(report.totals.sessionsPlanned, 2);
    assert.equal(report.totals.commentsPlanned, 9);
    assert.deepEqual(report.exceptions, { COORDINATES_OUT_OF_RANGE: 1, PARENT_MISSING: 1, UNKNOWN_AUTHOR: 1, UNSUPPORTED_TYPE: 1 });
    assert.deepEqual(db.writes, []);
    const unknown = await runMarkupImport(db, { organizationId: 'org', projectId: 'p-other', importData, operatorEmail: 'ops@example.test' });
    assert.equal(unknown.complete, false);
    assert.deepEqual(unknown.errors.map((error) => error.code), ['UNKNOWN_PROJECT']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ── Schema, tenancy and CLI wiring ──────────────────────────────────────────

test('Loom and MarkUp ledgers are tenant scoped, unique per source, and migrated atomically', async () => {
  const read = (relative) => fs.promises.readFile(new URL(relative, import.meta.url), 'utf8');
  const [schema, tenantProxy, migration, loomCli, markupCli] = await Promise.all([
    read('../../../prisma/schema.prisma'),
    read('../../utils/prisma-tenant-proxy.js'),
    read('../../../prisma/migrations/20260930120000_loom_markup_import/migration.sql'),
    read('../../../scripts/import-loom.mjs'),
    read('../../../scripts/import-markup.mjs'),
  ]);
  for (const [model, table] of [['LoomImportRecord', 'loom_import_records'], ['MarkupImportRecord', 'markup_import_records']]) {
    const body = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))[1];
    assert.match(body, /@@unique\(\[organizationId, sourceKey\]\)/);
    assert.match(body, new RegExp(`@@map\\("${table}"\\)`));
  }
  assert.match(tenantProxy, /'importrun', 'slackimportrecord', 'loomimportrecord', 'markupimportrecord'/);
  assert.match(tenantProxy, /loomimportrecord: \[/);
  assert.match(tenantProxy, /markupimportrecord: \[/);
  const statements = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    .split(';').map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements[1], "SET LOCAL lock_timeout = '5s'");
  assert.equal(statements.at(-1), 'COMMIT');
  assert.match(migration, /markup_import_records_kind_check/);
  for (const cli of [loomCli, markupCli]) {
    assert.match(cli, /runTenantJob\(prisma, organizationId/);
    assert.match(cli, /flag: 'wx', mode: 0o600/);
    assert.match(cli, /const apply = process\.argv\.includes\('--apply'\)/, 'live runs need an explicit --apply');
  }
});

test('rollback file cleanup keeps unremoved paths on the run so a rerun can retry them', async () => {
  // A fake client: the run row, with the lock and read/update the helper uses.
  const run = { summary: summaryWithPendingFiles({ created: 2 }, ['/uploads/a.mp4', '/uploads/b.mp4', '/uploads/c.mp4']) };
  const locks = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { locks.push([strings.join('?'), values]); return []; },
    importRun: {
      findUnique: async () => ({ summary: run.summary }),
      update: async ({ data }) => { run.summary = data.summary; },
    },
  };
  const db = { $transaction: async (work) => work(tx) };
  assert.deepEqual(run.summary, { created: 2, pendingFileCleanup: ['/uploads/a.mp4', '/uploads/b.mp4', '/uploads/c.mp4'] });
  assert.deepEqual(pendingRollbackFiles({ summary: null }), []);
  assert.deepEqual(pendingRollbackFiles({ summary: { pendingFileCleanup: 'nope' } }), []);

  // This call tries a and b; b fails. c belongs to a concurrent attempt and
  // must survive: only the paths this call removed are subtracted.
  const unlinkFailingB = async (storedPath) => { if (storedPath.endsWith('b.mp4')) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
  await assert.rejects(
    removeRolledBackFiles(db, { runId: 'run1', paths: ['/uploads/a.mp4', '/uploads/b.mp4'], unlink: unlinkFailingB }),
    (error) => error.code === 'FILE_CLEANUP_INCOMPLETE' && /run1/.test(error.message),
  );
  assert.match(locks[0][0], /FROM "import_runs" WHERE id = \? FOR UPDATE/);
  assert.deepEqual(locks[0][1], ['run1']);
  assert.deepEqual(run.summary, { created: 2, pendingFileCleanup: ['/uploads/b.mp4', '/uploads/c.mp4'] });

  const removed = await removeRolledBackFiles(db, { runId: 'run1', paths: pendingRollbackFiles(run), unlink: async () => {} });
  assert.equal(removed, 2);
  assert.deepEqual(run.summary, { created: 2 }, 'the pending list is cleared once every file is gone');
});

test('truncateCodePoints never splits a surrogate pair', () => {
  const title = `${'a'.repeat(199)}😀`;
  assert.equal(title.length, 201, 'the emoji is two UTF-16 units');
  assert.equal(truncateCodePoints(title, 200), title, 'a 200-code-point title is kept whole');
  assert.equal(truncateCodePoints(`${title}b`, 200), title);
  assert.equal(truncateCodePoints(`${'a'.repeat(200)}😀`, 200), 'a'.repeat(200));
  assert.equal(truncateCodePoints(null, 5), '');
  assert.ok(!/[\uD800-\uDFFF]$/.test(truncateCodePoints(`${'a'.repeat(199)}😀😀`, 200).slice(-1)) || truncateCodePoints(`${'a'.repeat(199)}😀😀`, 200).endsWith('😀'));
});

test('files a rolled-back live run could not remove are named in its error, never swallowed', async () => {
  const removed = [];
  const unlink = async (storedPath) => {
    if (storedPath.includes('stuck')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    removed.push(storedPath);
  };
  const orphaned = await removeUncommittedFiles(['/uploads/a.png', '/uploads/stuck.pdf', '/uploads/b.png'], unlink);
  assert.deepEqual(removed, ['/uploads/a.png', '/uploads/b.png'], 'one failure does not stop the others');
  assert.deepEqual(orphaned, ['/uploads/stuck.pdf']);

  const original = new Error('Live import cannot complete with unresolved reconciliation findings');
  const reported = withOrphanedFiles(original, orphaned);
  assert.equal(reported, original, 'the original error (and its type) is kept');
  assert.deepEqual(reported.orphanedFiles, ['/uploads/stuck.pdf']);
  assert.match(reported.message, /^Live import cannot complete.*; 1 stored file\(s\) .* must be deleted manually: \/uploads\/stuck\.pdf$/);
  const untouched = new Error('x');
  assert.equal(withOrphanedFiles(untouched, []).message, 'x');
});
