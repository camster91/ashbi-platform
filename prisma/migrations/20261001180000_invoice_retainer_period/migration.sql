-- One retainer invoice per client and billing month, and the recurring
-- invoice next-date backfill.
--
-- POST /api/retainers/:clientId/generate-invoice could bill the same month
-- twice (a double click or a client retry), because nothing tied the invoice
-- to the period it bills. invoices."retainerPeriod" records that month (UTC,
-- "YYYY-MM") on retainer invoices only; every existing and other invoice
-- keeps NULL. The partial unique index allows one live retainer invoice per
-- client and month: a VOID or soft-deleted one does not count, so a voided
-- invoice can be replaced. A retainer plan is unique per client, so the
-- client stands for the plan.
--
-- Schema change is additive only: a nullable column (no table rewrite) and an
-- index that only covers rows with a period, which is none at deploy time.
-- The file also backfills invoices."recurringNextDate" (see the end).
--
-- No explicit BEGIN/COMMIT: Prisma sends the file as one multi-statement
-- query, which PostgreSQL runs in a single implicit transaction (SET LOCAL
-- applies to it), and errors keep their messages.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "invoices" ADD COLUMN "retainerPeriod" TEXT;

CREATE UNIQUE INDEX "invoices_clientId_retainerPeriod_live_key" ON "invoices"("clientId", "retainerPeriod") WHERE ("retainerPeriod" IS NOT NULL AND status <> 'VOID' AND "deletedAt" IS NULL);

-- Backfill recurringNextDate for recurring invoices that never got one.
--
-- Before this release nothing set invoices."recurringNextDate", so the
-- recurring job (which selects on it) never generated anything. Issued
-- recurring invoices (SENT, OVERDUE or PAID, the only statuses the job copies)
-- with an interval get the date the application now computes
-- (firstRecurringDate in src/jobs/recurring-invoices.js): the first
-- "issueDate" + k intervals, k >= 1, that is after now. PostgreSQL month
-- arithmetic clamps to the month's last day and is applied from the anchor
-- each time (Jan 31 + 1 month = Feb 28, + 2 months = Mar 31), and keeps the
-- time of day, which is the application's rule. Timestamps are stored as UTC
-- without a time zone, so now() is compared in UTC. An unknown interval
-- counts as monthly, as in the application. Idempotent: only NULL dates are
-- set. Drafts are left alone; editing or sending one sets its date.
-- backfill:recurring-next-date:start
UPDATE "invoices" AS i
SET "recurringNextDate" = (
  SELECT i."issueDate" + make_interval(months => k * (CASE i."recurringInterval" WHEN 'QUARTERLY' THEN 3 WHEN 'ANNUALLY' THEN 12 ELSE 1 END))
  FROM generate_series(1, 1200) AS k
  WHERE i."issueDate" + make_interval(months => k * (CASE i."recurringInterval" WHEN 'QUARTERLY' THEN 3 WHEN 'ANNUALLY' THEN 12 ELSE 1 END)) > (now() AT TIME ZONE 'UTC')
  ORDER BY k
  LIMIT 1
)
WHERE i."isRecurring" = true
  AND i."recurringNextDate" IS NULL
  AND i."recurringInterval" IS NOT NULL
  AND i."status" IN ('SENT', 'OVERDUE', 'PAID')
  AND i."deletedAt" IS NULL;
-- backfill:recurring-next-date:end
