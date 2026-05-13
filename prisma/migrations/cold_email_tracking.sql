-- AlterTable
ALTER TABLE "cold_email_sequences" 
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "totalSent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalOpened" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalClicked" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalReplied" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalBounced" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalProspects" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "cold_email_prospects" 
  ADD COLUMN "lastEmailStep" INTEGER DEFAULT 0,
  ADD COLUMN "nextEmailAt" TIMESTAMP(3),
  ADD COLUMN "openedAt" TIMESTAMP(3),
  ADD COLUMN "clickedAt" TIMESTAMP(3),
  ADD COLUMN "bouncedAt" TIMESTAMP(3),
  ADD COLUMN "emailCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cold_email_events" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "sequenceId" TEXT,
    "type" TEXT NOT NULL,
    "emailStep" INTEGER,
    "mailgunId" TEXT,
    "mailgunEvent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cold_email_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cold_email_events" ADD CONSTRAINT "cold_email_events_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "cold_email_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cold_email_events" ADD CONSTRAINT "cold_email_events_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "cold_email_sequences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
