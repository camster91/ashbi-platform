-- Add the project-wiki hierarchy, reusable-template marker, and authorized mentions.
ALTER TABLE "notes"
  ADD COLUMN "mentions" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "parentId" TEXT;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "notes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notes_projectId_parentId_idx" ON "notes"("projectId", "parentId");
CREATE INDEX "notes_projectId_isTemplate_idx" ON "notes"("projectId", "isTemplate");

-- A parent must belong to the same project. Prisma cannot express this
-- composite self-reference, so the database enforces it with a database-level
-- trigger in addition to route-level cycle checks.
CREATE OR REPLACE FUNCTION enforce_note_parent_project()
RETURNS trigger AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "notes" parent
    WHERE parent."id" = NEW."parentId"
      AND parent."projectId" = NEW."projectId"
      AND parent."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'note parent must be an active note in the same project';
  END IF;
  IF NEW."parentId" IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT parent."id", parent."parentId"
      FROM "notes" parent
      WHERE parent."id" = NEW."parentId"
      UNION
      SELECT parent."id", parent."parentId"
      FROM "notes" parent
      INNER JOIN ancestors child ON parent."id" = child."parentId"
    )
    SELECT 1 FROM ancestors WHERE "id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'note hierarchy cannot contain a cycle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notes_parent_project_guard"
BEFORE INSERT OR UPDATE OF "parentId", "projectId" ON "notes"
FOR EACH ROW EXECUTE FUNCTION enforce_note_parent_project();
