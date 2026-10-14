ALTER TABLE "invoices" ADD COLUMN "billingSources" JSONB;
ALTER TABLE "invoices" ADD COLUMN "billingSourcesReleasedAt" TIMESTAMP(3);
CREATE INDEX "invoices_billing_sources_scope_idx" ON "invoices" ("organizationId") WHERE "billingSources" IS NOT NULL;

CREATE FUNCTION invoice_billing_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."billingSources" IS DISTINCT FROM OLD."billingSources" THEN
    RAISE EXCEPTION 'Original invoice billing sources cannot change';
  END IF;
  IF NEW."billingSources" IS NULL THEN
    IF NEW."billingSourcesReleasedAt" IS NOT NULL THEN RAISE EXCEPTION 'Source release requires original billing sources'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."isRecurring" THEN RAISE EXCEPTION 'Reviewed source-backed invoices cannot recur'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW."billingSourcesReleasedAt" IS NOT NULL
      OR NEW."billingSources"->>'version' IS DISTINCT FROM '1'
      OR NEW."billingSources"->>'clientId' IS DISTINCT FROM NEW."clientId"
      OR NEW."billingSources"->>'projectId' IS DISTINCT FROM NEW."projectId"
      OR NEW."billingSources"->>'currency' IS DISTINCT FROM NEW.currency
      OR jsonb_typeof(NEW."billingSources"->'lineItems') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid original invoice billing sources';
    END IF;
    IF jsonb_array_length(NEW."billingSources"->'lineItems') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid billing source count'; END IF;
  ELSE
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Source-backed invoice client project and currency cannot change';
    END IF;
    IF OLD."billingSourcesReleasedAt" IS NOT NULL THEN
      IF NEW."billingSourcesReleasedAt" IS DISTINCT FROM OLD."billingSourcesReleasedAt" OR NEW.status <> 'VOID' THEN RAISE EXCEPTION 'Released source invoice cannot be reopened'; END IF;
    ELSIF NEW."billingSourcesReleasedAt" IS NOT NULL THEN
      IF OLD.status <> 'VOID' OR NEW.status <> 'VOID' OR OLD."voidedAt" IS NULL
        OR OLD."voidedAt" > CURRENT_TIMESTAMP - INTERVAL '10 seconds'
        OR EXISTS (SELECT 1 FROM "invoice_payments" WHERE "invoiceId" = OLD.id) THEN
        RAISE EXCEPTION 'Source release requires an unpaid voided invoice after its undo window';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_billing_snapshot_guard BEFORE INSERT OR UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION invoice_billing_snapshot_guard();

