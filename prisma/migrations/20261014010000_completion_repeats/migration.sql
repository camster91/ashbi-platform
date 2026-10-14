ALTER TABLE "tasks" ADD COLUMN "recurrenceFirstCompletedAt" TIMESTAMP(3),
 ADD COLUMN "recurrenceCompletionProcessedAt" TIMESTAMP(3),
 ADD COLUMN "recurrenceCompletionSourceId" TEXT;
CREATE UNIQUE INDEX "tasks_recurrenceCompletionSourceId_key" ON "tasks"("recurrenceCompletionSourceId");
CREATE INDEX "tasks_status_recurrenceCompletionProcessedAt_id_idx" ON "tasks"("status", "recurrenceCompletionProcessedAt", "id");
UPDATE "tasks" SET "recurrenceFirstCompletedAt" = "completedAt" WHERE "completedAt" IS NOT NULL;
-- Completed history without a recorded date remains unknown, but must never
-- become new repeat work when this additive migration is released.
UPDATE "tasks" SET "recurrenceCompletionProcessedAt" = CURRENT_TIMESTAMP WHERE "status" = 'COMPLETED' OR "completedAt" IS NOT NULL;
CREATE FUNCTION task_first_completion_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."recurrenceFirstCompletedAt" IS NOT NULL THEN
    NEW."recurrenceFirstCompletedAt" := OLD."recurrenceFirstCompletedAt";
  ELSIF NEW.status = 'COMPLETED' THEN
    NEW."recurrenceFirstCompletedAt" := COALESCE(NEW."completedAt", CURRENT_TIMESTAMP);
    NEW."completedAt" := COALESCE(NEW."completedAt", NEW."recurrenceFirstCompletedAt");
  ELSE
    NEW."recurrenceFirstCompletedAt" := NULL;
  END IF;
  IF NEW.status = 'COMPLETED' THEN
    NEW."completedAt" := COALESCE(NEW."completedAt", CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_first_completion_stamp BEFORE INSERT OR UPDATE OF status, "completedAt", "recurrenceFirstCompletedAt" ON tasks FOR EACH ROW EXECUTE FUNCTION task_first_completion_stamp();
