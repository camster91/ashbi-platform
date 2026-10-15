BEGIN;
-- Hold writes while taking the baseline and installing capture. No overwritten
-- pre-migration content can be reconstructed by this migration.
LOCK TABLE "notes", "workspace_pages" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "note_revisions" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "noteId" TEXT NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL CHECK ("revision" >= 0),
  "title" TEXT NOT NULL, "content" TEXT NOT NULL, "type" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL, "tags" TEXT NOT NULL, "isTemplate" BOOLEAN NOT NULL,
  "audienceNodes" JSONB NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedById" TEXT
);
CREATE UNIQUE INDEX "note_revisions_noteId_revision_key" ON "note_revisions"("noteId", "revision");
CREATE INDEX "note_revisions_organizationId_noteId_revision_idx" ON "note_revisions"("organizationId", "noteId", "revision");
CREATE TABLE "workspace_page_revisions" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pageId" TEXT NOT NULL REFERENCES "workspace_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL CHECK ("revision" >= 0),
  "title" TEXT NOT NULL, "content" TEXT NOT NULL,
  "audienceNodes" JSONB NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedById" TEXT
);
CREATE UNIQUE INDEX "workspace_page_revisions_pageId_revision_key" ON "workspace_page_revisions"("pageId", "revision");
CREATE INDEX "workspace_page_revisions_organizationId_pageId_revision_idx" ON "workspace_page_revisions"("organizationId", "pageId", "revision");

-- Store metadata only from ancestors. The application's existing permission
-- algebra evaluates this immutable lineage AND today's document authorization.
CREATE FUNCTION note_history_audience(document_id TEXT) RETURNS JSONB LANGUAGE SQL VOLATILE AS $$
  WITH RECURSIVE lineage AS (
    SELECT n.*, 0 AS depth, ARRAY[n."id"] AS seen FROM "notes" n WHERE n."id" = document_id
    UNION ALL
    SELECT parent.*, child.depth + 1, child.seen || parent."id"
    FROM "notes" parent JOIN lineage child ON parent."id" = child."parentId"
    WHERE child.depth < 199 AND NOT parent."id" = ANY(child.seen)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n."id", 'organizationId', p."organizationId", 'projectId', n."projectId",
    'authorId', n."authorId", 'parentId', n."parentId", 'accessMode', n."accessMode",
    'grants', n."accessGrants", 'audienceBarrier', n."audienceBarrier"
  ) ORDER BY n.depth), '[]'::jsonb)
  FROM lineage n JOIN "projects" p ON p."id" = n."projectId";
$$;
CREATE FUNCTION workspace_page_history_audience(document_id TEXT) RETURNS JSONB LANGUAGE SQL VOLATILE AS $$
  WITH RECURSIVE lineage AS (
    SELECT p.*, 0 AS depth, ARRAY[p."id"] AS seen FROM "workspace_pages" p WHERE p."id" = document_id
    UNION ALL
    SELECT parent.*, child.depth + 1, child.seen || parent."id"
    FROM "workspace_pages" parent JOIN lineage child ON parent."id" = child."parentId"
    WHERE child.depth < 199 AND NOT parent."id" = ANY(child.seen)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p."id", 'organizationId', p."organizationId", 'authorId', p."authorId",
    'parentId', p."parentId", 'accessMode', p."accessMode", 'audienceBarrier', NULL,
    'grants', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', g."userId", 'role', g."role") ORDER BY g."userId")
      FROM "workspace_page_grants" g WHERE g."pageId" = p."id" AND g."organizationId" = p."organizationId"), '[]'::jsonb)
  ) ORDER BY p.depth), '[]'::jsonb) FROM lineage p;
$$;

INSERT INTO "note_revisions" ("id", "organizationId", "noteId", "revision", "title", "content", "type", "isPinned", "tags", "isTemplate", "audienceNodes")
  SELECT n."id" || ':' || n."revision", p."organizationId", n."id", n."revision", n."title", n."content", n."type", n."isPinned", n."tags", n."isTemplate", note_history_audience(n."id")
  FROM "notes" n JOIN "projects" p ON p."id" = n."projectId";
