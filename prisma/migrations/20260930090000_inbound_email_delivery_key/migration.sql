-- Idempotent inbound email processing (INTEGRATIONS.md, "Inbound email
-- webhook"): every inbound delivery carries a stable key (the signed webhook's
-- job id, or the Mailgun Message-Id / a hash of the Mailgun delivery), and the
-- record the pipeline creates first stores it, so a retried delivery finds
-- and resumes its thread instead of creating a second thread, message or
-- unmatched email. The unique indexes make concurrent creation race-safe:
-- the loser gets P2002 and loads the winner's row.
--
-- "threads"."inboundPipelineStage" records the last pipeline step a thread
-- completed (CREATED, ANALYZED, ASSIGNED, REPLANNED, COMPLETED), so a retry
-- skips steps whose writes (notification, AI tasks, draft response) already
-- committed.
--
-- Additive only: three nullable columns without a default (catalog-only
-- changes), one CHECK constraint that every existing row (NULL) satisfies,
-- and two unique indexes. Existing rows keep NULL keys, and PostgreSQL unique
-- indexes allow any number of NULLs. Rolling back the application image is
-- safe: older code never reads or writes these columns.
--
-- Locking: Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT keeps it all-or-nothing. ALTER TABLE takes an
-- ACCESS EXCLUSIVE lock briefly (the CHECK validation scans "threads"), and
-- CREATE UNIQUE INDEX holds a SHARE lock (blocks writes, not reads) until
-- COMMIT; both tables are small. lock_timeout makes the deploy fail fast and
-- roll back cleanly instead of queueing every request behind a long-running
-- transaction; rerun it when the database is quieter.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "threads" ADD COLUMN "inboundDeliveryKey" TEXT,
ADD COLUMN "inboundPipelineStage" TEXT,
ADD CONSTRAINT "threads_inboundPipelineStage_check" CHECK (
  "inboundPipelineStage" IS NULL
  OR "inboundPipelineStage" IN ('CREATED', 'ANALYZED', 'ASSIGNED', 'REPLANNED', 'COMPLETED')
);

-- AlterTable
ALTER TABLE "unmatched_emails" ADD COLUMN "inboundDeliveryKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "threads_inboundDeliveryKey_key" ON "threads"("inboundDeliveryKey");

-- CreateIndex
CREATE UNIQUE INDEX "unmatched_emails_inboundDeliveryKey_key" ON "unmatched_emails"("inboundDeliveryKey");

COMMIT;
