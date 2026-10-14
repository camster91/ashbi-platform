CREATE TABLE "workspace_pages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "parentId" TEXT,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspace_pages_bounds" CHECK ("revision" >= 0 AND char_length("title") BETWEEN 1 AND 200 AND char_length("content") <= 50000),
  CONSTRAINT "workspace_pages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_pages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workspace_pages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "workspace_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "workspace_pages_organizationId_idx" ON "workspace_pages"("organizationId");
CREATE INDEX "workspace_pages_organizationId_archivedAt_id_idx" ON "workspace_pages"("organizationId", "archivedAt", "id");
CREATE INDEX "workspace_pages_parentId_idx" ON "workspace_pages"("parentId");
CREATE INDEX "workspace_pages_authorId_idx" ON "workspace_pages"("authorId");

CREATE FUNCTION workspace_page_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_org TEXT; parent_archived TIMESTAMP(3); current_parent TEXT; seen TEXT[]; author_org TEXT; depth INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'Workspace page organization cannot change';
  END IF;
  -- Serialize graph writes inside one organization, including competing moves.
  PERFORM 1 FROM "organizations" WHERE "id" = NEW."organizationId" FOR UPDATE;
  SELECT "organizationId" INTO author_org FROM "users" WHERE "id" = NEW."authorId" FOR SHARE;
  IF author_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Workspace page author belongs to another organization'; END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT "organizationId", "archivedAt" INTO parent_org, parent_archived FROM "workspace_pages" WHERE "id" = NEW."parentId";
    IF parent_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Workspace page parent belongs to another organization'; END IF;
    IF parent_archived IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."parentId" IS DISTINCT FROM OLD."parentId") THEN RAISE EXCEPTION 'Workspace page parent is archived'; END IF;
    seen := ARRAY[NEW."id"]; current_parent := NEW."parentId"; depth := 0;
    WHILE current_parent IS NOT NULL LOOP
      IF current_parent = ANY(seen) THEN RAISE EXCEPTION 'Workspace page hierarchy cycle'; END IF;
      IF depth >= 200 THEN RAISE EXCEPTION 'Workspace page hierarchy exceeds supported depth'; END IF;
      seen := array_append(seen, current_parent); depth := depth + 1;
      SELECT "parentId" INTO current_parent FROM "workspace_pages" WHERE "id" = current_parent;
    END LOOP;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW."revision" := OLD."revision" + 1; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_page_scope_guard BEFORE INSERT OR UPDATE ON "workspace_pages" FOR EACH ROW EXECUTE FUNCTION workspace_page_scope_guard();

CREATE FUNCTION workspace_page_archive_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL THEN
    UPDATE "workspace_pages" SET "parentId" = NEW."parentId", "updatedAt" = CURRENT_TIMESTAMP WHERE "parentId" = NEW."id" AND "archivedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_page_archive_children AFTER UPDATE ON "workspace_pages" FOR EACH ROW EXECUTE FUNCTION workspace_page_archive_children();

CREATE FUNCTION workspace_page_author_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" AND EXISTS (SELECT 1 FROM "workspace_pages" WHERE "authorId" = OLD."id" AND "organizationId" IS DISTINCT FROM NEW."organizationId") THEN
    RAISE EXCEPTION 'Workspace page author cannot move to another organization';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_page_author_transfer_guard BEFORE UPDATE OF "organizationId" ON "users" FOR EACH ROW EXECUTE FUNCTION workspace_page_author_transfer_guard();
