ALTER TABLE "invoices"
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedFromStatus" TEXT;