INSERT INTO "workspace_page_revisions" ("id", "organizationId", "pageId", "revision", "title", "content", "audienceNodes")
  SELECT p."id" || ':' || p."revision", p."organizationId", p."id", p."revision", p."title", p."content", workspace_page_history_audience(p."id") FROM "workspace_pages" p;

CREATE FUNCTION capture_note_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id TEXT; editor TEXT;
BEGIN
  SELECT "organizationId" INTO STRICT org_id FROM "projects" WHERE "id" = NEW."projectId";
  SELECT "id" INTO editor FROM "users" WHERE "id" = NULLIF(current_setting('ashbi.actor_user_id', true), '') AND "organizationId" = org_id AND "isActive";
  INSERT INTO "note_revisions" ("id", "organizationId", "noteId", "revision", "title", "content", "type", "isPinned", "tags", "isTemplate", "audienceNodes", "editedById")
    VALUES (NEW."id" || ':' || NEW."revision", org_id, NEW."id", NEW."revision", NEW."title", NEW."content", NEW."type", NEW."isPinned", NEW."tags", NEW."isTemplate", note_history_audience(NEW."id"), editor);
  DELETE FROM "note_revisions" WHERE "noteId" = NEW."id" AND "revision" NOT IN
    (SELECT "revision" FROM "note_revisions" WHERE "noteId" = NEW."id" ORDER BY "revision" DESC LIMIT 100);
  RETURN NEW;
END;
$$;
CREATE FUNCTION capture_workspace_page_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE editor TEXT; final_page "workspace_pages"%ROWTYPE;
BEGIN
  -- Grant row triggers advance the page once per roster mutation. At commit,
  -- record only the final state so a large roster cannot evict content history.
  SELECT * INTO final_page FROM "workspace_pages" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM "workspace_page_revisions" WHERE "pageId" = final_page."id" AND "revision" = final_page."revision") THEN RETURN NULL; END IF;
  SELECT "id" INTO editor FROM "users" WHERE "id" = NULLIF(current_setting('ashbi.actor_user_id', true), '') AND "organizationId" = final_page."organizationId" AND "isActive";
  INSERT INTO "workspace_page_revisions" ("id", "organizationId", "pageId", "revision", "title", "content", "audienceNodes", "editedById")
    VALUES (final_page."id" || ':' || final_page."revision", final_page."organizationId", final_page."id", final_page."revision", final_page."title", final_page."content", workspace_page_history_audience(final_page."id"), editor)
    ON CONFLICT ("pageId", "revision") DO NOTHING;
  DELETE FROM "workspace_page_revisions" WHERE "pageId" = NEW."id" AND "revision" NOT IN
    (SELECT "revision" FROM "workspace_page_revisions" WHERE "pageId" = NEW."id" ORDER BY "revision" DESC LIMIT 100);
  RETURN NEW;
END;
$$;
CREATE TRIGGER note_history_capture AFTER INSERT OR UPDATE ON "notes" FOR EACH ROW EXECUTE FUNCTION capture_note_revision();
CREATE CONSTRAINT TRIGGER workspace_page_history_capture AFTER INSERT OR UPDATE ON "workspace_pages"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_workspace_page_revision();

-- Only parent capture/retention and FK cascades may insert/remove snapshots.
-- No writer, including a nested one, can rewrite an existing snapshot.
CREATE FUNCTION document_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Document revisions are database-owned and immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER note_revision_immutable BEFORE INSERT OR UPDATE OR DELETE ON "note_revisions" FOR EACH ROW EXECUTE FUNCTION document_revision_immutable();
CREATE TRIGGER workspace_page_revision_immutable BEFORE INSERT OR UPDATE OR DELETE ON "workspace_page_revisions" FOR EACH ROW EXECUTE FUNCTION document_revision_immutable();
CREATE FUNCTION document_revision_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document revisions cannot be truncated'; END;
$$;
CREATE TRIGGER note_revision_no_truncate BEFORE TRUNCATE ON "note_revisions" FOR EACH STATEMENT EXECUTE FUNCTION document_revision_no_truncate();
CREATE TRIGGER workspace_page_revision_no_truncate BEFORE TRUNCATE ON "workspace_page_revisions" FOR EACH STATEMENT EXECUTE FUNCTION document_revision_no_truncate();
COMMIT;
