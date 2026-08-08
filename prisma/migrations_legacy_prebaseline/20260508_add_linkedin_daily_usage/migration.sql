-- CreateTable: LinkedInDailyUsage
CREATE TABLE IF NOT EXISTS "linkedin_daily_usage" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "connectionsSent" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on date
CREATE UNIQUE INDEX IF NOT EXISTS "linkedin_daily_usage_date_key" ON "linkedin_daily_usage"("date");
