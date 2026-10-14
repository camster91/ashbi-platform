CREATE TABLE "project_boards" (
 "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
 "taskStages" JSONB NOT NULL DEFAULT '[]', "taskViews" JSONB NOT NULL DEFAULT '[]',
 "stageRevision" INTEGER NOT NULL DEFAULT 0, "viewsRevision" INTEGER NOT NULL DEFAULT 0,
 "revision" INTEGER NOT NULL DEFAULT 0, "archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "project_boards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "project_boards_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "project_boards_organizationId_idx" ON project_boards("organizationId");
CREATE INDEX "project_boards_projectId_archivedAt_id_idx" ON project_boards("projectId", "archivedAt", id);
ALTER TABLE tasks ADD COLUMN "boardId" TEXT;
ALTER TABLE tasks ADD CONSTRAINT "tasks_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES project_boards(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tasks_boardId_status_idx" ON tasks("boardId", status);

CREATE FUNCTION project_board_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_org TEXT;
BEGIN
 SELECT "organizationId" INTO parent_org FROM projects WHERE id = NEW."projectId" FOR UPDATE;
 IF parent_org IS NULL OR NEW."organizationId" IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Board organization mismatch'; END IF;
 IF TG_OP = 'UPDATE' AND NEW."projectId" IS DISTINCT FROM OLD."projectId" AND EXISTS (SELECT 1 FROM tasks WHERE "boardId" = NEW.id) THEN RAISE EXCEPTION 'Move board tasks before changing project'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER project_board_scope_guard BEFORE INSERT OR UPDATE ON project_boards FOR EACH ROW EXECUTE FUNCTION project_board_scope_guard();
CREATE FUNCTION task_board_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_project TEXT; parent_archived TIMESTAMP(3);
BEGIN
 IF NEW."boardId" IS NULL THEN RETURN NEW; END IF;
 SELECT "projectId", "archivedAt" INTO parent_project, parent_archived FROM project_boards WHERE id = NEW."boardId" FOR UPDATE;
 IF parent_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Task board project mismatch'; END IF;
 IF (TG_OP = 'INSERT' OR NEW."boardId" IS DISTINCT FROM OLD."boardId") AND parent_archived IS NOT NULL THEN RAISE EXCEPTION 'Board is archived'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER task_board_scope_guard BEFORE INSERT OR UPDATE OF "boardId", "projectId" ON tasks FOR EACH ROW EXECUTE FUNCTION task_board_scope_guard();
CREATE FUNCTION project_board_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM project_boards WHERE "projectId" = NEW.id AND "organizationId" IS DISTINCT FROM NEW."organizationId") THEN RAISE EXCEPTION 'Board organization mismatch'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER project_board_parent_guard BEFORE UPDATE OF "organizationId" ON projects FOR EACH ROW EXECUTE FUNCTION project_board_parent_guard();
