-- Expense ownership and receipt checksums.
--
-- 1. expenses."organizationId" (required, FK to organizations). Expenses were
--    scoped only through their optional client, so an expense without a
--    client could not be created, and one whose client was cleared belonged to
--    no organization (invisible to everyone, including summaries). The tenant
--    proxy now scopes expenses by this column directly.
-- 2. expenses."receiptChecksumSha256": lowercase hex SHA-256 of the stored
--    receipt, computed by the server when a receipt is attached (same format
--    and CHECK as attachments."checksumSha256", migration
--    20261001090000_attachment_checksum). Existing rows stay NULL (their
--    files are not re-read here).
--
-- Backfill (every existing row, soft-deleted ones included), in order:
--   a. the client's organization;
--   b. otherwise the project's organization;
--   c. otherwise the linked invoice's organization;
--   d. otherwise, when the database holds exactly one organization, that
--      organization (it is the only tenant that can have created the row);
--   e. anything still unattributed aborts the migration with the count: such
--      rows must be assigned or removed by an operator first. Nothing is
--      guessed between several organizations.
-- An expense whose client and project belong to different organizations also
-- aborts the migration (it already spans tenants and needs a decision).
--
-- Rolling deploy: the previous application image inserts expenses without
-- organizationId. The expenses_tenant_guard trigger derives it from the
-- client (or project) when it is missing, and refuses a row whose client or
-- project belongs to another organization than the row itself, or whose
-- receipt file is already the receipt of another organization's expense
-- (a receipt URL names a shared upload directory, so it must never be
-- claimable across tenants).
--
-- Atomicity: no explicit BEGIN/COMMIT. Prisma sends this script as one
-- multi-statement query, which PostgreSQL runs as a single implicit
-- transaction: a failure (for example the backfill RAISE) rolls everything
-- back, and the real error message reaches the operator and
-- _prisma_migrations.logs (an explicit BEGIN would leave Prisma's own
-- bookkeeping inside an aborted transaction and hide it). SET LOCAL
-- lock_timeout applies to that implicit transaction and fails fast instead
-- of queueing behind a long transaction. Recovery after an abort:
-- docs/migration-cutover-runbook.md ("Expense organization migration").

SET LOCAL lock_timeout = '5s';

ALTER TABLE "expenses" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "expenses" ADD COLUMN "receiptChecksumSha256" TEXT;

DO $$
DECLARE
  conflicting INTEGER;
  unattributed INTEGER;
  org_count INTEGER;
BEGIN
  SELECT count(*) INTO conflicting
  FROM "expenses" e
  JOIN "clients" c ON c."id" = e."clientId"
  JOIN "projects" p ON p."id" = e."projectId"
  WHERE c."organizationId" <> p."organizationId";
  IF conflicting > 0 THEN
    RAISE EXCEPTION 'Expense organization migration aborted: % expense(s) link a client and a project of different organizations; fix their clientId/projectId first', conflicting;
  END IF;

  UPDATE "expenses" e SET "organizationId" = c."organizationId"
  FROM "clients" c
  WHERE c."id" = e."clientId" AND e."organizationId" IS NULL;

  UPDATE "expenses" e SET "organizationId" = p."organizationId"
  FROM "projects" p
  WHERE p."id" = e."projectId" AND e."organizationId" IS NULL;

  UPDATE "expenses" e SET "organizationId" = i."organizationId"
  FROM "invoices" i
  WHERE i."id" = e."invoiceId" AND e."organizationId" IS NULL AND i."organizationId" IS NOT NULL;

  SELECT count(*) INTO unattributed FROM "expenses" WHERE "organizationId" IS NULL;
  IF unattributed > 0 THEN
    SELECT count(*) INTO org_count FROM "organizations";
    IF org_count = 1 THEN
      UPDATE "expenses" SET "organizationId" = (SELECT "id" FROM "organizations")
      WHERE "organizationId" IS NULL;
      RAISE NOTICE 'Expense organization migration: % expense(s) without client, project or invoice assigned to the only organization', unattributed;
    ELSE
      RAISE EXCEPTION 'Expense organization migration aborted: % expense(s) have no client, project or invoice to derive an organization from, and the database holds % organizations; give each a client or project (or delete it) and rerun', unattributed, org_count;
    END IF;
  END IF;
END $$;

ALTER TABLE "expenses" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "expenses" VALIDATE CONSTRAINT "expenses_organizationId_fkey";

CREATE INDEX "expenses_organizationId_date_idx" ON "expenses"("organizationId", "date");
CREATE INDEX "expenses_receiptUrl_idx" ON "expenses"("receiptUrl");

-- NOT VALID skips a scan of existing rows (all NULL); new writes are checked.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_receipt_checksum_sha256_format_check"
  CHECK ("receiptChecksumSha256" IS NULL OR "receiptChecksumSha256" ~ '^[0-9a-f]{64}$') NOT VALID;

CREATE OR REPLACE FUNCTION expenses_tenant_guard() RETURNS trigger AS $$
DECLARE
  owner TEXT;
BEGIN
  IF NEW."organizationId" IS NULL THEN
    IF NEW."clientId" IS NOT NULL THEN
      SELECT c."organizationId" INTO NEW."organizationId" FROM "clients" c WHERE c."id" = NEW."clientId";
    END IF;
    IF NEW."organizationId" IS NULL AND NEW."projectId" IS NOT NULL THEN
      SELECT p."organizationId" INTO NEW."organizationId" FROM "projects" p WHERE p."id" = NEW."projectId";
    END IF;
  END IF;
  IF NEW."clientId" IS NOT NULL THEN
    SELECT c."organizationId" INTO owner FROM "clients" c WHERE c."id" = NEW."clientId";
    IF owner IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'expense client must belong to the expense organization';
    END IF;
  END IF;
  IF NEW."projectId" IS NOT NULL THEN
    SELECT p."organizationId" INTO owner FROM "projects" p WHERE p."id" = NEW."projectId";
    IF owner IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'expense project must belong to the expense organization';
    END IF;
  END IF;
  -- Serialize writers of the same receipt URL for the rest of the
  -- transaction, so two organizations cannot both pass the check below
  -- concurrently.
  IF NEW."receiptUrl" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW."receiptUrl"));
  END IF;
  IF NEW."receiptUrl" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "expenses" o
    WHERE o."receiptUrl" = NEW."receiptUrl"
      AND o."id" <> NEW."id"
      AND o."organizationId" <> NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'expense receipt belongs to another organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expenses_tenant_guard ON "expenses";
CREATE TRIGGER expenses_tenant_guard
  BEFORE INSERT OR UPDATE OF "organizationId", "clientId", "projectId", "receiptUrl" ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION expenses_tenant_guard();

