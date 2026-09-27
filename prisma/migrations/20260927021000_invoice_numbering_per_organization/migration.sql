-- Per-organization invoice numbering.
--
-- invoiceNumber was globally unique while numbers were computed per tenant,
-- so a second organization's first invoice collided (P2002) and concurrent
-- creates raced. Numbers become unique per organization and are allocated
-- from an atomic per-organization counter.
--
-- Live-DB safety: every step is additive or a pure index swap. The column is
-- added nullable (no rewrite), backfilled from the owning client, and kept in
-- sync by a trigger so writers that omit it (including the previous app
-- version during a rolling deploy) still get it set. The new unique index is
-- built before the global one is dropped, so uniqueness never lapses; the
-- global index is strictly stronger, so existing data cannot violate it.
-- Invoices and the counter table are small; each statement holds its lock
-- only briefly. The previous app version keeps working after this migration:
-- its max()+1 numbering is still per organization, and the new allocator
-- skips any number such a writer already used.

-- 1. Owning organization, derived from the client.
ALTER TABLE "invoices" ADD COLUMN "organizationId" TEXT;

UPDATE "invoices" AS i
SET "organizationId" = c."organizationId"
FROM "clients" AS c
WHERE c."id" = i."clientId"
  AND i."organizationId" IS DISTINCT FROM c."organizationId";

CREATE OR REPLACE FUNCTION invoices_set_organization_id() RETURNS trigger AS $$
BEGIN
  SELECT c."organizationId" INTO NEW."organizationId"
  FROM "clients" AS c
  WHERE c."id" = NEW."clientId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_set_organization_id ON "invoices";
CREATE TRIGGER invoices_set_organization_id
  BEFORE INSERT OR UPDATE OF "clientId", "organizationId" ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_set_organization_id();

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_organizationId_fkey";

-- 2. Uniqueness per organization instead of globally (new index first).
CREATE UNIQUE INDEX "invoices_organizationId_invoiceNumber_key" ON "invoices"("organizationId", "invoiceNumber");
DROP INDEX "invoices_invoiceNumber_key";

-- 3. Atomic per-organization counters.
CREATE TABLE "document_number_sequences" (
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("organizationId","kind","period")
);

ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed each organization's counter from its highest existing INV-<year>-<n>
-- number, compared numerically (a lexical max() stops at 9999).
INSERT INTO "document_number_sequences" ("organizationId", "kind", "period", "lastValue", "updatedAt")
SELECT i."organizationId", 'INVOICE', (m[1])::integer, MAX((m[2])::integer), CURRENT_TIMESTAMP
FROM "invoices" AS i
CROSS JOIN LATERAL regexp_match(i."invoiceNumber", '^INV-([0-9]{4})-([0-9]{1,9})$') AS m
WHERE i."organizationId" IS NOT NULL
  AND m IS NOT NULL
GROUP BY i."organizationId", m[1]
ON CONFLICT ("organizationId", "kind", "period") DO UPDATE
  SET "lastValue" = GREATEST("document_number_sequences"."lastValue", EXCLUDED."lastValue");
