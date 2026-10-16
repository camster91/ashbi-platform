BEGIN;
ALTER TABLE "client_agent_runs" ADD COLUMN "contextObservedAt" TIMESTAMP(3), ADD COLUMN "contextSnapshot" JSONB;

-- Strict whitelist: historical evidence must never grow into arbitrary client data.
CREATE FUNCTION client_agent_context_valid(value JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE snapshot JSONB; client JSONB; project JSONB; field TEXT;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR octet_length(value::text) > 65536 THEN RETURN false; END IF;
  IF value - ARRAY['version', 'snapshot'] <> '{}'::jsonb OR value->'version' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
  snapshot := value->'snapshot';
  IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object' OR snapshot - ARRAY['client', 'projects', 'truncated'] <> '{}'::jsonb
      OR jsonb_typeof(snapshot->'truncated') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  client := snapshot->'client';
  IF jsonb_typeof(client) IS DISTINCT FROM 'object' OR client - ARRAY['id', 'name', 'domain'] <> '{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(client->'id') IS DISTINCT FROM 'string' OR length(client->>'id') NOT BETWEEN 1 AND 100
      OR jsonb_typeof(client->'name') IS DISTINCT FROM 'string' OR length(client->>'name') > 2000
      OR NOT (client ? 'domain') OR jsonb_typeof(client->'domain') NOT IN ('null', 'string')
      OR length(client->>'domain') > 2048 THEN RETURN false; END IF;
  IF jsonb_typeof(snapshot->'projects') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(snapshot->'projects') > 25 THEN RETURN false; END IF;
  FOR project IN SELECT * FROM jsonb_array_elements(snapshot->'projects') LOOP
    IF jsonb_typeof(project) IS DISTINCT FROM 'object' OR project - ARRAY['id', 'name', 'status', 'startDate', 'endDate'] <> '{}'::jsonb THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['id', 'name', 'status'] LOOP
      IF jsonb_typeof(project->field) IS DISTINCT FROM 'string' OR length(project->>field) > (CASE WHEN field = 'name' THEN 2000 ELSE 100 END)
          OR (field = 'id' AND length(project->>field) = 0) THEN RETURN false; END IF;
    END LOOP;
    FOREACH field IN ARRAY ARRAY['startDate', 'endDate'] LOOP
      IF NOT (project ? field) OR jsonb_typeof(project->field) NOT IN ('null', 'string') THEN RETURN false; END IF;
      IF jsonb_typeof(project->field) = 'string' AND (length(project->>field) > 40
          OR project->>field !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;
ALTER TABLE "client_agent_runs" ADD CONSTRAINT "client_agent_runs_context_pair"
  CHECK (("contextObservedAt" IS NULL) = ("contextSnapshot" IS NULL));
ALTER TABLE "client_agent_runs" ADD CONSTRAINT "client_agent_runs_context_shape"
  CHECK ("contextSnapshot" IS NULL OR client_agent_context_valid("contextSnapshot"));

CREATE FUNCTION client_agent_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."contextSnapshot" IS NOT NULL AND NEW."profileRevision" IS DISTINCT FROM OLD."profileRevision" THEN
    RAISE EXCEPTION 'Prepared client agent profile revision is immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."contextObservedAt" IS NOT NULL OR NEW."contextSnapshot" IS NOT NULL THEN
      RAISE EXCEPTION 'Client agent context may only be prepared by a claimed run';
    END IF;
  ELSIF ROW(NEW."contextObservedAt", NEW."contextSnapshot") IS DISTINCT FROM ROW(OLD."contextObservedAt", OLD."contextSnapshot") THEN
    IF OLD."contextObservedAt" IS NOT NULL OR OLD."contextSnapshot" IS NOT NULL OR OLD.status <> 'RUNNING' OR NEW.status <> 'RUNNING'
        OR NEW."claimToken" IS DISTINCT FROM OLD."claimToken" OR NEW."claimToken" IS NULL
        OR NEW."profileRevision" IS NULL OR NEW."contextObservedAt" < NEW."startedAt" OR NEW."contextObservedAt" >= NEW."deadlineAt" THEN
      RAISE EXCEPTION 'Client agent context is write-once during its permanent claim';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "client_agent_conversations" WHERE id = NEW."conversationId"
        AND "organizationId" = NEW."organizationId" AND "clientId" = NEW."contextSnapshot"->'snapshot'->'client'->>'id') THEN
      RAISE EXCEPTION 'Client agent context must reference its canonical client';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_agent_context_guard BEFORE INSERT OR UPDATE ON "client_agent_runs" FOR EACH ROW EXECUTE FUNCTION client_agent_context_guard();
COMMIT;
