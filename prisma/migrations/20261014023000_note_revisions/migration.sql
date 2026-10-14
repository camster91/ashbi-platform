ALTER TABLE "notes" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- Advance on every write path, including hierarchy promotion and trash restore.
-- Clients submit the observed revision in a conditional update; they cannot
-- reset it or silently rebase a stale draft by choosing their own next number.
CREATE FUNCTION note_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER note_revision_guard BEFORE UPDATE ON "notes"
FOR EACH ROW EXECUTE FUNCTION note_revision_guard();
