CREATE UNIQUE INDEX "tasks_id_projectId_key" ON "tasks"("id","projectId");
CREATE TABLE "resource_links" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"taskId" TEXT,
 "createdById" TEXT NOT NULL,"createIntentId" UUID NOT NULL,"inputHash" VARCHAR(64) NOT NULL,
 "title" VARCHAR(500) NOT NULL,"url" VARCHAR(8192) NOT NULL,"source" JSONB,
 "position" INTEGER NOT NULL DEFAULT 0,"revision" INTEGER NOT NULL DEFAULT 1,
 "clientVisible" BOOLEAN NOT NULL DEFAULT false,"archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "resource_links_organizationId_fkey" FOREIGN KEY("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "resource_links_projectId_organizationId_fkey" FOREIGN KEY("projectId","organizationId") REFERENCES "projects"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "resource_links_taskId_projectId_fkey" FOREIGN KEY("taskId","projectId") REFERENCES "tasks"("id","projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "resource_links_createdById_organizationId_fkey" FOREIGN KEY("createdById","organizationId") REFERENCES "users"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "resource_links_positive_revision" CHECK (revision >= 1 AND position >= 0),
 CONSTRAINT "resource_links_title_nonempty" CHECK (length(btrim(title)) > 0),
 CONSTRAINT "resource_links_http_url" CHECK (url ~* '^https?://' AND url !~ '[[:space:][:cntrl:]\\]')
);
CREATE UNIQUE INDEX "resource_links_actor_intent_key" ON "resource_links"("organizationId","createdById","createIntentId");
CREATE INDEX "resource_links_target_page_idx" ON "resource_links"("organizationId","projectId","taskId","archivedAt",position,id);
CREATE INDEX "resource_links_projectId_organizationId_idx" ON "resource_links"("projectId","organizationId");
CREATE INDEX "resource_links_taskId_projectId_idx" ON "resource_links"("taskId","projectId");
CREATE INDEX "resource_links_createdById_organizationId_idx" ON "resource_links"("createdById","organizationId");
CREATE FUNCTION resource_links_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'resource links must be archived'; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF ROW(NEW."organizationId",NEW."projectId",NEW."taskId",NEW."createdById",NEW."createIntentId",NEW."inputHash",NEW.source,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizationId",OLD."projectId",OLD."taskId",OLD."createdById",OLD."createIntentId",OLD."inputHash",OLD.source,OLD."createdAt") THEN
   RAISE EXCEPTION 'resource link provenance and parent are immutable';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'resource link revision must advance'; END IF;
 END IF;
 -- The parent lock serializes create/restore with complete-list reordering.
 PERFORM id FROM projects WHERE id=NEW."projectId" AND "organizationId"=NEW."organizationId" FOR UPDATE;
 IF NEW."archivedAt" IS NULL AND (TG_OP='INSERT' OR OLD."archivedAt" IS NOT NULL) THEN
  IF (SELECT count(*) FROM resource_links WHERE "organizationId"=NEW."organizationId" AND "projectId"=NEW."projectId" AND "taskId" IS NOT DISTINCT FROM NEW."taskId" AND "archivedAt" IS NULL)>=500 THEN RAISE EXCEPTION 'resource link active limit exceeded'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resource_links_guard BEFORE INSERT OR UPDATE OR DELETE ON resource_links FOR EACH ROW EXECUTE FUNCTION resource_links_guard();
