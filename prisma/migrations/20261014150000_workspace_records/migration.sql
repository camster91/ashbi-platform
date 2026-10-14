-- CreateTable
CREATE TABLE "workspace_collections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "portfolio" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "schemaRevision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_record_forms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_record_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_collections_organizationId_idx" ON "workspace_collections"("organizationId");

-- CreateIndex
CREATE INDEX "workspace_collections_organizationId_archivedAt_id_idx" ON "workspace_collections"("organizationId", "archivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_collections_id_organizationId_key" ON "workspace_collections"("id", "organizationId");

-- CreateIndex
CREATE INDEX "workspace_records_organizationId_idx" ON "workspace_records"("organizationId");

-- CreateIndex
CREATE INDEX "workspace_records_collectionId_archivedAt_id_idx" ON "workspace_records"("collectionId", "archivedAt", "id");

-- CreateIndex
CREATE INDEX "workspace_record_forms_organizationId_idx" ON "workspace_record_forms"("organizationId");

-- CreateIndex
CREATE INDEX "workspace_record_forms_collectionId_archivedAt_id_idx" ON "workspace_record_forms"("collectionId", "archivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_organizationId_key" ON "users"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "workspace_collections" ADD CONSTRAINT "workspace_collections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_collections" ADD CONSTRAINT "workspace_collections_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_records" ADD CONSTRAINT "workspace_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_records" ADD CONSTRAINT "workspace_records_collectionId_organizationId_fkey" FOREIGN KEY ("collectionId", "organizationId") REFERENCES "workspace_collections"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_records" ADD CONSTRAINT "workspace_records_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_record_forms" ADD CONSTRAINT "workspace_record_forms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_record_forms" ADD CONSTRAINT "workspace_record_forms_collectionId_organizationId_fkey" FOREIGN KEY ("collectionId", "organizationId") REFERENCES "workspace_collections"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_record_forms" ADD CONSTRAINT "workspace_record_forms_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Revision and scope invariants apply to raw writes as well as request Prisma.
CREATE FUNCTION workspace_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f jsonb; old_f jsonb; dependent record; relation_f jsonb; target_f jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW."organizationId", NEW."authorId") IS DISTINCT FROM (OLD.id, OLD."organizationId", OLD."authorId") THEN RAISE EXCEPTION 'Collection identity cannot change'; END IF;
    NEW.revision := OLD.revision + 1;
    NEW."schemaRevision" := OLD."schemaRevision" + CASE WHEN NEW.fields IS DISTINCT FROM OLD.fields THEN 1 ELSE 0 END;
    IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NOT NULL AND (NEW.name, NEW.description, NEW.portfolio, NEW.fields) IS DISTINCT FROM (OLD.name, OLD.description, OLD.portfolio, OLD.fields) THEN RAISE EXCEPTION 'Restore collection before editing'; END IF;
    FOR old_f IN SELECT value FROM jsonb_array_elements(OLD.fields) LOOP
      SELECT value INTO f FROM jsonb_array_elements(NEW.fields) WHERE value->>'key' = old_f->>'key';
      IF f IS NULL OR (f->>'type', f->>'target', f->>'collectionId') IS DISTINCT FROM (old_f->>'type', old_f->>'target', old_f->>'collectionId') THEN RAISE EXCEPTION 'Archive fields instead of reinterpreting historical values'; END IF;
      IF old_f ? 'options' AND NOT COALESCE(f->'options' @> old_f->'options', false) THEN RAISE EXCEPTION 'Existing choices must remain'; END IF;
    END LOOP;
  ELSE NEW.revision := 0; NEW."schemaRevision" := 0;
  END IF;
  IF length(btrim(NEW.name)) NOT BETWEEN 1 AND 200 OR length(NEW.description) > 2000 OR (NEW.portfolio IS NOT NULL AND NEW.portfolio NOT IN ('ASHBI_DESIGN', 'FREELANCE')) OR jsonb_typeof(NEW.fields) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid collection'; END IF;
  IF jsonb_array_length(NEW.fields) > 40 THEN RAISE EXCEPTION 'Too many collection fields'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.fields) GROUP BY lower(value->>'key') HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.fields) GROUP BY lower(btrim(value->>'name')) HAVING count(*) > 1) THEN RAISE EXCEPTION 'Field keys and names must be unique'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(NEW.fields) LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR f->>'key' IS NULL OR f->>'key' !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,79}$' OR f->>'key' IN ('constructor', 'prototype', '__proto__') OR COALESCE(length(btrim(f->>'name')), 0) NOT BETWEEN 1 AND 80 OR f->>'type' IS NULL OR f->>'type' NOT IN ('TEXT','NUMBER','BOOLEAN','DATE','URL','SELECT','MULTI_SELECT','RELATION','FORMULA','ROLLUP') THEN RAISE EXCEPTION 'Invalid collection field'; END IF;
    IF f->>'type' = 'RELATION' THEN
      IF (f ? 'collectionId') = (f ? 'target') THEN RAISE EXCEPTION 'Choose one relation target'; END IF;
      IF f ? 'target' THEN
        IF f->>'target' NOT IN ('TASK','PROJECT','CLIENT','PERSON') THEN RAISE EXCEPTION 'Invalid relation target'; END IF;
      ELSIF f->>'collectionId' <> NEW.id AND NOT EXISTS (SELECT 1 FROM workspace_collections c WHERE c.id = f->>'collectionId' AND c."organizationId" = NEW."organizationId") THEN RAISE EXCEPTION 'Related collection is unavailable';
      END IF;
    END IF;
  END LOOP;
  -- A schema change cannot invalidate another collection's existing rollup.
  IF TG_OP = 'UPDATE' AND NEW.fields IS DISTINCT FROM OLD.fields THEN
    FOR dependent IN
      SELECT c.fields AS definitions, r.value AS rollup FROM workspace_collections c CROSS JOIN LATERAL jsonb_array_elements(c.fields) r WHERE c.id <> NEW.id AND c."organizationId" = NEW."organizationId" AND r.value->>'type' = 'ROLLUP' AND COALESCE(r.value->>'archived','false') <> 'true'
      UNION ALL SELECT NEW.fields, value FROM jsonb_array_elements(NEW.fields) WHERE value->>'type' = 'ROLLUP' AND COALESCE(value->>'archived','false') <> 'true'
    LOOP
      SELECT value INTO relation_f FROM jsonb_array_elements(dependent.definitions) WHERE value->>'key' = dependent.rollup->>'relationKey' AND value->>'collectionId' = NEW.id AND COALESCE(value->>'archived','false') <> 'true';
      IF relation_f IS NOT NULL AND dependent.rollup->>'aggregate' <> 'COUNT' THEN
        SELECT value INTO target_f FROM jsonb_array_elements(NEW.fields) WHERE value->>'key' = dependent.rollup->>'targetKey';
        IF target_f IS NULL OR COALESCE(target_f->>'archived','false') = 'true' OR (dependent.rollup->>'aggregate' = 'UNIQUE' AND target_f->>'type' NOT IN ('TEXT','SELECT','NUMBER','DATE','BOOLEAN')) OR (dependent.rollup->>'aggregate' <> 'UNIQUE' AND target_f->>'type' <> 'NUMBER') THEN RAISE EXCEPTION 'Update dependent rollups before changing target fields'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_collection_guard BEFORE INSERT OR UPDATE ON workspace_collections FOR EACH ROW EXECUTE FUNCTION workspace_collection_guard();

