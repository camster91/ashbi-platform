-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "clients_organizationId_idx" ON "clients"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "projects_organizationId_idx" ON "projects"("organizationId");
