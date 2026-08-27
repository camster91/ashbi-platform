ALTER TABLE "tasks" ADD COLUMN "growthReviewKey" TEXT;

CREATE UNIQUE INDEX "tasks_growthReviewKey_key" ON "tasks"("growthReviewKey");
