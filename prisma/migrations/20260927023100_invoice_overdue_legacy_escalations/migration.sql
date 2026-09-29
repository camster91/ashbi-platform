-- Overdue job: also mark invoices the previous job escalated without setting
-- reminderSentAt, so the new job does not send them a second urgent email.
--
-- The previous job processed only SENT invoices and moved each one to OVERDUE
-- on its first pass, so every legacy OVERDUE invoice went through exactly one
-- branch:
--   - under 7 days overdue: the first reminder, which always set
--     reminderSentAt (no escalation followed; those invoices may still get the
--     new job's single escalation);
--   - 7 or more days overdue: the urgent escalation, which never set
--     reminderSentAt and logged an 'escalated' automation activity when an
--     admin existed.
-- 20260927023000 marked only rows whose reminderSentAt shows an escalation.
-- This marks the rest: rows with the escalation activity, and open OVERDUE
-- rows with no reminder recorded (the reminder branch always records one).
-- A row set OVERDUE by hand with no reminder is marked too: missing one
-- escalation is preferred over repeating an urgent payment email.
--
-- Live-DB safety: data-only; touches past-due open invoices whose
-- overdueEscalatedAt is still NULL. Explicit BEGIN/COMMIT because Prisma does
-- not wrap a PostgreSQL migration in a transaction; lock_timeout fails fast
-- rather than queueing writers behind it (rerun the deploy if it trips).
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "invoices" AS i
SET "overdueEscalatedAt" = COALESCE(
  (SELECT MIN(a."createdAt") FROM "activities" a
    WHERE a."entityType" = 'INVOICE' AND a."entityId" = i."id" AND a."action" = 'escalated'),
  i."updatedAt"
)
WHERE i."overdueEscalatedAt" IS NULL
  AND i."status" IN ('SENT', 'OVERDUE')
  AND i."dueDate" IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM "activities" a
      WHERE a."entityType" = 'INVOICE' AND a."entityId" = i."id" AND a."action" = 'escalated'
    )
    OR (i."status" = 'OVERDUE' AND i."reminderSentAt" IS NULL)
  );

COMMIT;
