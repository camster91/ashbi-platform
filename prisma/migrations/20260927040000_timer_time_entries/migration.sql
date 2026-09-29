-- Timers become time entries (C2) and a user has at most one running timer
-- (H7).
--
-- 1. time_entries.timeSessionId links the TimeEntry a stopped timer records
--    (source TIMER). Nullable and unique (one entry per timer); deleting the
--    timer session keeps the entry and clears the link.
-- 2. Close duplicate running timers left by the old non-atomic start (a race
--    could leave two). For each user, every running timer except the newest
--    is stopped at the start time of the next newer running timer — the
--    moment the old code meant to stop it. No TimeEntry is back-filled for
--    historic timers; that stays a manual decision.
-- 3. A partial unique index then enforces one running timer per user.
--    Prisma cannot model partial indexes; schema.prisma documents it.
--
-- Safe on a live database: the new column is nullable (catalog-only), the
-- update touches only duplicate running rows, and the old application image
-- neither reads the column nor creates a second running timer on purpose
-- (if it races, the insert now fails instead of corrupting timers).

-- Prisma does not wrap a migration in a transaction, so this one is explicit:
-- either every step below applies or none does.
BEGIN;

-- First statement of the transaction: block concurrent timer writes (reads
-- continue) until COMMIT, so no new duplicate running timer can appear
-- between closing the duplicates and creating the unique index.
LOCK TABLE "time_sessions" IN SHARE ROW EXCLUSIVE MODE;

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "timeSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_timeSessionId_key" ON "time_entries"("timeSessionId");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timeSessionId_fkey" FOREIGN KEY ("timeSessionId") REFERENCES "time_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Normalise ended timers still flagged running: the retired time-session
-- routes set endTime and duration on the previous timer when another was
-- started but left isRunning true. A timer with an end time is stopped.
UPDATE "time_sessions"
SET "isRunning" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isRunning" = true AND "endTime" IS NOT NULL;

-- Link timer entries written before this migration to their session: the
-- retired time-session routes created a TIMER entry without the session id
-- and kept the session, so both would count. Identical (user, project, task,
-- start, duration) rows are paired one to one; anything unmatched (for
-- example an entry edited afterwards) stays unlinked. The link is provenance
-- only: summaries and reports count TimeEntry rows, never sessions.
WITH stopped AS (
  SELECT "id", "userId", "projectId", "taskId", "startTime", "duration",
         ROW_NUMBER() OVER (PARTITION BY "userId", "projectId", "taskId", "startTime", "duration" ORDER BY "id") AS n
  FROM "time_sessions"
  WHERE "isRunning" = false
), unlinked AS (
  SELECT "id", "userId", "projectId", "taskId", "date", "duration",
         ROW_NUMBER() OVER (PARTITION BY "userId", "projectId", "taskId", "date", "duration" ORDER BY "id") AS n
  FROM "time_entries"
  WHERE "source" = 'TIMER' AND "timeSessionId" IS NULL
)
UPDATE "time_entries" AS e
SET "timeSessionId" = s."id"
FROM unlinked x
JOIN stopped s
  ON s."userId" = x."userId" AND s."projectId" = x."projectId"
 AND s."taskId" IS NOT DISTINCT FROM x."taskId"
 AND s."startTime" = x."date" AND s."duration" = x."duration" AND s.n = x.n
WHERE e."id" = x."id";

-- Close duplicate running timers (keep the newest per user).
WITH ranked AS (
  SELECT
    "id",
    "startTime",
    LEAD("startTime") OVER (PARTITION BY "userId" ORDER BY "startTime" ASC, "id" ASC) AS "nextStart"
  FROM "time_sessions"
  WHERE "isRunning" = true
)
UPDATE "time_sessions" AS s
SET "isRunning" = false,
    "endTime" = ranked."nextStart",
    -- Under a full minute records nothing (0), as for timers stopped by the app.
    "duration" = CASE
      WHEN ranked."nextStart" - ranked."startTime" >= INTERVAL '1 minute'
        THEN GREATEST(1, ROUND(EXTRACT(EPOCH FROM (ranked."nextStart" - ranked."startTime")) / 60))::INTEGER
      ELSE 0
    END,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE s."id" = ranked."id" AND ranked."nextStart" IS NOT NULL;

-- One running timer per user.
CREATE UNIQUE INDEX "time_sessions_one_running_per_user" ON "time_sessions"("userId") WHERE "isRunning" = true;

COMMIT;
