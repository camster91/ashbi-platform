CREATE TABLE "form_drafts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "baseUpdatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_drafts_userId_entity_entityId_key" ON "form_drafts"("userId", "entity", "entityId");
CREATE INDEX "form_drafts_organizationId_userId_idx" ON "form_drafts"("organizationId", "userId");
CREATE INDEX "form_drafts_expiresAt_idx" ON "form_drafts"("expiresAt");

ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
