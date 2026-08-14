ALTER TABLE "milestones" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "milestones_deletedAt_idx" ON "milestones"("deletedAt");
