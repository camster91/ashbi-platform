-- A separate portal audience; staff agent tables and their guards are unchanged.
CREATE TABLE portal_assistant_configs (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false, name TEXT NOT NULL DEFAULT 'Account manager' CHECK(length(name) BETWEEN 1 AND 80 AND name ~ '[^[:space:]]'),
 instructions TEXT NOT NULL DEFAULT '' CHECK(length(instructions)<=2000), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), "changedById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("organizationId") REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("clientId","organizationId") REFERENCES clients(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "portal_assistant_configs_organizationId_clientId_key" ON portal_assistant_configs("organizationId","clientId");
CREATE INDEX "portal_assistant_configs_clientId_organizationId_idx" ON portal_assistant_configs("clientId","organizationId");
CREATE TABLE portal_assistant_conversations (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "userId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
 "creationSessionVersion" INTEGER NOT NULL CHECK("creationSessionVersion">=0), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId") REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("clientId","organizationId") REFERENCES clients(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("projectId","organizationId") REFERENCES projects(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "portal_assistant_conversations_id_organizationId_key" ON portal_assistant_conversations(id,"organizationId");
CREATE UNIQUE INDEX portal_assistant_conversations_audience_key ON portal_assistant_conversations("organizationId","clientId","projectId","userId","contactId");
CREATE INDEX "portal_assistant_conversations_clientId_organizationId_idx" ON portal_assistant_conversations("clientId","organizationId");
CREATE INDEX "portal_assistant_conversations_projectId_organizationId_idx" ON portal_assistant_conversations("projectId","organizationId");
CREATE TABLE portal_assistant_runs (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "userId" TEXT NOT NULL, "contactId" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
 "creationSessionVersion" INTEGER NOT NULL CHECK("creationSessionVersion">=0), "configRevision" INTEGER NOT NULL CHECK("configRevision">0),
 "idempotencyKey" TEXT NOT NULL CHECK("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 "inputHash" TEXT NOT NULL CHECK("inputHash" ~ '^[0-9a-f]{64}$'), message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000 AND message ~ '[^[:space:]]'),
 response TEXT CHECK(octet_length(response)<=16000), status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED','EXPIRED','DISCARDED')),
 "claimToken" TEXT CHECK("claimToken" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), "contextSnapshot" JSONB, "memorySnapshot" JSONB,
 "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3), "deadlineAt" TIMESTAMP(3) NOT NULL,
 "errorCode" TEXT CHECK("errorCode" IN ('DEADLINE_EXCEEDED','INVALID_RESPONSE','PROVIDER_UNAVAILABLE','AUTHORITY_CHANGED','AI_DISABLED','AI_BUDGET_EXCEEDED')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("organizationId") REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("clientId","organizationId") REFERENCES clients(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("projectId","organizationId") REFERENCES projects(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("conversationId","organizationId") REFERENCES portal_assistant_conversations(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK((status='QUEUED' AND "claimToken" IS NULL AND "startedAt" IS NULL AND "finishedAt" IS NULL AND "contextSnapshot" IS NULL AND "memorySnapshot" IS NULL)
   OR (status='RUNNING' AND "claimToken" IS NOT NULL AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL AND "contextSnapshot" IS NOT NULL AND "memorySnapshot" IS NOT NULL)
   OR (status NOT IN ('QUEUED','RUNNING') AND "finishedAt" IS NOT NULL)),
 CHECK(status NOT IN ('QUEUED','RUNNING') OR "errorCode" IS NULL),
 CHECK((status='SUCCEEDED' AND response IS NOT NULL AND length(btrim(response))>0 AND "errorCode" IS NULL) OR (status<>'SUCCEEDED' AND response IS NULL))
);
CREATE UNIQUE INDEX portal_assistant_runs_intent_key ON portal_assistant_runs("organizationId","clientId","userId","contactId","idempotencyKey");
CREATE UNIQUE INDEX portal_assistant_runs_one_active ON portal_assistant_runs("organizationId","conversationId") WHERE status=ANY(ARRAY['QUEUED'::text,'RUNNING'::text]);
CREATE INDEX "portal_assistant_runs_audience_id_idx" ON portal_assistant_runs("organizationId","clientId","projectId","userId","contactId",id);
CREATE INDEX "portal_assistant_runs_clientId_organizationId_idx" ON portal_assistant_runs("clientId","organizationId");
CREATE INDEX "portal_assistant_runs_projectId_organizationId_idx" ON portal_assistant_runs("projectId","organizationId");
CREATE INDEX "portal_assistant_runs_conversationId_organizationId_idx" ON portal_assistant_runs("conversationId","organizationId");

CREATE FUNCTION portal_assistant_authorized(org TEXT, client TEXT, project TEXT, person TEXT, contact TEXT, version INTEGER) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 PERFORM 1 FROM users WHERE id=person FOR SHARE;
 PERFORM 1 FROM contacts WHERE id=contact FOR SHARE;
 PERFORM 1 FROM clients WHERE id=client FOR SHARE;
 PERFORM 1 FROM projects WHERE id=project FOR SHARE;
 RETURN EXISTS(SELECT 1 FROM users u JOIN contacts k ON k.id=contact AND k."clientId"=client AND lower(k.email)=lower(u.email)
 JOIN clients c ON c.id=client AND c."organizationId"=org JOIN projects p ON p.id=project AND p."organizationId"=org AND p."clientId"=client
 WHERE u.id=person AND u."organizationId"=org AND u."clientId"=client AND u.role='CLIENT' AND u."isActive" AND u."sessionVersion"=version
 AND c."deletedAt" IS NULL AND c.status='ACTIVE' AND c."relationshipStatus" NOT IN ('ARCHIVED','CHURNED') AND p."deletedAt" IS NULL);
END $$;
CREATE FUNCTION portal_assistant_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Portal configuration is retained'; END IF;
 PERFORM 1 FROM users WHERE id=NEW."changedById" FOR SHARE;
 PERFORM 1 FROM clients WHERE id=NEW."clientId" FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW."changedById" AND "organizationId"=NEW."organizationId" AND role='ADMIN' AND "isActive")
 OR NOT EXISTS(SELECT 1 FROM clients WHERE id=NEW."clientId" AND "organizationId"=NEW."organizationId" AND "deletedAt" IS NULL AND status='ACTIVE' AND "relationshipStatus" NOT IN ('ARCHIVED','CHURNED')) THEN RAISE EXCEPTION 'Portal configuration authority unavailable'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>1 THEN RAISE EXCEPTION 'Invalid portal config origin'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.id,NEW."organizationId",NEW."clientId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."clientId",OLD."createdAt") OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable portal config or stale revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_assistant_config_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_assistant_configs FOR EACH ROW EXECUTE FUNCTION portal_assistant_config_guard();
CREATE FUNCTION portal_assistant_conversation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Portal conversation origin is immutable'; END IF;
 PERFORM portal_assistant_authorized(NEW."organizationId",NEW."clientId",NEW."projectId",NEW."userId",NEW."contactId",NEW."creationSessionVersion");
 PERFORM 1 FROM portal_assistant_configs WHERE "organizationId"=NEW."organizationId" AND "clientId"=NEW."clientId" FOR SHARE;
 IF NOT portal_assistant_authorized(NEW."organizationId",NEW."clientId",NEW."projectId",NEW."userId",NEW."contactId",NEW."creationSessionVersion")
 OR NOT EXISTS(SELECT 1 FROM portal_assistant_configs WHERE "organizationId"=NEW."organizationId" AND "clientId"=NEW."clientId" AND enabled) THEN RAISE EXCEPTION 'Portal principal or configuration unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_assistant_conversation_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_assistant_conversations FOR EACH ROW EXECUTE FUNCTION portal_assistant_conversation_guard();
CREATE FUNCTION portal_assistant_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authorized BOOLEAN; expected_memory JSONB;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Portal assistant runs are retained'; END IF;
 authorized := portal_assistant_authorized(NEW."organizationId",NEW."clientId",NEW."projectId",NEW."userId",NEW."contactId",NEW."creationSessionVersion")
;
 PERFORM 1 FROM portal_assistant_configs WHERE "organizationId"=NEW."organizationId" AND "clientId"=NEW."clientId" FOR SHARE;
 authorized := authorized AND EXISTS(SELECT 1 FROM portal_assistant_configs WHERE "organizationId"=NEW."organizationId" AND "clientId"=NEW."clientId" AND enabled AND revision=NEW."configRevision");
 IF NOT EXISTS(SELECT 1 FROM portal_assistant_conversations WHERE id=NEW."conversationId" AND "organizationId"=NEW."organizationId" AND "clientId"=NEW."clientId" AND "projectId"=NEW."projectId" AND "userId"=NEW."userId" AND "contactId"=NEW."contactId") THEN RAISE EXCEPTION 'Foreign portal conversation'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT authorized OR NEW.status<>'QUEUED' OR NEW."errorCode" IS NOT NULL OR NEW."deadlineAt"<=clock_timestamp() OR NEW."deadlineAt">clock_timestamp()+interval '61 seconds'
   OR NEW."inputHash"<>encode(sha256(convert_to(NEW.message,'UTF8')),'hex') THEN RAISE EXCEPTION 'Invalid portal assistant intent'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW."organizationId",NEW."clientId",NEW."projectId",NEW."userId",NEW."contactId",NEW."conversationId",NEW."creationSessionVersion",NEW."configRevision",NEW."idempotencyKey",NEW."inputHash",NEW.message,NEW."deadlineAt",NEW."createdAt")
 IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."clientId",OLD."projectId",OLD."userId",OLD."contactId",OLD."conversationId",OLD."creationSessionVersion",OLD."configRevision",OLD."idempotencyKey",OLD."inputHash",OLD.message,OLD."deadlineAt",OLD."createdAt") THEN RAISE EXCEPTION 'Immutable portal intent'; END IF;
 IF OLD.status NOT IN ('QUEUED','RUNNING') THEN RAISE EXCEPTION 'Portal run already terminal'; END IF;
 IF OLD.status='QUEUED' AND NEW.status='RUNNING' THEN
  IF NOT authorized OR NEW."deadlineAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Portal dispatch authority expired'; END IF;
  IF jsonb_typeof(NEW."contextSnapshot")<>'object' OR jsonb_typeof(NEW."memorySnapshot")<>'array' OR jsonb_array_length(NEW."memorySnapshot")>4 OR octet_length(NEW."contextSnapshot"::text)>4096 OR octet_length(NEW."memorySnapshot"::text)>96000 THEN RAISE EXCEPTION 'Invalid portal context'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."contextSnapshot"))<>3
   OR NOT (NEW."contextSnapshot" ?& ARRAY['observedAt','client','project'])
   OR jsonb_typeof(NEW."contextSnapshot"->'observedAt')<>'string'
   OR (NEW."contextSnapshot"->>'observedAt')::timestamptz < (NEW."createdAt" AT TIME ZONE 'UTC')
   OR (NEW."contextSnapshot"->>'observedAt')::timestamptz > clock_timestamp()+interval '1 second'
   OR (SELECT count(*) FROM jsonb_object_keys(NEW."contextSnapshot"->'client'))<>2
   OR NOT ((NEW."contextSnapshot"->'client') ?& ARRAY['id','name'])
   OR (SELECT count(*) FROM jsonb_object_keys(NEW."contextSnapshot"->'project'))<>5
   OR NOT ((NEW."contextSnapshot"->'project') ?& ARRAY['id','name','status','startDate','endDate'])
   OR NEW."contextSnapshot"->'client'->>'id' IS DISTINCT FROM NEW."clientId"
   OR NEW."contextSnapshot"->'project'->>'id' IS DISTINCT FROM NEW."projectId"
   OR NOT EXISTS(SELECT 1 FROM clients c JOIN projects p ON p.id=NEW."projectId" WHERE c.id=NEW."clientId"
     AND NEW."contextSnapshot"->'client'->>'name'=left(c.name,200)
     AND NEW."contextSnapshot"->'project'->>'name'=left(p.name,200)
     AND NEW."contextSnapshot"->'project'->>'status'=p.status::text
     AND (NEW."contextSnapshot"->'project'->>'startDate')::timestamptz IS NOT DISTINCT FROM (p."startDate" AT TIME ZONE 'UTC')
     AND (NEW."contextSnapshot"->'project'->>'endDate')::timestamptz IS NOT DISTINCT FROM (p."endDate" AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'Portal snapshot must contain only canonical public identity'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('question',r.message,'response',r.response) ORDER BY r."finishedAt",r.id),'[]'::jsonb)
   INTO expected_memory FROM (SELECT message,response,"finishedAt",id FROM portal_assistant_runs
     WHERE "organizationId"=NEW."organizationId" AND "clientId"=NEW."clientId" AND "projectId"=NEW."projectId" AND "userId"=NEW."userId" AND "contactId"=NEW."contactId" AND status='SUCCEEDED'
     ORDER BY "finishedAt" DESC,id DESC LIMIT 4) r;
  IF NEW."memorySnapshot" IS DISTINCT FROM expected_memory THEN RAISE EXCEPTION 'Portal memory must match successful private turns'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW."claimToken",NEW."startedAt",NEW."contextSnapshot",NEW."memorySnapshot") IS DISTINCT FROM ROW(OLD."claimToken",OLD."startedAt",OLD."contextSnapshot",OLD."memorySnapshot") THEN RAISE EXCEPTION 'Immutable portal claim'; END IF;
 IF NEW.status='CANCELLED' THEN RETURN NEW; END IF;
 IF OLD.status='QUEUED' AND NEW.status='EXPIRED' AND NEW."deadlineAt"<=clock_timestamp() AND NEW."errorCode"='DEADLINE_EXCEEDED' THEN RETURN NEW; END IF;
 IF OLD.status='RUNNING' THEN
  IF NEW.status='DISCARDED' AND NOT authorized AND NEW."errorCode"='AUTHORITY_CHANGED' THEN RETURN NEW; END IF;
  IF NEW.status='UNKNOWN' AND NEW."errorCode" IN ('DEADLINE_EXCEEDED','PROVIDER_UNAVAILABLE') THEN RETURN NEW; END IF;
  IF authorized AND NEW."deadlineAt">clock_timestamp() AND NEW.status IN ('SUCCEEDED','FAILED') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Invalid portal assistant transition';
END $$;
CREATE TRIGGER portal_assistant_run_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_assistant_runs FOR EACH ROW EXECUTE FUNCTION portal_assistant_run_guard();
