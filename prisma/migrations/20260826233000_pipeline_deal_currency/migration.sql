-- Existing deal values cannot be assigned a currency without evidence.
-- They remain NULL and are surfaced as UNASSIGNED until a human reviews them.
ALTER TABLE "pipeline_deals" ADD COLUMN "currency" TEXT;

ALTER TABLE "pipeline_deals"
ADD CONSTRAINT "pipeline_deals_currency_check"
CHECK ("currency" IS NULL OR "currency" IN ('CAD', 'USD'));
