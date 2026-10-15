BEGIN;
CREATE TABLE "client_agent_conversations" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" TEXT NOT NULL CHECK (length(btrim("title")) BETWEEN 1 AND 200),
  "createdById" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("createdById", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "client_agent_conversations_id_organizationId_key" ON "client_agent_conversations"("id", "organizationId");
CREATE INDEX "client_agent_conversations_organizationId_clientId_id_idx" ON "client_agent_conversations"("organizationId", "clientId", "id");
CREATE INDEX "client_agent_conversations_clientId_idx" ON "client_agent_conversations"("clientId");
CREATE INDEX "client_agent_conversations_createdById_organizationId_idx" ON "client_agent_conversations"("createdById", "organizationId");

CREATE TABLE "client_agent_runs" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "conversationId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL CHECK ("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  "inputHash" TEXT NOT NULL CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
  "prompt" TEXT NOT NULL CHECK (length(btrim("prompt")) BETWEEN 1 AND 2000),
  "response" TEXT CHECK (length("response") <= 20000),
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  "profileRevision" INTEGER CHECK ("profileRevision" >= 0),
  "claimToken" TEXT,
  "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3), "deadlineAt" TIMESTAMP(3),
  "errorCode" TEXT CHECK (length("errorCode") <= 80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("conversationId", "organizationId") REFERENCES "client_agent_conversations"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("requestedById", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("status" <> 'QUEUED' OR ("claimToken" IS NULL AND "startedAt" IS NULL AND "finishedAt" IS NULL AND "deadlineAt" IS NULL)),
  CHECK ("status" <> 'RUNNING' OR ("claimToken" IS NOT NULL AND "startedAt" IS NOT NULL AND "deadlineAt" IS NOT NULL AND "finishedAt" IS NULL)),
  CHECK ("status" NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN') OR "finishedAt" IS NOT NULL),
  CHECK (("status" = 'SUCCEEDED' AND "response" IS NOT NULL AND length(btrim("response")) > 0) OR ("status" <> 'SUCCEEDED' AND "response" IS NULL))
);
CREATE UNIQUE INDEX "client_agent_runs_intent_key" ON "client_agent_runs"("organizationId", "requestedById", "idempotencyKey");
CREATE UNIQUE INDEX "client_agent_runs_one_active" ON "client_agent_runs"("organizationId", "conversationId") WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX "client_agent_runs_organizationId_conversationId_id_idx" ON "client_agent_runs"("organizationId", "conversationId", "id");
CREATE INDEX "client_agent_runs_organizationId_status_deadlineAt_idx" ON "client_agent_runs"("organizationId", "status", "deadlineAt");
CREATE INDEX "client_agent_runs_conversationId_organizationId_idx" ON "client_agent_runs"("conversationId", "organizationId");
CREATE INDEX "client_agent_runs_requestedById_organizationId_idx" ON "client_agent_runs"("requestedById", "organizationId");

CREATE FUNCTION client_agent_conversation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW."id", NEW."organizationId", NEW."clientId", NEW."createdById", NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."id", OLD."organizationId", OLD."clientId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Client agent conversation scope is immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "clients" WHERE "id" = NEW."clientId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Client agent conversation client must belong to its organization';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."createdById" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN', 'TEAM')) THEN
    RAISE EXCEPTION 'Client agent conversation creator must be active staff';
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW."revision" := OLD."revision" + 1; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_agent_conversation_guard BEFORE INSERT OR UPDATE ON "client_agent_conversations" FOR EACH ROW EXECUTE FUNCTION client_agent_conversation_guard();

CREATE FUNCTION client_agent_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."requestedById" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN', 'TEAM')) THEN
      RAISE EXCEPTION 'Client agent run requester must be active staff';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "client_agent_conversations" WHERE "id" = NEW."conversationId" AND "organizationId" = NEW."organizationId" AND "archivedAt" IS NULL) THEN
      RAISE EXCEPTION 'Client agent runs require an active conversation in their organization';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW."id", NEW."organizationId", NEW."conversationId", NEW."requestedById", NEW."idempotencyKey", NEW."inputHash", NEW."prompt", NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."id", OLD."organizationId", OLD."conversationId", OLD."requestedById", OLD."idempotencyKey", OLD."inputHash", OLD."prompt", OLD."createdAt") THEN
    RAISE EXCEPTION 'Client agent run identity and input are immutable';
  END IF;
  IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal client agent runs are immutable';
  END IF;
  IF OLD."status" = 'RUNNING' AND NEW."status" = 'QUEUED' THEN
    RAISE EXCEPTION 'Claimed client agent runs cannot be queued again';
  END IF;
  IF OLD."status" = 'RUNNING' AND NEW."status" = 'RUNNING' AND
      ROW(NEW."claimToken", NEW."startedAt", NEW."deadlineAt") IS DISTINCT FROM ROW(OLD."claimToken", OLD."startedAt", OLD."deadlineAt") THEN
    RAISE EXCEPTION 'A client agent run claimant cannot be replaced';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_agent_run_guard BEFORE INSERT OR UPDATE ON "client_agent_runs" FOR EACH ROW EXECUTE FUNCTION client_agent_run_guard();
COMMIT;
