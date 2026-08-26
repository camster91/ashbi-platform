ALTER TABLE "proposals"
ADD COLUMN "currency" TEXT,
ADD COLUMN "dealId" TEXT;

ALTER TABLE "proposals"
ADD CONSTRAINT "proposals_currency_check"
CHECK ("currency" IS NULL OR "currency" IN ('CAD', 'USD'));

CREATE UNIQUE INDEX "proposals_dealId_key" ON "proposals"("dealId");

ALTER TABLE "proposals"
ADD CONSTRAINT "proposals_dealId_fkey"
FOREIGN KEY ("dealId") REFERENCES "pipeline_deals"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