-- Run at commit: the invoice is inserted before its source FK claims, and a
-- reviewed release clears those claims in the same transaction as its marker.
CREATE FUNCTION assert_invoice_billing_sources(target_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE inv RECORD; line JSONB; src RECORD; source_id TEXT; kind TEXT;
BEGIN
  SELECT * INTO inv FROM "invoices" WHERE id = target_id;
  IF NOT FOUND OR inv."billingSources" IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM "clients" WHERE id = inv."clientId" AND "organizationId" = inv."organizationId")
    OR NOT EXISTS (SELECT 1 FROM "users" WHERE id = inv."createdById" AND "organizationId" = inv."organizationId")
    OR (inv."projectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "projects" WHERE id = inv."projectId" AND "organizationId" = inv."organizationId" AND "clientId" = inv."clientId")) THEN
    RAISE EXCEPTION 'Billing source invoice owner or canonical project changed organization or client';
  END IF;
  IF inv."billingSourcesReleasedAt" IS NOT NULL THEN
    IF inv.status <> 'VOID' OR EXISTS (SELECT 1 FROM "invoice_payments" WHERE "invoiceId" = inv.id) OR EXISTS (SELECT 1 FROM "time_entries" WHERE "invoiceId" = inv.id)
      OR EXISTS (SELECT 1 FROM "expenses" WHERE "invoiceId" = inv.id) THEN RAISE EXCEPTION 'Released invoice still owns billing claims'; END IF;
    RETURN;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(inv."billingSources"->'lineItems') LOOP
    kind := line->'source'->>'kind'; source_id := line->'source'->>'id';
    IF kind = 'TIME' THEN
      SELECT t.*, p."organizationId" AS source_org, p."clientId" AS source_client, u."organizationId" AS user_org
        INTO src FROM "time_entries" t JOIN "projects" p ON p.id = t."projectId" JOIN "users" u ON u.id = t."userId" WHERE t.id = source_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Original billed time is unavailable'; END IF;
      IF src."invoiceId" IS DISTINCT FROM inv.id OR NOT src.invoiced OR NOT src.billable OR src."reviewStatus" <> 'APPROVED'
        OR src."deletedAt" IS NOT NULL OR src.source_org IS DISTINCT FROM inv."organizationId" OR src.user_org IS DISTINCT FROM inv."organizationId"
        OR src.source_client IS DISTINCT FROM inv."clientId"
        OR (inv."projectId" IS NOT NULL AND src."projectId" IS DISTINCT FROM inv."projectId")
        OR src."projectId" IS DISTINCT FROM line->'source'->'project'->>'id'
        OR src."userId" IS DISTINCT FROM line->'source'->'user'->>'id'
        OR src.duration IS DISTINCT FROM (line->'source'->>'duration')::INTEGER
        OR COALESCE(src.description, '') IS DISTINCT FROM line->'source'->>'description'
        OR src."hourlyRate" IS DISTINCT FROM (line->'source'->>'suggestedHourlyRate')::DOUBLE PRECISION
        OR src.date IS DISTINCT FROM ((line->'source'->>'date')::TIMESTAMPTZ AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Original billed time or its canonical scope changed'; END IF;
    ELSIF kind = 'EXPENSE' THEN
      SELECT e.*, p."organizationId" AS project_org, p."clientId" AS project_client
        INTO src FROM "expenses" e LEFT JOIN "projects" p ON p.id = e."projectId" WHERE e.id = source_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Original billed expense is unavailable'; END IF;
      IF src."invoiceId" IS DISTINCT FROM inv.id OR NOT src.invoiced OR NOT src.billable OR src."deletedAt" IS NOT NULL
        OR src."organizationId" IS DISTINCT FROM inv."organizationId"
        OR (src."clientId" IS NOT NULL AND src."clientId" IS DISTINCT FROM inv."clientId")
        OR (src."projectId" IS NOT NULL AND (src.project_org IS DISTINCT FROM inv."organizationId" OR src.project_client IS DISTINCT FROM inv."clientId"))
        OR (src."clientId" IS NULL AND src."projectId" IS NULL)
        OR (inv."projectId" IS NOT NULL AND src."projectId" IS DISTINCT FROM inv."projectId")
        OR src."projectId" IS DISTINCT FROM line->'source'->'project'->>'id'
        OR src.currency IS DISTINCT FROM inv.currency OR src.currency IS DISTINCT FROM line->'source'->>'currency'
        OR src.amount IS DISTINCT FROM (line->'source'->>'amount')::DOUBLE PRECISION
        OR src.description IS DISTINCT FROM line->'source'->>'description'
        OR src.date IS DISTINCT FROM ((line->'source'->>'date')::TIMESTAMPTZ AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Original billed expense or its canonical scope changed'; END IF;
    ELSE RAISE EXCEPTION 'Unknown invoice billing source';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM "time_entries" WHERE "invoiceId" = inv.id) <> (SELECT count(*) FROM jsonb_array_elements(inv."billingSources"->'lineItems') value WHERE value->'source'->>'kind' = 'TIME')
    OR (SELECT count(*) FROM "expenses" WHERE "invoiceId" = inv.id) <> (SELECT count(*) FROM jsonb_array_elements(inv."billingSources"->'lineItems') value WHERE value->'source'->>'kind' = 'EXPENSE') THEN
    RAISE EXCEPTION 'Invoice billing claims must match its exact source roster';
  END IF;
END;
$$;

CREATE FUNCTION invoice_billing_claims_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_invoice_billing_sources(NEW.id);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER invoice_billing_claims_guard AFTER INSERT OR UPDATE ON "invoices" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoice_billing_claims_guard();

CREATE FUNCTION source_billing_claims_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."invoiceId" IS NOT NULL THEN PERFORM assert_invoice_billing_sources(OLD."invoiceId"); END IF;
  IF TG_OP <> 'DELETE' AND NEW."invoiceId" IS NOT NULL THEN PERFORM assert_invoice_billing_sources(NEW."invoiceId"); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER time_billing_claims_guard AFTER INSERT OR UPDATE OR DELETE ON "time_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION source_billing_claims_guard();
CREATE CONSTRAINT TRIGGER expense_billing_claims_guard AFTER INSERT OR UPDATE OR DELETE ON "expenses" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION source_billing_claims_guard();
CREATE CONSTRAINT TRIGGER payment_invoice_billing_guard AFTER INSERT OR UPDATE OR DELETE ON "invoice_payments" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION source_billing_claims_guard();

CREATE FUNCTION source_billing_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    IF NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId" AND NEW."clientId" IS NOT DISTINCT FROM OLD."clientId" THEN RETURN NULL; END IF;
  ELSE
    IF NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId" THEN RETURN NULL; END IF;
  END IF;
  FOR invoice_id IN
    SELECT DISTINCT i.id FROM "invoices" i WHERE i."organizationId" IN (NEW."organizationId", OLD."organizationId") AND i."billingSources" IS NOT NULL AND (
      (TG_TABLE_NAME = 'clients' AND i."clientId" = NEW.id) OR
      (TG_TABLE_NAME = 'users' AND (i."createdById" = NEW.id OR EXISTS (SELECT 1 FROM "time_entries" t WHERE t."invoiceId" = i.id AND t."userId" = NEW.id))) OR
      (TG_TABLE_NAME = 'projects' AND (i."projectId" = NEW.id OR EXISTS (SELECT 1 FROM "time_entries" t WHERE t."invoiceId" = i.id AND t."projectId" = NEW.id) OR EXISTS (SELECT 1 FROM "expenses" e WHERE e."invoiceId" = i.id AND e."projectId" = NEW.id))))
  LOOP PERFORM assert_invoice_billing_sources(invoice_id); END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER billing_project_parent_guard AFTER UPDATE ON "projects" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION source_billing_parent_guard();
CREATE CONSTRAINT TRIGGER billing_client_parent_guard AFTER UPDATE ON "clients" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION source_billing_parent_guard();
CREATE CONSTRAINT TRIGGER billing_user_parent_guard AFTER UPDATE ON "users" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION source_billing_parent_guard();
