ALTER TABLE "expenses"
  ADD COLUMN "organizationId" TEXT;

UPDATE "expenses" AS expense
SET "organizationId" = ownership."organizationId"
FROM (
  SELECT
    source."id",
    COALESCE(client."organizationId", project."organizationId", invoice_client."organizationId") AS "organizationId"
  FROM "expenses" AS source
  LEFT JOIN "clients" AS client ON client."id" = source."clientId"
  LEFT JOIN "projects" AS project ON project."id" = source."projectId"
  LEFT JOIN "invoices" AS invoice ON invoice."id" = source."invoiceId"
  LEFT JOIN "clients" AS invoice_client ON invoice_client."id" = invoice."clientId"
  WHERE (client."organizationId" IS NULL OR project."organizationId" IS NULL OR client."organizationId" = project."organizationId")
    AND (client."organizationId" IS NULL OR invoice_client."organizationId" IS NULL OR client."organizationId" = invoice_client."organizationId")
    AND (project."organizationId" IS NULL OR invoice_client."organizationId" IS NULL OR project."organizationId" = invoice_client."organizationId")
) AS ownership
WHERE expense."id" = ownership."id"
  AND ownership."organizationId" IS NOT NULL;

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "expenses_organizationId_idx" ON "expenses"("organizationId");
