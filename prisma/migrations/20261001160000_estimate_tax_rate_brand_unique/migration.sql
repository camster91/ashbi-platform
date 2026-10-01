-- Estimate tax rate, and one brand settings row per organization.
--
-- 1. estimates."taxRate": the percent staff entered (the Estimates page and
--    POST/PUT /api/estimates). The tax amount alone cannot give the rate back
--    exactly once it is rounded to cents (3.33 at 13% stores 0.43, which is
--    12.91%), so existing rows stay NULL and the page falls back to the
--    nearest half-percent rate that reproduces the stored tax.
--
-- 2. brand_settings: concurrent first reads could each create a row for the
--    same organization. Duplicates are merged into the oldest row (lowest
--    cuid), taking each column from the newest duplicate that set it (a
--    non-null value that differs from the column default); the other rows are
--    deleted, and organizationId becomes unique so the application can upsert.
--    Nothing references brand_settings rows by id.
--
-- No explicit BEGIN/COMMIT: Prisma sends the file as one multi-statement
-- query, which PostgreSQL runs in a single implicit transaction (SET LOCAL
-- applies to it), and errors keep their messages.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "estimates" ADD COLUMN "taxRate" DOUBLE PRECISION;

WITH merged AS (
  SELECT
    "organizationId",
    MIN("id") AS "keepId",
    (ARRAY_AGG("companyName" ORDER BY "id" DESC) FILTER (WHERE "companyName" IS NOT NULL AND "companyName" <> 'Ashbi Design'))[1] AS "companyName",
    (ARRAY_AGG("logoUrl" ORDER BY "id" DESC) FILTER (WHERE "logoUrl" IS NOT NULL))[1] AS "logoUrl",
    (ARRAY_AGG("primaryColor" ORDER BY "id" DESC) FILTER (WHERE "primaryColor" IS NOT NULL AND "primaryColor" <> '#c9a84c'))[1] AS "primaryColor",
    (ARRAY_AGG("accentColor" ORDER BY "id" DESC) FILTER (WHERE "accentColor" IS NOT NULL AND "accentColor" <> '#1e293b'))[1] AS "accentColor",
    (ARRAY_AGG("address" ORDER BY "id" DESC) FILTER (WHERE "address" IS NOT NULL))[1] AS "address",
    (ARRAY_AGG("phone" ORDER BY "id" DESC) FILTER (WHERE "phone" IS NOT NULL))[1] AS "phone",
    (ARRAY_AGG("email" ORDER BY "id" DESC) FILTER (WHERE "email" IS NOT NULL))[1] AS "email",
    (ARRAY_AGG("website" ORDER BY "id" DESC) FILTER (WHERE "website" IS NOT NULL))[1] AS "website",
    (ARRAY_AGG("taxId" ORDER BY "id" DESC) FILTER (WHERE "taxId" IS NOT NULL))[1] AS "taxId",
    (ARRAY_AGG("invoiceFooter" ORDER BY "id" DESC) FILTER (WHERE "invoiceFooter" IS NOT NULL))[1] AS "invoiceFooter",
    (ARRAY_AGG("proposalFooter" ORDER BY "id" DESC) FILTER (WHERE "proposalFooter" IS NOT NULL))[1] AS "proposalFooter",
    (ARRAY_AGG("contractHeader" ORDER BY "id" DESC) FILTER (WHERE "contractHeader" IS NOT NULL))[1] AS "contractHeader"
  FROM "brand_settings"
  GROUP BY "organizationId"
  HAVING COUNT(*) > 1
)
UPDATE "brand_settings" AS keep SET
  "companyName"    = COALESCE(merged."companyName", keep."companyName"),
  "logoUrl"        = COALESCE(merged."logoUrl", keep."logoUrl"),
  "primaryColor"   = COALESCE(merged."primaryColor", keep."primaryColor"),
  "accentColor"    = COALESCE(merged."accentColor", keep."accentColor"),
  "address"        = COALESCE(merged."address", keep."address"),
  "phone"          = COALESCE(merged."phone", keep."phone"),
  "email"          = COALESCE(merged."email", keep."email"),
  "website"        = COALESCE(merged."website", keep."website"),
  "taxId"          = COALESCE(merged."taxId", keep."taxId"),
  "invoiceFooter"  = COALESCE(merged."invoiceFooter", keep."invoiceFooter"),
  "proposalFooter" = COALESCE(merged."proposalFooter", keep."proposalFooter"),
  "contractHeader" = COALESCE(merged."contractHeader", keep."contractHeader")
FROM merged
WHERE keep."id" = merged."keepId";

DELETE FROM "brand_settings" AS dup
USING (
  SELECT "organizationId", MIN("id") AS "keepId"
  FROM "brand_settings"
  GROUP BY "organizationId"
  HAVING COUNT(*) > 1
) AS kept
WHERE dup."organizationId" = kept."organizationId"
  AND dup."id" <> kept."keepId";

DROP INDEX "brand_settings_organizationId_idx";

CREATE UNIQUE INDEX "brand_settings_organizationId_key" ON "brand_settings"("organizationId");
