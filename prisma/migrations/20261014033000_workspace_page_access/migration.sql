ALTER TABLE "workspace_pages" ADD COLUMN "accessMode" TEXT NOT NULL DEFAULT 'TEAM', ADD COLUMN "accessRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "workspace_pages" ADD CONSTRAINT "workspace_pages_access_bounds" CHECK ("accessMode" IN ('TEAM', 'RESTRICTED') AND "accessRevision" >= 0);
CREATE TABLE "workspace_page_grants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('READ', 'EDIT')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_page_grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_page_grants_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "workspace_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_page_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "workspace_page_grants_pageId_userId_key" ON "workspace_page_grants"("pageId", "userId");
CREATE INDEX "workspace_page_grants_organizationId_idx" ON "workspace_page_grants"("organizationId");
CREATE INDEX "workspace_page_grants_userId_idx" ON "workspace_page_grants"("userId");

CREATE FUNCTION workspace_page_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "organizations" WHERE "id" = NEW."organizationId" FOR UPDATE;
  IF NEW."authorId" IS DISTINCT FROM OLD."authorId" THEN RAISE EXCEPTION 'Workspace page author cannot change'; END IF;
  IF OLD."accessMode" = 'RESTRICTED' AND OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "workspace_pages" WHERE "parentId" = OLD."id" AND "archivedAt" IS NULL) THEN
    RAISE EXCEPTION 'Move or archive nested pages before archiving a restricted page';
  END IF;
  IF NEW."accessMode" IS DISTINCT FROM OLD."accessMode" THEN NEW."accessRevision" := OLD."accessRevision" + 1;
  ELSE NEW."accessRevision" := GREATEST(OLD."accessRevision", NEW."accessRevision"); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_page_access_guard BEFORE UPDATE ON "workspace_pages" FOR EACH ROW EXECUTE FUNCTION workspace_page_access_guard();

CREATE FUNCTION workspace_page_grant_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE page_org TEXT; user_org TEXT;
BEGIN
  PERFORM 1 FROM "organizations" WHERE "id" = NEW."organizationId" FOR UPDATE;
  SELECT "organizationId" INTO page_org FROM "workspace_pages" WHERE "id" = NEW."pageId" FOR SHARE;
  SELECT "organizationId" INTO user_org FROM "users" WHERE "id" = NEW."userId" FOR SHARE;
  IF page_org IS DISTINCT FROM NEW."organizationId" OR user_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Workspace page grant belongs to another organization'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."pageId" IS DISTINCT FROM OLD."pageId" OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN RAISE EXCEPTION 'Workspace page grant identity cannot change'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_page_grant_scope_guard BEFORE INSERT OR UPDATE ON "workspace_page_grants" FOR EACH ROW EXECUTE FUNCTION workspace_page_grant_scope_guard();

CREATE FUNCTION workspace_page_grant_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD."pageId"; ELSE target := NEW."pageId"; END IF;
  UPDATE "workspace_pages" SET "accessRevision" = "accessRevision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = target;
  RETURN NULL;
END;
$$;
CREATE TRIGGER workspace_page_grant_revision AFTER INSERT OR UPDATE OR DELETE ON "workspace_page_grants" FOR EACH ROW EXECUTE FUNCTION workspace_page_grant_revision();

CREATE FUNCTION workspace_page_grantee_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" AND EXISTS (SELECT 1 FROM "workspace_page_grants" WHERE "userId" = OLD."id" AND "organizationId" IS DISTINCT FROM NEW."organizationId") THEN RAISE EXCEPTION 'Workspace page grantee cannot move to another organization'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_page_grantee_transfer_guard BEFORE UPDATE OF "organizationId" ON "users" FOR EACH ROW EXECUTE FUNCTION workspace_page_grantee_transfer_guard();
