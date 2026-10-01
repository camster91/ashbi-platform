-- Client domains are unique per organization, not across all organizations.
--
-- The baseline made "clients"."domain" globally unique. Two consequences:
--   * an empty domain ('') submitted by the client form was stored as '' and
--     the second domain-less client of ANY organization failed with a unique
--     violation (409);
--   * organization B could not add a client whose domain organization A
--     already uses, and the refusal told B that some other tenant holds that
--     domain (a cross-tenant existence oracle and a denial of service).
--
-- This migration
--   1. drops the global unique index "clients_domain_key";
--   2. normalizes every stored domain the way the API now does on write:
--      trimmed, lowercased, and '' / whitespace-only stored as NULL;
--   3. resolves duplicates that step 2 (or earlier data) leaves inside one
--      organization deterministically instead of failing: per
--      (organizationId, domain) the live (not soft-deleted) client created
--      first keeps the domain (ties broken by id); every other client of that
--      organization with the same domain has it set to NULL, and a note naming
--      the cleared domain is appended to its "clientNotes" so the change is
--      visible and reversible by hand. Nothing is deleted;
--   4. adds the composite unique index on ("organizationId", "domain").
--      NULL domains never conflict, so any number of clients may have none.
--
-- Rollback: older application images keep working against this schema (they
-- look clients up by domain inside their own organization only and treat a
-- conflict as 409); re-adding the global index would need the cross-tenant
-- duplicates it forbade to be resolved first.
--
-- Atomicity: Prisma sends this file as one multi-statement query, which
-- PostgreSQL runs as a single implicit transaction: all four steps apply or
-- none do, and SET LOCAL lasts until its end. There is deliberately no
-- explicit BEGIN/COMMIT, so a failure reports its real error and the
-- migration can simply be rerun.
SET LOCAL lock_timeout = '5s';

-- 1. The global index (baseline) goes first: normalizing case could otherwise
--    collide across organizations.
DROP INDEX IF EXISTS "clients_domain_key";

-- 2. Normalize.
UPDATE "clients"
SET "domain" = NULLIF(lower(btrim("domain")), '')
WHERE "domain" IS NOT NULL
  AND "domain" IS DISTINCT FROM NULLIF(lower(btrim("domain")), '');

-- 3. Deterministic per-organization dedupe (see the header).
WITH ranked AS (
  SELECT "id", "domain",
         row_number() OVER (
           PARTITION BY "organizationId", "domain"
           ORDER BY ("deletedAt" IS NOT NULL), "createdAt", "id"
         ) AS rn
  FROM "clients"
  WHERE "domain" IS NOT NULL
)
UPDATE "clients" AS c
SET "domain" = NULL,
    "clientNotes" = concat_ws(
      E'\n',
      NULLIF(c."clientNotes", ''),
      '[migration 20261001150000_client_domain_per_org] Domain "' || ranked."domain"
        || '" was cleared: another client in this organization keeps this domain.'
    )
FROM ranked
WHERE c."id" = ranked."id" AND ranked.rn > 1;

-- 4. Per-organization uniqueness.
CREATE UNIQUE INDEX "clients_organizationId_domain_key" ON "clients"("organizationId", "domain");
