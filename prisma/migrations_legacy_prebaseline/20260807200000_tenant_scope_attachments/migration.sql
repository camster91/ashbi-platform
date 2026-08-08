CREATE TABLE "attachment_quarantine" AS
SELECT a.*, NOW() AS "quarantinedAt", 'missing organization ownership'::text AS reason
FROM "attachments" a
LEFT JOIN "users" u ON u.id = a."uploadedById"
WHERE u."organizationId" IS NULL;

DELETE FROM "attachments" a
USING "users" u
WHERE a."uploadedById" = u.id AND u."organizationId" IS NULL;

ALTER TABLE "attachments" ADD COLUMN "organizationId" TEXT;

UPDATE "attachments" a
SET "organizationId" = u."organizationId"
FROM "users" u
WHERE a."uploadedById" = u.id;

ALTER TABLE "attachments" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "attachments_organizationId_idx" ON "attachments"("organizationId");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
