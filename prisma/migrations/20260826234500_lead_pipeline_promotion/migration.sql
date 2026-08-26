ALTER TABLE "leads" ADD COLUMN "convertedDealId" TEXT;

CREATE UNIQUE INDEX "leads_convertedDealId_key" ON "leads"("convertedDealId");
CREATE INDEX "leads_convertedDealId_idx" ON "leads"("convertedDealId");

ALTER TABLE "leads"
ADD CONSTRAINT "leads_convertedDealId_fkey"
FOREIGN KEY ("convertedDealId") REFERENCES "pipeline_deals"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
