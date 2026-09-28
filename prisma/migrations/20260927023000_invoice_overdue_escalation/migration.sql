-- Overdue job: record the single 7-day escalation explicitly so escalated
-- invoices leave the job's working set (new overdue invoices are always
-- reached) and a concurrent run cannot escalate twice (compare-and-set on
-- this column).
--
-- Live-DB safety: adds a nullable column (catalog-only change) and marks
-- invoices whose last reminder already went out at least 7 days after the
-- due date — i.e. were escalated under the previous logic — so they are not
-- escalated again. Runs in Prisma's single implicit migration transaction;
-- the UPDATE touches only past-due open invoices.
ALTER TABLE "invoices" ADD COLUMN "overdueEscalatedAt" TIMESTAMP(3);

UPDATE "invoices"
SET "overdueEscalatedAt" = "reminderSentAt"
WHERE "overdueEscalatedAt" IS NULL
  AND "reminderSentAt" IS NOT NULL
  AND "dueDate" IS NOT NULL
  AND "reminderSentAt" >= "dueDate" + INTERVAL '7 days';

CREATE INDEX "invoices_status_overdueEscalatedAt_dueDate_idx" ON "invoices"("status", "overdueEscalatedAt", "dueDate");
