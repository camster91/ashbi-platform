BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS projects_id_organizationId_key ON projects(id,"organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS workspace_chat_messages_id_organizationId_key ON workspace_chat_messages(id,"organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS client_agent_runs_id_organizationId_key ON client_agent_runs(id,"organizationId");
CREATE TABLE workspace_account_manager_bindings (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "channelId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "projectId" TEXT, "profileId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL, "updatedById" TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"organizationId"), UNIQUE("organizationId","channelId"),
 FOREIGN KEY("channelId","organizationId") REFERENCES workspace_chat_channels(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("clientId","organizationId") REFERENCES clients(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("projectId","organizationId") REFERENCES projects(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("profileId","organizationId") REFERENCES client_agent_profiles(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("createdById","organizationId") REFERENCES users(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("updatedById","organizationId") REFERENCES users(id,"organizationId") ON DELETE RESTRICT
);
CREATE INDEX ON workspace_account_manager_bindings("channelId","organizationId");
CREATE INDEX ON workspace_account_manager_bindings("clientId","organizationId");
CREATE INDEX ON workspace_account_manager_bindings("projectId","organizationId");
CREATE INDEX ON workspace_account_manager_bindings("profileId","organizationId");
CREATE INDEX ON workspace_account_manager_bindings("createdById","organizationId");
CREATE INDEX ON workspace_account_manager_bindings("updatedById","organizationId");
ALTER TABLE client_agent_conversations ADD COLUMN "sourceChannelId" TEXT, ADD COLUMN "sourceBindingId" TEXT,
 ADD CHECK (("sourceChannelId" IS NULL) = ("sourceBindingId" IS NULL)),
 ADD FOREIGN KEY("sourceChannelId","organizationId") REFERENCES workspace_chat_channels(id,"organizationId") ON DELETE RESTRICT,
 ADD FOREIGN KEY("sourceBindingId","organizationId") REFERENCES workspace_account_manager_bindings(id,"organizationId") ON DELETE RESTRICT;
CREATE INDEX ON client_agent_conversations("sourceChannelId","organizationId");
CREATE INDEX ON client_agent_conversations("sourceBindingId","organizationId");
CREATE TABLE workspace_account_manager_invocations (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "bindingId" TEXT NOT NULL, "sourceMessageId" TEXT NOT NULL, "requestedById" TEXT NOT NULL,
 "conversationId" TEXT NOT NULL UNIQUE, "runId" TEXT NOT NULL UNIQUE,
 "idempotencyKey" TEXT NOT NULL CHECK("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 "inputHash" TEXT NOT NULL CHECK("inputHash" ~ '^[0-9a-f]{64}$'),
 "bindingRevision" INTEGER NOT NULL CHECK("bindingRevision">0), "profileRevision" INTEGER NOT NULL CHECK("profileRevision">0),
 "deliveryState" TEXT NOT NULL DEFAULT 'PENDING' CHECK("deliveryState" IN ('PENDING','DELIVERED','SUPPRESSED')),
 "deliveryCode" TEXT CHECK(length("deliveryCode")<=80), "deliveredAt" TIMESTAMP(3), "suppressedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("organizationId","sourceMessageId","bindingId"), UNIQUE("organizationId","requestedById","idempotencyKey"),
 UNIQUE("conversationId","organizationId"), UNIQUE("runId","organizationId"),
 FOREIGN KEY("bindingId","organizationId") REFERENCES workspace_account_manager_bindings(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("sourceMessageId","organizationId") REFERENCES workspace_chat_messages(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("requestedById","organizationId") REFERENCES users(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("conversationId","organizationId") REFERENCES client_agent_conversations(id,"organizationId") ON DELETE RESTRICT,
 FOREIGN KEY("runId","organizationId") REFERENCES client_agent_runs(id,"organizationId") ON DELETE RESTRICT,
 CHECK(("deliveryState"='DELIVERED')=("deliveredAt" IS NOT NULL)),
 CHECK(("deliveryState"='SUPPRESSED')=("suppressedAt" IS NOT NULL))
);
CREATE INDEX ON workspace_account_manager_invocations("bindingId","organizationId");
CREATE INDEX ON workspace_account_manager_invocations("sourceMessageId","organizationId");
CREATE INDEX ON workspace_account_manager_invocations("requestedById","organizationId");
CREATE INDEX ON workspace_account_manager_invocations("organizationId","deliveryState","createdAt");

CREATE FUNCTION workspace_agent_authority(binding_id TEXT, org_id TEXT, actor_id TEXT, profile_revision INTEGER, binding_revision INTEGER) RETURNS BOOLEAN LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM workspace_account_manager_bindings b
 JOIN workspace_chat_channels c ON c.id=b."channelId" AND c."organizationId"=b."organizationId"
 JOIN clients cl ON cl.id=b."clientId" AND cl."organizationId"=b."organizationId" AND cl."deletedAt" IS NULL
 JOIN client_agent_profiles p ON p.id=b."profileId" AND p."organizationId"=b."organizationId" AND p."clientId"=b."clientId"
 JOIN users u ON u.id=actor_id AND u."organizationId"=b."organizationId" AND u."isActive" AND u.role IN ('ADMIN','TEAM')
 JOIN workspace_chat_members m ON m."channelId"=c.id AND m."organizationId"=b."organizationId" AND m."userId"=u.id AND m."leftAt" IS NULL
 WHERE b.id=binding_id AND b."organizationId"=org_id AND b.enabled AND b.revision=binding_revision
 AND p.enabled AND p.revision=profile_revision AND p."pluginIds" @> '["client-work"]'::jsonb
 AND c."archivedAt" IS NULL AND c.kind IN ('CLIENT','PROJECT') AND c."clientId"=b."clientId" AND c."projectId" IS NOT DISTINCT FROM b."projectId"
 AND (b."projectId" IS NULL OR EXISTS(SELECT 1 FROM projects pr WHERE pr.id=b."projectId" AND pr."organizationId"=org_id AND pr."clientId"=b."clientId" AND pr."deletedAt" IS NULL)))
$$;
CREATE FUNCTION workspace_agent_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM workspace_chat_channels WHERE id=NEW."channelId" AND "organizationId"=NEW."organizationId" FOR UPDATE;
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."organizationId",NEW."channelId",NEW."clientId",NEW."projectId",NEW."profileId",NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."channelId",OLD."clientId",OLD."projectId",OLD."profileId",OLD."createdById",OLD."createdAt") THEN RAISE EXCEPTION 'Workspace bot binding identity is immutable'; END IF;
 IF TG_OP='INSERT' AND NEW.enabled THEN RAISE EXCEPTION 'Workspace bot installation starts disabled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_chat_channels c JOIN client_agent_profiles p ON p.id=NEW."profileId" AND p."organizationId"=NEW."organizationId" AND p."clientId"=NEW."clientId"
 JOIN users u ON u.id=NEW."updatedById" AND u."organizationId"=NEW."organizationId" AND u."isActive" AND u.role='ADMIN'
 JOIN workspace_chat_members m ON m."channelId"=c.id AND m."userId"=u.id AND m."organizationId"=NEW."organizationId" AND m."leftAt" IS NULL
 JOIN clients cl ON cl.id=NEW."clientId" AND cl."organizationId"=NEW."organizationId" AND cl."deletedAt" IS NULL
 WHERE c.id=NEW."channelId" AND c."organizationId"=NEW."organizationId" AND c.kind IN ('CLIENT','PROJECT') AND c."archivedAt" IS NULL
 AND c."clientId"=NEW."clientId" AND c."projectId" IS NOT DISTINCT FROM NEW."projectId"
 AND (NOT NEW.enabled OR (p.enabled AND p."pluginIds" @> '["client-work"]'::jsonb))
 AND (NEW."projectId" IS NULL OR EXISTS(SELECT 1 FROM projects pr WHERE pr.id=NEW."projectId" AND pr."organizationId"=NEW."organizationId" AND pr."clientId"=NEW."clientId" AND pr."deletedAt" IS NULL))) THEN RAISE EXCEPTION 'Workspace bot installation requires current canonical member administrator'; END IF;
 IF TG_OP='INSERT' AND NEW."createdById"<>NEW."updatedById" THEN RAISE EXCEPTION 'Installer identity mismatch'; END IF;
 IF TG_OP='UPDATE' THEN NEW.revision:=OLD.revision+1; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_agent_binding_guard BEFORE INSERT OR UPDATE ON workspace_account_manager_bindings FOR EACH ROW EXECUTE FUNCTION workspace_agent_binding_guard();

CREATE FUNCTION workspace_agent_conversation_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW."sourceChannelId",NEW."sourceBindingId") IS DISTINCT FROM ROW(OLD."sourceChannelId",OLD."sourceBindingId") THEN RAISE EXCEPTION 'Conversation source audience is immutable'; END IF;
 IF NEW."sourceChannelId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_account_manager_bindings b WHERE b.id=NEW."sourceBindingId" AND b."organizationId"=NEW."organizationId" AND b."channelId"=NEW."sourceChannelId" AND b."clientId"=NEW."clientId") THEN RAISE EXCEPTION 'Conversation requires exact canonical source binding'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_agent_conversation_source_guard BEFORE INSERT OR UPDATE ON client_agent_conversations FOR EACH ROW EXECUTE FUNCTION workspace_agent_conversation_source_guard();

CREATE FUNCTION workspace_agent_invocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW."organizationId",NEW."bindingId",NEW."sourceMessageId",NEW."requestedById",NEW."conversationId",NEW."runId",NEW."idempotencyKey",NEW."inputHash",NEW."bindingRevision",NEW."profileRevision",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."bindingId",OLD."sourceMessageId",OLD."requestedById",OLD."conversationId",OLD."runId",OLD."idempotencyKey",OLD."inputHash",OLD."bindingRevision",OLD."profileRevision",OLD."createdAt") THEN RAISE EXCEPTION 'Workspace invocation identity is immutable'; END IF;
  IF OLD."deliveryState"<>'PENDING' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Workspace invocation outcome is terminal'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW."deliveryState"='DELIVERED' THEN
  IF NOT workspace_agent_authority(NEW."bindingId",NEW."organizationId",NEW."requestedById",NEW."profileRevision",NEW."bindingRevision") THEN RAISE EXCEPTION 'Workspace invocation authority revoked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM workspace_account_manager_bindings b JOIN workspace_chat_messages m ON m.id=NEW."sourceMessageId" AND m."organizationId"=b."organizationId" AND m."channelId"=b."channelId"
  JOIN users author ON author.id=m."authorId" AND author."organizationId"=m."organizationId" AND author."isActive" AND author.role IN ('ADMIN','TEAM')
  JOIN client_agent_conversations c ON c.id=NEW."conversationId" AND c."organizationId"=b."organizationId" AND c."clientId"=b."clientId" AND c."sourceChannelId"=b."channelId" AND c."sourceBindingId"=b.id AND c."archivedAt" IS NULL
  JOIN client_agent_runs r ON r.id=NEW."runId" AND r."organizationId"=b."organizationId" AND r."conversationId"=c.id AND r."requestedById"=NEW."requestedById" AND r.prompt=btrim(m.content)
  WHERE b.id=NEW."bindingId" AND b."organizationId"=NEW."organizationId" AND r."profileRevision"=NEW."profileRevision" AND r."inputHash"=NEW."inputHash" AND r."idempotencyKey"=NEW."idempotencyKey"
  AND ((TG_OP='INSERT' AND NEW."deliveryState"='PENDING' AND r.status='QUEUED') OR (TG_OP='UPDATE' AND r.status='SUCCEEDED'))) THEN RAISE EXCEPTION 'Workspace invocation source/run mismatch'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_agent_invocation_guard BEFORE INSERT OR UPDATE ON workspace_account_manager_invocations FOR EACH ROW EXECUTE FUNCTION workspace_agent_invocation_guard();

CREATE FUNCTION workspace_agent_run_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c client_agent_conversations%ROWTYPE; i workspace_account_manager_invocations%ROWTYPE;
BEGIN
 SELECT * INTO c FROM client_agent_conversations WHERE id=NEW."conversationId" AND "organizationId"=NEW."organizationId";
 IF c."sourceChannelId" IS NULL OR NEW.status<>'SUCCEEDED' THEN RETURN NEW; END IF;
 PERFORM 1 FROM workspace_chat_channels WHERE id=c."sourceChannelId" AND "organizationId"=NEW."organizationId" FOR UPDATE;
 SELECT * INTO i FROM workspace_account_manager_invocations WHERE "runId"=NEW.id AND "organizationId"=NEW."organizationId";
 IF NEW.status='SUCCEEDED' AND (c."archivedAt" IS NOT NULL OR i.id IS NULL OR i."deliveryState"<>'PENDING' OR NOT workspace_agent_authority(i."bindingId",NEW."organizationId",NEW."requestedById",i."profileRevision",i."bindingRevision")) THEN RAISE EXCEPTION 'Workspace answer requires current delivery authority'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_agent_run_delivery_guard BEFORE UPDATE ON client_agent_runs FOR EACH ROW EXECUTE FUNCTION workspace_agent_run_delivery_guard();
CREATE FUNCTION workspace_agent_run_invocation_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM client_agent_conversations WHERE id=NEW."conversationId" AND "organizationId"=NEW."organizationId" AND "sourceChannelId" IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM workspace_account_manager_invocations WHERE "runId"=NEW.id AND "organizationId"=NEW."organizationId" AND "conversationId"=NEW."conversationId") THEN RAISE EXCEPTION 'Source-bound run requires its atomic invocation'; END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_agent_run_invocation_required AFTER INSERT ON client_agent_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_agent_run_invocation_required();
CREATE FUNCTION workspace_agent_delivery_pair_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state TEXT; run_status TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM client_agent_conversations WHERE id=NEW."conversationId" AND "organizationId"=NEW."organizationId" AND "sourceChannelId" IS NOT NULL) THEN
  SELECT i."deliveryState",r.status INTO state,run_status FROM workspace_account_manager_invocations i JOIN client_agent_runs r ON r.id=i."runId" AND r."organizationId"=i."organizationId" WHERE i."runId"=NEW.id AND i."organizationId"=NEW."organizationId";
  IF state IS NULL OR (run_status='SUCCEEDED') IS DISTINCT FROM (state='DELIVERED') OR (run_status IN ('FAILED','CANCELLED','UNKNOWN') AND state<>'SUPPRESSED') THEN RAISE EXCEPTION 'Private run and delivery outcome must commit atomically'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_agent_delivery_pair_required AFTER UPDATE ON client_agent_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_agent_delivery_pair_required();
COMMIT;
