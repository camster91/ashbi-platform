ALTER TABLE "notes"
 ADD COLUMN "accessMode" TEXT NOT NULL DEFAULT 'TEAM',
 ADD COLUMN "accessRevision" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "accessGrants" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "audienceBarrier" JSONB;

CREATE FUNCTION note_audience_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_org TEXT; grant_row JSONB; barrier_key TEXT; person JSONB;
BEGIN
 SELECT p."organizationId" INTO owner_org FROM "projects" p WHERE p.id = NEW."projectId";
 IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW."authorId" IS DISTINCT FROM OLD."authorId") THEN
   RAISE EXCEPTION 'note identity and ownership are immutable';
 END IF;
 IF owner_org IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."authorId" AND "organizationId" = owner_org) THEN
   RAISE EXCEPTION 'note author must belong to the project organization';
 END IF;
 IF NEW."accessMode" NOT IN ('TEAM', 'RESTRICTED') OR jsonb_typeof(NEW."accessGrants") <> 'array' OR jsonb_array_length(NEW."accessGrants") > 100 THEN
   RAISE EXCEPTION 'invalid note audience';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW."accessGrants")) <> (SELECT count(DISTINCT item->>'userId') FROM jsonb_array_elements(NEW."accessGrants") item) THEN
   RAISE EXCEPTION 'note grants must be unique';
 END IF;
 FOR grant_row IN SELECT * FROM jsonb_array_elements(NEW."accessGrants") LOOP
   IF jsonb_typeof(grant_row) <> 'object' OR NOT (grant_row ?& ARRAY['userId','role']) OR (grant_row - ARRAY['userId','role']) <> '{}'::jsonb OR jsonb_typeof(grant_row->'userId') <> 'string' OR jsonb_typeof(grant_row->'role') IS DISTINCT FROM 'string' OR grant_row->>'role' NOT IN ('READ','EDIT') OR grant_row->>'userId' = NEW."authorId" OR NOT EXISTS (SELECT 1 FROM users WHERE id = grant_row->>'userId' AND "organizationId" = owner_org) THEN
     RAISE EXCEPTION 'note grants must reference organization staff';
   END IF;
   IF (TG_OP = 'INSERT' OR NOT (OLD."accessGrants" @> jsonb_build_array(grant_row))) AND NOT EXISTS (SELECT 1 FROM users WHERE id = grant_row->>'userId' AND "organizationId" = owner_org AND "isActive" = true AND role IN ('ADMIN','TEAM')) THEN
     RAISE EXCEPTION 'new note grants must reference active staff';
   END IF;
 END LOOP;
 IF NEW."audienceBarrier" IS NOT NULL THEN
   IF jsonb_typeof(NEW."audienceBarrier") <> 'object' OR NOT (NEW."audienceBarrier" ?& ARRAY['readUserIds','editUserIds']) OR (NEW."audienceBarrier" - ARRAY['readUserIds','editUserIds']) <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid note inheritance barrier'; END IF;
   FOREACH barrier_key IN ARRAY ARRAY['readUserIds','editUserIds'] LOOP
     IF NEW."audienceBarrier"->barrier_key <> 'null'::jsonb THEN
       IF jsonb_typeof(NEW."audienceBarrier"->barrier_key) <> 'array' OR jsonb_array_length(NEW."audienceBarrier"->barrier_key) > 10000 THEN RAISE EXCEPTION 'invalid note inheritance barrier'; END IF;
       FOR person IN SELECT * FROM jsonb_array_elements(NEW."audienceBarrier"->barrier_key) LOOP
         IF jsonb_typeof(person) <> 'string' OR length(person #>> '{}') NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid note inheritance barrier identity'; END IF;
       END LOOP;
     END IF;
   END LOOP;
 END IF;
 IF TG_OP = 'UPDATE' THEN
   NEW."accessRevision" := OLD."accessRevision" + CASE WHEN (NEW."accessMode", NEW."accessGrants", NEW."audienceBarrier", NEW."parentId", NEW."deletedAt") IS DISTINCT FROM (OLD."accessMode", OLD."accessGrants", OLD."audienceBarrier", OLD."parentId", OLD."deletedAt") THEN 1 ELSE 0 END;
 ELSE
   NEW."accessRevision" := 0;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER note_audience_guard BEFORE INSERT OR UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION note_audience_guard();
-- Restoration is a hierarchy write even when parentId itself is unchanged.
-- A raw restore cannot bypass the active same-project-parent guard.
DROP TRIGGER "notes_parent_project_guard" ON "notes";
CREATE TRIGGER "notes_parent_project_guard"
BEFORE INSERT OR UPDATE OF "parentId", "projectId", "deletedAt" ON "notes"
FOR EACH ROW EXECUTE FUNCTION enforce_note_parent_project();
