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

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "timeSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_timeSessionId_key" ON "time_entries"("timeSessionId");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timeSessionId_fkey" FOREIGN KEY ("timeSessionId") REFERENCES "time_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
    "duration" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (ranked."nextStart" - ranked."startTime")) / 60))::INTEGER,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE s."id" = ranked."id" AND ranked."nextStart" IS NOT NULL;

-- One running timer per user.
CREATE UNIQUE INDEX "time_sessions_one_running_per_user" ON "time_sessions"("userId") WHERE "isRunning" = true;
