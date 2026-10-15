import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
const schemaPattern = /^history_migration_[a-f0-9]{24}$/;

test('actual history migration baselines populated legacy documents without inventing earlier edits', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 60_000,
}, async () => {
  // Explicit opt-in only: never fall back to the application's DATABASE_URL.
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const db = new pg.Client({ connectionString: url });
  const schema = `history_migration_${randomBytes(12).toString('hex')}`;
  assert.match(schema, schemaPattern);
  let schemaCreated = false;
  await db.connect();
  try {
    // A dedicated connection and schema isolate this pre-migration rehearsal
    // from the fully migrated public tables used by other concurrent suites.
    await db.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await db.query(`SET search_path TO "${schema}"`);
    await db.query(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE users (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL);
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
        "parentId" TEXT, revision INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'NOTE',
        "isPinned" BOOLEAN NOT NULL DEFAULT FALSE, tags TEXT NOT NULL DEFAULT '[]',
        "isTemplate" BOOLEAN NOT NULL DEFAULT FALSE, "accessMode" TEXT NOT NULL DEFAULT 'TEAM',
        "accessGrants" JSONB NOT NULL DEFAULT '[]', "audienceBarrier" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2020-01-02 03:04:05',
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '2021-02-03 04:05:06'
      );
      CREATE TABLE workspace_pages (
        id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
        "parentId" TEXT, revision INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL, content TEXT NOT NULL, "accessMode" TEXT NOT NULL DEFAULT 'TEAM',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2020-01-02 03:04:05',
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '2021-02-03 04:05:06'
      );
      CREATE TABLE workspace_page_grants (
        id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "pageId" TEXT NOT NULL,
        "userId" TEXT NOT NULL, role TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2021-02-03 04:05:06'
      );
      INSERT INTO organizations VALUES ('org');
      INSERT INTO users VALUES ('author', 'org', TRUE), ('reader', 'org', TRUE);
      INSERT INTO projects VALUES ('project', 'org');
      INSERT INTO notes (id, "projectId", "authorId", "parentId", revision, title, content,
        "accessMode", "accessGrants", "audienceBarrier", type, "isPinned", tags, "isTemplate") VALUES
        ('private-parent', 'project', 'author', NULL, 3, 'Private parent', 'Parent current body',
          'PRIVATE', '[{"userId":"reader","role":"READ"}]', '{"reason":"fixture barrier"}', 'DOC', TRUE, '["legacy"]', TRUE),
        ('child', 'project', 'author', 'private-parent', 7, 'Nested note', 'Child current body',
          'INHERIT', '[]', NULL, 'NOTE', FALSE, '[]', FALSE),
        ('public-note', 'project', 'author', NULL, 7, 'Shared note', 'Public current body',
          'TEAM', '[]', NULL, 'WIKI', FALSE, '["shared"]', FALSE);
      INSERT INTO workspace_pages (id, "organizationId", "authorId", "parentId", revision, title, content, "accessMode") VALUES
        ('wiki-parent', 'org', 'author', NULL, 4, 'Company wiki parent', 'Wiki parent current body', 'PRIVATE'),
        ('wiki', 'org', 'author', 'wiki-parent', 11, 'Company wiki', 'Wiki current body', 'INHERIT');
      INSERT INTO workspace_page_grants (id, "organizationId", "pageId", "userId", role)
        VALUES ('grant', 'org', 'wiki-parent', 'reader', 'READ');
    `);
    const before = {};
    for (const table of ['notes', 'workspace_pages', 'workspace_page_grants']) {
      before[table] = (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
    }
    const { rows: [clock] } = await db.query('SELECT clock_timestamp()::timestamp(3) AS now');
    // Execute the committed migration verbatim, including its transaction and
    // table locks. search_path resolves every relation to this fixture schema.
    const migration = await readFile(new URL('../../../prisma/migrations/20261015200000_document_history/migration.sql', import.meta.url), 'utf8');
    await db.query(migration);

    for (const table of Object.keys(before)) {
      assert.deepEqual((await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows, before[table],
        `${table} content, revision, metadata and historical timestamps remain unchanged`);
    }
    const notes = (await db.query('SELECT * FROM note_revisions ORDER BY "noteId"')).rows;
    const pages = (await db.query('SELECT * FROM workspace_page_revisions ORDER BY "pageId"')).rows;
    assert.equal(notes.length, 3, 'one populated baseline per existing note, not fabricated revisions 0 through 7');
    assert.equal(pages.length, 2, 'one populated baseline per existing wiki page');
    for (const [rows, originals, key] of [[notes, before.notes, 'noteId'], [pages, before.workspace_pages, 'pageId']]) {
      for (const row of rows) {
        const original = originals.find(item => item.id === row[key]);
        assert.equal(row.id, `${original.id}:${original.revision}`);
        for (const field of ['revision', 'title', 'content']) assert.equal(row[field], original[field]);
        assert.equal(row.organizationId, 'org');
        assert.equal(row.editedById, null, 'an unknown historical editor is not invented');
        assert.ok(row.recordedAt.getTime() >= clock.now.getTime() - 1, 'capture time is the migration time');
        assert.notEqual(row.recordedAt.getTime(), original.updatedAt.getTime());
        assert.ok(row.audienceNodes.length > 0, 'populated content has a captured audience');
      }
    }
    for (const row of notes) {
      const original = before.notes.find(item => item.id === row.noteId);
      for (const field of ['type', 'isPinned', 'tags', 'isTemplate']) assert.equal(row[field], original[field]);
    }
    const noteAudience = original => ({
      id: original.id, organizationId: 'org', projectId: 'project', authorId: 'author',
      parentId: original.parentId, accessMode: original.accessMode,
      grants: original.accessGrants, audienceBarrier: original.audienceBarrier,
    });
    const parent = before.notes.find(row => row.id === 'private-parent');
    const child = before.notes.find(row => row.id === 'child');
    assert.deepEqual(notes.find(row => row.noteId === 'child').audienceNodes, [noteAudience(child), noteAudience(parent)]);
    assert.deepEqual(notes.find(row => row.noteId === 'public-note').audienceNodes,
      [noteAudience(before.notes.find(row => row.id === 'public-note'))]);
    const pageAudience = (id, parentId, accessMode, grants) => ({
      id, organizationId: 'org', authorId: 'author', parentId, accessMode, audienceBarrier: null, grants,
    });
    assert.deepEqual(pages.find(row => row.pageId === 'wiki').audienceNodes, [
      pageAudience('wiki', 'wiki-parent', 'INHERIT', []),
      pageAudience('wiki-parent', null, 'PRIVATE', [{ userId: 'reader', role: 'READ' }]),
    ]);

    // Parent SQL inserts exercise the installed triggers. VOLATILE audience
    // functions must see the new document itself as well as its ancestors.
    await db.query(`INSERT INTO notes (id, "projectId", "authorId", "parentId", title, content, "accessMode")
      VALUES ('new-child', 'project', 'author', 'private-parent', 'New note', 'New SQL body', 'INHERIT')`);
    const freshNote = (await db.query(`SELECT * FROM note_revisions WHERE "noteId" = 'new-child'`)).rows;
    assert.equal(freshNote.length, 1);
    assert.equal(freshNote[0].content, 'New SQL body');
    assert.deepEqual(freshNote[0].audienceNodes, [noteAudience({ ...child, id: 'new-child' }), noteAudience(parent)]);
    await db.query(`INSERT INTO workspace_pages (id, "organizationId", "authorId", "parentId", title, content, "accessMode")
      VALUES ('new-wiki', 'org', 'author', 'wiki-parent', 'New wiki', 'New wiki SQL body', 'INHERIT')`);
    const freshPage = (await db.query(`SELECT * FROM workspace_page_revisions WHERE "pageId" = 'new-wiki'`)).rows;
    assert.equal(freshPage.length, 1);
    assert.equal(freshPage[0].content, 'New wiki SQL body');
    assert.deepEqual(freshPage[0].audienceNodes, [
      pageAudience('new-wiki', 'wiki-parent', 'INHERIT', []),
      pageAudience('wiki-parent', null, 'PRIVATE', [{ userId: 'reader', role: 'READ' }]),
    ]);

    await db.query(`UPDATE notes SET "accessMode" = 'TEAM', "accessGrants" = '[]', revision = 4 WHERE id = 'private-parent'`);
    await db.query(`DELETE FROM workspace_page_grants WHERE id = 'grant'`);
    assert.deepEqual((await db.query(`SELECT * FROM note_revisions WHERE "noteId" IN ('child', 'private-parent', 'public-note') AND revision IN (3, 7) ORDER BY "noteId"`)).rows, notes,
      'later ancestor sharing changes do not rewrite captured note audiences');
    assert.deepEqual((await db.query('SELECT * FROM workspace_page_revisions WHERE revision > 0 ORDER BY "pageId"')).rows, pages,
      'removing current grants does not rewrite historical wiki audiences');
    await assert.rejects(db.query(`UPDATE note_revisions SET content = 'tampered' WHERE "noteId" = 'child'`), /database-owned and immutable/);
    await assert.rejects(db.query(`UPDATE workspace_page_revisions SET content = 'tampered' WHERE "pageId" = 'wiki'`), /database-owned and immutable/);
  } finally {
    try {
      // A failed migration may leave its own transaction aborted. Roll back
      // before cleanup; never drop or mutate the shared public schema.
      await db.query('ROLLBACK');
      await db.query('SET search_path TO public');
      assert.match(schema, schemaPattern);
      if (schemaCreated) await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await db.end();
    }
  }
});
