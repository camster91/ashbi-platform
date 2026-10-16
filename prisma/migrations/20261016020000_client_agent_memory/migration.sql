BEGIN;
ALTER TABLE "client_agent_runs" ADD COLUMN "memorySnapshot" JSONB;
CREATE FUNCTION client_agent_memory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE memory JSONB; turn JSONB; source "client_agent_runs"%ROWTYPE; seen TEXT[] := ARRAY[]::TEXT[];
  previous_created TIMESTAMP(3); previous_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."memorySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'Client agent memory cannot be inserted or backfilled'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."memorySnapshot" IS NOT DISTINCT FROM OLD."memorySnapshot" THEN
    -- Additive rollout/rollback compatibility: previous workers do not know
    -- memorySnapshot. Preserve NULL as evidence that memory was not captured;
    -- never fabricate an empty snapshot or prevent their context preparation.
    -- The context guard still enforces its claimed, write-once preparation.
    RETURN NEW;
  END IF;
  IF OLD."memorySnapshot" IS NOT NULL OR NEW."memorySnapshot" IS NULL OR OLD."contextSnapshot" IS NOT NULL
    OR NEW."contextSnapshot" IS NULL OR OLD.status <> 'RUNNING' OR NEW.status <> 'RUNNING'
    OR NEW."claimToken" IS NULL OR NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
    OR NEW."contextObservedAt" IS NULL OR OLD."contextObservedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Client agent memory is write-once with context preparation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."requestedById" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM'))
    OR NOT EXISTS (SELECT 1 FROM client_agent_conversations c JOIN clients ON clients.id = c."clientId" AND clients."organizationId" = c."organizationId"
      WHERE c.id = NEW."conversationId" AND c."organizationId" = NEW."organizationId" AND c."archivedAt" IS NULL AND clients."deletedAt" IS NULL
      AND (EXISTS (SELECT 1 FROM client_agent_profiles p WHERE p."clientId" = clients.id AND p."organizationId" = clients."organizationId" AND p.enabled
        AND p.revision = NEW."profileRevision" AND p."pluginIds" @> '["client-work"]'::jsonb)
      OR (NEW."profileRevision" = 0 AND NOT EXISTS (SELECT 1 FROM client_agent_profiles p WHERE p."clientId" = clients.id AND p."organizationId" = clients."organizationId")))) THEN
    RAISE EXCEPTION 'Client agent memory preparation requires current staff, active client and unchanged enabled profile';
  END IF;
  memory := NEW."memorySnapshot";
  IF jsonb_typeof(memory) IS DISTINCT FROM 'object' OR memory - ARRAY['version','turns','truncated'] <> '{}'::jsonb
    OR memory->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(memory->'truncated') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(memory->'turns') IS DISTINCT FROM 'array' OR octet_length(memory::text) > 8192 THEN
    RAISE EXCEPTION 'Invalid client agent memory shape or size';
  END IF;
  IF jsonb_array_length(memory->'turns') > 4 THEN RAISE EXCEPTION 'Too many client agent memory turns'; END IF;
  FOR turn IN SELECT * FROM jsonb_array_elements(memory->'turns') LOOP
    IF jsonb_typeof(turn) IS DISTINCT FROM 'object' OR turn - ARRAY['runId','prompt','response','responseTruncated'] <> '{}'::jsonb
      OR jsonb_typeof(turn->'runId') IS DISTINCT FROM 'string' OR length(turn->>'runId') NOT BETWEEN 1 AND 100
      OR jsonb_typeof(turn->'prompt') IS DISTINCT FROM 'string' OR length(turn->>'prompt') NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(turn->'response') IS DISTINCT FROM 'string' OR length(btrim(turn->>'response')) = 0 OR length(turn->>'response') > 4000
      OR jsonb_typeof(turn->'responseTruncated') IS DISTINCT FROM 'boolean' OR (turn->>'runId') = ANY(seen) THEN
      RAISE EXCEPTION 'Invalid client agent memory turn';
    END IF;
    SELECT * INTO source FROM "client_agent_runs" WHERE id = turn->>'runId'
      AND "organizationId" = NEW."organizationId" AND "conversationId" = NEW."conversationId" AND status = 'SUCCEEDED'
      AND "finishedAt" < NEW."createdAt" AND ("createdAt", id) < (NEW."createdAt", NEW.id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Client agent memory must reference a successful prior scoped run'; END IF;
    IF source.prompt IS DISTINCT FROM turn->>'prompt' OR
      (CASE WHEN (turn->>'responseTruncated')::boolean THEN
        length(turn->>'response') >= length(source.response) OR left(source.response, length(turn->>'response')) IS DISTINCT FROM turn->>'response'
      ELSE source.response IS DISTINCT FROM turn->>'response' END) THEN
      RAISE EXCEPTION 'Client agent memory must retain exact original text or a marked response prefix';
    END IF;
    IF previous_created IS NOT NULL AND (source."createdAt", source.id) <= (previous_created, previous_id) THEN
      RAISE EXCEPTION 'Client agent memory must be chronological';
    END IF;
    IF (turn->>'responseTruncated')::boolean AND NOT (memory->>'truncated')::boolean THEN RAISE EXCEPTION 'Client agent memory truncation must be explicit'; END IF;
    previous_created := source."createdAt"; previous_id := source.id;
    seen := array_append(seen, source.id);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_agent_memory_guard BEFORE INSERT OR UPDATE ON "client_agent_runs" FOR EACH ROW EXECUTE FUNCTION client_agent_memory_guard();
COMMIT;
