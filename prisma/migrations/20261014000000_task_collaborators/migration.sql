ALTER TABLE "tasks" ADD COLUMN "collaboratorsRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "task_collaborators" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "task_collaborators_taskId_userId_key" ON "task_collaborators"("taskId", "userId");
CREATE INDEX "task_collaborators_userId_idx" ON "task_collaborators"("userId");
CREATE INDEX "task_collaborators_organizationId_userId_idx" ON "task_collaborators"("organizationId", "userId");
CREATE FUNCTION task_collaborator_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_org TEXT; member_org TEXT; member_role TEXT; member_active BOOLEAN;
BEGIN
  SELECT p."organizationId" INTO task_org FROM tasks t JOIN projects p ON p.id = t."projectId" WHERE t.id = NEW."taskId" FOR UPDATE OF t, p;
  SELECT u."organizationId", u.role, u."isActive" INTO member_org, member_role, member_active FROM users u WHERE u.id = NEW."userId" FOR UPDATE;
  IF task_org IS NULL OR member_org IS DISTINCT FROM task_org THEN RAISE EXCEPTION 'Collaboration tenant mismatch'; END IF;
  IF (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."taskId" IS DISTINCT FROM OLD."taskId") AND (member_active IS NOT TRUE OR member_role NOT IN ('ADMIN', 'TEAM')) THEN RAISE EXCEPTION 'Collaborator must be active staff'; END IF;
  NEW."organizationId" := task_org;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_collaborator_tenant_guard BEFORE INSERT OR UPDATE ON "task_collaborators" FOR EACH ROW EXECUTE FUNCTION task_collaborator_tenant_guard();
CREATE FUNCTION task_collaborator_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_org TEXT;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF EXISTS (SELECT 1 FROM task_collaborators c WHERE c."userId" = NEW.id AND c."organizationId" IS DISTINCT FROM NEW."organizationId") THEN RAISE EXCEPTION 'Collaboration tenant mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    SELECT p."organizationId" INTO target_org FROM projects p WHERE p.id = NEW."projectId";
    IF EXISTS (SELECT 1 FROM task_collaborators c WHERE c."taskId" = NEW.id AND c."organizationId" IS DISTINCT FROM target_org) THEN RAISE EXCEPTION 'Collaboration tenant mismatch'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM task_collaborators c JOIN tasks t ON t.id = c."taskId" WHERE t."projectId" = NEW.id AND c."organizationId" IS DISTINCT FROM NEW."organizationId") THEN RAISE EXCEPTION 'Collaboration tenant mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_collaborator_user_guard BEFORE UPDATE OF "organizationId" ON users FOR EACH ROW EXECUTE FUNCTION task_collaborator_parent_guard();
CREATE TRIGGER task_collaborator_task_guard BEFORE UPDATE OF "projectId" ON tasks FOR EACH ROW EXECUTE FUNCTION task_collaborator_parent_guard();
CREATE TRIGGER task_collaborator_project_guard BEFORE UPDATE OF "organizationId" ON projects FOR EACH ROW EXECUTE FUNCTION task_collaborator_parent_guard();
