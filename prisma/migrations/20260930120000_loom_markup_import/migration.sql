-- Controlled Loom and MarkUp.io imports (#414; docs/loom-migration.md and
-- docs/markup-migration.md): durable per-source reconciliation records for
-- the two operator-prepared importers. Both reuse the generic `import_runs`
-- ledger added by 20260926120000_slack_export_import, so a completed run can
-- be rolled back by id exactly like a Slack export run.
--
-- - loom_import_records: one row per imported Loom recording (a project
--   media attachment), keyed by the Loom video id, with the recording's
--   provenance (share URL, original timestamp) and file/row SHA-256 hashes.
-- - markup_import_records: one row per imported MarkUp.io review (SESSION:
--   a review session and its stored file) or comment (ANNOTATION), keyed by
--   MarkUp project, file name and comment id.
--
-- Additive only: two new tables, their indexes, foreign keys and CHECK
-- constraints; no existing table is altered, so rolling back the application
-- image is safe (older code never reads these tables).
--
-- Atomicity: Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT makes the tables and their constraints
-- all-or-nothing. The foreign keys take a SHARE ROW EXCLUSIVE lock on
-- organizations, projects and import_runs; lock_timeout bounds the wait so a
-- long-running writer fails the deploy instead of queueing requests behind it.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateTable
CREATE TABLE "loom_import_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attachmentId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "loomUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "ownerEmail" TEXT,
    "ownerUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'IMPORTED',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loom_import_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markup_import_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "markupProject" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "commentId" TEXT,
    "threadId" TEXT,
    "reviewSessionId" TEXT,
    "annotationId" TEXT,
    "attachmentId" TEXT,
    "contentSha256" TEXT NOT NULL,
    "fileSha256" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'IMPORTED',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markup_import_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loom_import_records_organizationId_projectId_idx" ON "loom_import_records"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "loom_import_records_runId_idx" ON "loom_import_records"("runId");

-- CreateIndex
CREATE INDEX "loom_import_records_attachmentId_idx" ON "loom_import_records"("attachmentId");

-- CreateIndex
CREATE INDEX "loom_import_records_projectId_idx" ON "loom_import_records"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "loom_import_records_organizationId_sourceKey_key" ON "loom_import_records"("organizationId", "sourceKey");

-- CreateIndex
CREATE INDEX "markup_import_records_organizationId_projectId_idx" ON "markup_import_records"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "markup_import_records_runId_idx" ON "markup_import_records"("runId");

-- CreateIndex
CREATE INDEX "markup_import_records_reviewSessionId_idx" ON "markup_import_records"("reviewSessionId");

-- CreateIndex
CREATE INDEX "markup_import_records_annotationId_idx" ON "markup_import_records"("annotationId");

-- CreateIndex
CREATE INDEX "markup_import_records_attachmentId_idx" ON "markup_import_records"("attachmentId");

-- CreateIndex
CREATE INDEX "markup_import_records_projectId_idx" ON "markup_import_records"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "markup_import_records_organizationId_sourceKey_key" ON "markup_import_records"("organizationId", "sourceKey");

-- AddForeignKey
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markup_import_records" ADD CONSTRAINT "markup_import_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markup_import_records" ADD CONSTRAINT "markup_import_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markup_import_records" ADD CONSTRAINT "markup_import_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma does not model CHECK constraints; they are enforced here only.
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_outcome_check"
  CHECK ("outcome" IN ('IMPORTED'));
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_hash_check"
  CHECK ("fileSha256" ~ '^[0-9a-f]{64}$' AND "contentSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_file_size_check"
  CHECK ("fileSize" > 0);
ALTER TABLE "loom_import_records" ADD CONSTRAINT "loom_import_records_loom_url_check"
  CHECK ("loomUrl" ~ '^https://www\.loom\.com/share/[A-Za-z0-9]+$' AND length("loomUrl") <= 200);

ALTER TABLE "markup_import_records" ADD CONSTRAINT "markup_import_records_outcome_check"
  CHECK ("outcome" IN ('IMPORTED'));
ALTER TABLE "markup_import_records" ADD CONSTRAINT "markup_import_records_hash_check"
  CHECK ("contentSha256" ~ '^[0-9a-f]{64}$' AND ("fileSha256" IS NULL OR "fileSha256" ~ '^[0-9a-f]{64}$'));
-- A SESSION record names its session and stored file; an ANNOTATION record
-- names one comment.
ALTER TABLE "markup_import_records" ADD CONSTRAINT "markup_import_records_kind_check"
  CHECK (
    ("kind" = 'SESSION' AND "commentId" IS NULL AND "threadId" IS NULL AND "annotationId" IS NULL AND "fileSha256" IS NOT NULL)
    OR ("kind" = 'ANNOTATION' AND "commentId" IS NOT NULL AND "attachmentId" IS NULL AND "fileSha256" IS NULL)
  );

COMMIT;
