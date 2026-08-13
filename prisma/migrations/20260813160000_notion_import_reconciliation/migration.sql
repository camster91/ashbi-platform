-- Durable source identity and reconciliation state for controlled Notion
-- Markdown imports. Source keys are deterministic relative export paths.
CREATE TABLE "notion_import_records" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "noteId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "outcome" TEXT NOT NULL DEFAULT 'IMPORTED',
  "lastError" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notion_import_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notion_import_records_projectId_sourceKey_key" ON "notion_import_records"("projectId", "sourceKey");
CREATE INDEX "notion_import_records_organizationId_projectId_idx" ON "notion_import_records"("organizationId", "projectId");
CREATE INDEX "notion_import_records_noteId_idx" ON "notion_import_records"("noteId");
ALTER TABLE "notion_import_records" ADD CONSTRAINT "notion_import_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notion_import_records" ADD CONSTRAINT "notion_import_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