CREATE FUNCTION workspace_record_values_guard(collection_id text, organization_id text, input_values jsonb, previous_values jsonb, full_validation boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE definitions jsonb; pair record; f jsonb; selected jsonb; identifier text; valid boolean;
BEGIN
  SELECT fields INTO definitions FROM workspace_collections WHERE id = collection_id AND "organizationId" = organization_id;
  IF definitions IS NULL OR jsonb_typeof(input_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid record values'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(input_values)) > 40 THEN RAISE EXCEPTION 'Too many record values'; END IF;
  FOR pair IN SELECT * FROM jsonb_each(input_values) LOOP
    SELECT value INTO f FROM jsonb_array_elements(definitions) WHERE value->>'key' = pair.key;
    IF f IS NULL OR f->>'type' IN ('FORMULA','ROLLUP') THEN RAISE EXCEPTION 'Unknown or computed record input'; END IF;
    IF COALESCE(f->>'archived','false') = 'true' THEN
      IF previous_values IS NULL OR pair.value IS DISTINCT FROM previous_values->pair.key THEN RAISE EXCEPTION 'Archived input cannot change'; END IF;
      CONTINUE;
    END IF;
    IF pair.value = 'null'::jsonb THEN CONTINUE; END IF;
    valid := CASE f->>'type'
      WHEN 'TEXT' THEN jsonb_typeof(pair.value) = 'string' AND length(pair.value #>> '{}') <= 2000
      WHEN 'URL' THEN jsonb_typeof(pair.value) = 'string' AND length(pair.value #>> '{}') <= 2048
      WHEN 'DATE' THEN jsonb_typeof(pair.value) = 'string' AND (pair.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      WHEN 'NUMBER' THEN jsonb_typeof(pair.value) = 'number'
      WHEN 'BOOLEAN' THEN jsonb_typeof(pair.value) = 'boolean'
      WHEN 'SELECT' THEN jsonb_typeof(pair.value) = 'string' AND COALESCE(f->'options' @> jsonb_build_array(pair.value), false)
      WHEN 'MULTI_SELECT' THEN jsonb_typeof(pair.value) = 'array'
      WHEN 'RELATION' THEN jsonb_typeof(pair.value) = 'array'
      ELSE false END;
    IF NOT COALESCE(valid, false) THEN RAISE EXCEPTION 'Invalid typed record input'; END IF;
    IF f->>'type' IN ('RELATION','MULTI_SELECT') THEN
      IF jsonb_array_length(pair.value) > (CASE WHEN f->>'type' = 'RELATION' THEN 100 ELSE 30 END) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(pair.value)) <> jsonb_array_length(pair.value) THEN RAISE EXCEPTION 'Invalid record selection'; END IF;
      FOR selected IN SELECT value FROM jsonb_array_elements(pair.value) LOOP
        IF jsonb_typeof(selected) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Selection must contain identifiers or choices'; END IF;
        IF f->>'type' = 'MULTI_SELECT' THEN
          IF NOT COALESCE(f->'options' @> jsonb_build_array(selected),false) THEN RAISE EXCEPTION 'Unknown choice'; END IF;
          CONTINUE;
        END IF;
        identifier := selected #>> '{}';
        IF length(identifier) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Invalid relation identifier'; END IF;
        -- Preserve broken historical links on unrelated edits; new/changed
        -- selections and restores must resolve to active same-workspace rows.
        IF NOT full_validation AND previous_values IS NOT NULL AND pair.value IS NOT DISTINCT FROM previous_values->pair.key THEN CONTINUE; END IF;
        valid := false;
        IF f ? 'collectionId' THEN
          SELECT EXISTS (SELECT 1 FROM workspace_records r JOIN workspace_collections c ON c.id = r."collectionId" AND c."organizationId" = r."organizationId" WHERE r.id = identifier AND r."collectionId" = f->>'collectionId' AND r."organizationId" = organization_id AND r."archivedAt" IS NULL AND c."archivedAt" IS NULL) INTO valid;
        ELSIF f->>'target' = 'CLIENT' THEN SELECT EXISTS (SELECT 1 FROM clients WHERE id = identifier AND "organizationId" = organization_id AND "deletedAt" IS NULL) INTO valid;
        ELSIF f->>'target' = 'PROJECT' THEN SELECT EXISTS (SELECT 1 FROM projects WHERE id = identifier AND "organizationId" = organization_id AND "deletedAt" IS NULL) INTO valid;
        ELSIF f->>'target' = 'TASK' THEN SELECT EXISTS (SELECT 1 FROM tasks t JOIN projects p ON p.id = t."projectId" WHERE t.id = identifier AND p."organizationId" = organization_id AND t."deletedAt" IS NULL AND p."deletedAt" IS NULL) INTO valid;
        ELSIF f->>'target' = 'PERSON' THEN SELECT EXISTS (SELECT 1 FROM users WHERE id = identifier AND "organizationId" = organization_id AND "isActive" AND role IN ('ADMIN','TEAM')) INTO valid;
        END IF;
        IF NOT valid THEN RAISE EXCEPTION 'Related record is unavailable'; END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION workspace_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_archived timestamp; prior_values jsonb; full_validation boolean;
BEGIN
  full_validation := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW."organizationId", NEW."collectionId", NEW."authorId") IS DISTINCT FROM (OLD.id, OLD."organizationId", OLD."collectionId", OLD."authorId") THEN RAISE EXCEPTION 'Record identity cannot change'; END IF;
    NEW.revision := OLD.revision + 1; prior_values := OLD.values;
    full_validation := OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NULL;
    IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NOT NULL AND (NEW.title, NEW.values) IS DISTINCT FROM (OLD.title, OLD.values) THEN RAISE EXCEPTION 'Restore record before editing'; END IF;
  ELSE NEW.revision := 0;
  END IF;
  IF length(btrim(NEW.title)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Enter a record title'; END IF;
  SELECT "archivedAt" INTO parent_archived FROM workspace_collections WHERE id = NEW."collectionId" AND "organizationId" = NEW."organizationId";
  IF parent_archived IS NOT NULL AND NOT (TG_OP = 'UPDATE' AND NEW."archivedAt" IS NOT NULL AND (NEW.title, NEW.values) IS NOT DISTINCT FROM (OLD.title, OLD.values)) THEN RAISE EXCEPTION 'Collection is archived'; END IF;
  PERFORM workspace_record_values_guard(NEW."collectionId", NEW."organizationId", NEW.values, prior_values, full_validation);
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_record_guard BEFORE INSERT OR UPDATE ON workspace_records FOR EACH ROW EXECUTE FUNCTION workspace_record_guard();

CREATE FUNCTION workspace_record_form_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent workspace_collections%ROWTYPE; item jsonb; f jsonb; defaults jsonb := '{}'::jsonb; validate_configuration boolean;
BEGIN
  SELECT * INTO parent FROM workspace_collections WHERE id = NEW."collectionId" AND "organizationId" = NEW."organizationId";
  validate_configuration := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW."organizationId", NEW."collectionId", NEW."authorId") IS DISTINCT FROM (OLD.id, OLD."organizationId", OLD."collectionId", OLD."authorId") THEN RAISE EXCEPTION 'Form identity cannot change'; END IF;
    NEW.revision := OLD.revision + 1; validate_configuration := NEW.configuration IS DISTINCT FROM OLD.configuration;
    IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NOT NULL AND validate_configuration THEN RAISE EXCEPTION 'Restore form before editing'; END IF;
  ELSE NEW.revision := 0;
  END IF;
  IF parent."archivedAt" IS NOT NULL AND NOT (TG_OP = 'UPDATE' AND NEW."archivedAt" IS NOT NULL AND NOT validate_configuration) THEN RAISE EXCEPTION 'Collection is archived'; END IF;
  IF validate_configuration THEN
    IF jsonb_typeof(NEW.configuration) IS DISTINCT FROM 'object' OR NEW.configuration->>'definitionRevision' IS DISTINCT FROM parent."schemaRevision"::text OR COALESCE(length(btrim(NEW.configuration->>'name')),0) NOT BETWEEN 1 AND 80 OR jsonb_typeof(NEW.configuration->'fields') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Review form against current collection fields'; END IF;
    IF jsonb_array_length(NEW.configuration->'fields') NOT BETWEEN 1 AND 40 OR (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(NEW.configuration->'fields')) <> jsonb_array_length(NEW.configuration->'fields') THEN RAISE EXCEPTION 'Choose unique form fields'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.configuration->'fields') LOOP
      SELECT value INTO f FROM jsonb_array_elements(parent.fields) WHERE value->>'key' = item->>'key';
      IF f IS NULL OR f->>'type' IN ('FORMULA','ROLLUP') OR COALESCE(f->>'archived','false') = 'true' OR jsonb_typeof(item->'required') IS DISTINCT FROM 'boolean' OR (f->>'required' = 'true' AND item->>'required' <> 'true') THEN RAISE EXCEPTION 'Invalid form field'; END IF;
      IF item ? 'defaultValue' THEN defaults := defaults || jsonb_build_object(item->>'key',item->'defaultValue'); END IF;
    END LOOP;
    FOR f IN SELECT value FROM jsonb_array_elements(parent.fields) WHERE value->>'required' = 'true' AND COALESCE(value->>'archived','false') <> 'true' LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.configuration->'fields') WHERE value->>'key' = f->>'key' AND value->>'required' = 'true') THEN RAISE EXCEPTION 'Form must include required fields'; END IF;
    END LOOP;
    PERFORM workspace_record_values_guard(NEW."collectionId", NEW."organizationId", defaults, NULL, true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_record_form_guard BEFORE INSERT OR UPDATE ON workspace_record_forms FOR EACH ROW EXECUTE FUNCTION workspace_record_form_guard();
