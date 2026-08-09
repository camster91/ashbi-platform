-- Fail closed if an existing credential cannot be attributed to one tenant.
ALTER TABLE "credentials" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "credentials" ADD COLUMN "encryptionVersion" TEXT NOT NULL DEFAULT 'legacy';

UPDATE "credentials" AS credential
SET "organizationId" = client."organizationId"
FROM "clients" AS client
WHERE credential."clientId" = client."id";

UPDATE "credentials" AS credential
SET "organizationId" = project."organizationId"
FROM "projects" AS project
WHERE credential."organizationId" IS NULL AND credential."projectId" = project."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "credentials" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'credential ownership backfill failed: unowned rows remain';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "credentials" credential
    LEFT JOIN "clients" client ON credential."clientId" = client."id"
    LEFT JOIN "projects" project ON credential."projectId" = project."id"
    WHERE (client."id" IS NOT NULL AND client."organizationId" <> credential."organizationId")
       OR (project."id" IS NOT NULL AND project."organizationId" <> credential."organizationId")
  ) THEN
    RAISE EXCEPTION 'credential ownership backfill failed: cross-organization parent';
  END IF;
END $$;

ALTER TABLE "credentials" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "credentials"
  ADD CONSTRAINT "credentials_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "credentials_organizationId_idx" ON "credentials"("organizationId");

CREATE OR REPLACE FUNCTION enforce_credential_ownership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."clientId" IS NULL AND NEW."projectId" IS NULL THEN
    RAISE EXCEPTION 'credential requires a client or project owner';
  END IF;
  -- Keep the prior application image rollback-compatible: legacy writers do
  -- not know organizationId, so derive it from the verified parent.
  IF NEW."organizationId" IS NULL AND NEW."clientId" IS NOT NULL THEN
    SELECT "organizationId" INTO NEW."organizationId" FROM "clients" WHERE "id" = NEW."clientId";
  END IF;
  IF NEW."organizationId" IS NULL AND NEW."projectId" IS NOT NULL THEN
    SELECT "organizationId" INTO NEW."organizationId" FROM "projects" WHERE "id" = NEW."projectId";
  END IF;
  IF NEW."organizationId" IS NULL THEN
    RAISE EXCEPTION 'credential organization ownership could not be derived';
  END IF;
  IF NEW."clientId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "clients" WHERE "id" = NEW."clientId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'credential client belongs to a different organization';
  END IF;
  IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "projects" WHERE "id" = NEW."projectId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'credential project belongs to a different organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credentials_enforce_ownership
BEFORE INSERT OR UPDATE OF "organizationId", "clientId", "projectId" ON "credentials"
FOR EACH ROW EXECUTE FUNCTION enforce_credential_ownership();

CREATE TABLE "credential_access_audits" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "traceId" TEXT,
  "keyVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credential_access_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credential_access_audits_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "credential_access_audits_organizationId_createdAt_idx"
  ON "credential_access_audits"("organizationId", "createdAt");
CREATE INDEX "credential_access_audits_credentialId_createdAt_idx"
  ON "credential_access_audits"("credentialId", "createdAt");
CREATE INDEX "credential_access_audits_actorUserId_createdAt_idx"
  ON "credential_access_audits"("actorUserId", "createdAt");

-- Audit records are append-only even for database roles with table write access.
CREATE OR REPLACE FUNCTION deny_credential_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credential access audits are immutable';
END;
$$;

CREATE TRIGGER credential_access_audits_immutable
BEFORE UPDATE OR DELETE ON "credential_access_audits"
FOR EACH ROW EXECUTE FUNCTION deny_credential_audit_mutation();
