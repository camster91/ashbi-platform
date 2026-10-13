ALTER TABLE "tasks" ADD COLUMN "recurrenceRule" JSONB;
ALTER TABLE "tasks" ADD COLUMN "recurrenceNextDate" DATE;
ALTER TABLE "tasks" ADD COLUMN "recurrenceLastDate" DATE;
ALTER TABLE "tasks" ADD COLUMN "recurrenceRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "recurrenceSourceId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "recurrenceScheduledDate" DATE;
CREATE UNIQUE INDEX "tasks_recurrenceSourceId_recurrenceScheduledDate_key" ON "tasks"("recurrenceSourceId", "recurrenceScheduledDate");
CREATE INDEX "tasks_recurrenceNextDate_idx" ON "tasks"("recurrenceNextDate");
