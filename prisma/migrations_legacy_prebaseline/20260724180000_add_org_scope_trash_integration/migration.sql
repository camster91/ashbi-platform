-- Add organization scoping for trash and integrations (production audit)

ALTER TABLE "trashed_items" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "trashed_items_organizationId_idx" ON "trashed_items"("organizationId");

ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "integrations_organizationId_idx" ON "integrations"("organizationId");
