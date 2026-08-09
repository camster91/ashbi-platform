ALTER TABLE "time_entries"
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "rejectionReason" TEXT;

CREATE INDEX "time_entries_reviewStatus_idx" ON "time_entries"("reviewStatus");
