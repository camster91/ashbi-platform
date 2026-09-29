-- Media review markup (docs/media-review.md "Markup", "Client portal
-- reviews" and "Web page review"): drawn shapes on annotations, client
-- portal authors, and the source of a captured web page.
--
-- Additive only: five nullable columns, two booleans with a constant default
-- (a catalog-only change since PostgreSQL 11) and CHECK constraints.
--
-- Client portal visibility is opt-in: every existing session gets
-- "sharedWithClient" = false (the column default), so no review that existed
-- before this migration appears in a client's portal until staff share it.
-- Share links are unaffected (they are already an explicit share). The two
-- author/actor CHECK constraints are replaced by supersets that also accept
-- the new `client` author type; every existing row satisfies both the old and
-- the new form. Rolling back the application image is safe: older code never
-- reads the new columns, and never writes the `client` author type.
--
-- Atomicity: Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT makes the columns and their constraints
-- all-or-nothing (in particular, the author constraint is never dropped
-- without its replacement). ADD COLUMN of a nullable column without a default
-- is a catalog-only change; the ADD CONSTRAINT checks scan the (small)
-- review tables under the ACCESS EXCLUSIVE lock, and lock_timeout bounds the
-- wait for that lock so a long-running reader fails the deploy instead of
-- queueing every request behind it.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "review_annotations" ADD COLUMN "shape" TEXT,
ADD COLUMN "points" JSONB,
ADD COLUMN "color" TEXT;

-- AlterTable
ALTER TABLE "review_sessions" ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "captureViewport" TEXT,
ADD COLUMN "sharedWithClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "clientCanDecide" BOOLEAN NOT NULL DEFAULT false;

-- Shapes: pin (a point region), rect (an area region), arrow (two points)
-- and pen (a freehand stroke of 2..500 points). Points are [x, y] pairs in
-- the unit square; arrows and strokes also store their bounding box in the
-- region columns, so every shape has a region.
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_shape_check"
  CHECK ("shape" IS NULL OR "shape" IN ('pin', 'rect', 'arrow', 'pen'));
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_shape_region_check"
  CHECK ("shape" IS NULL OR "regionX" IS NOT NULL);
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_shape_size_check"
  CHECK (
    ("shape" IS DISTINCT FROM 'pin' OR ("regionW" = 0 AND "regionH" = 0))
    AND ("shape" IS DISTINCT FROM 'rect' OR ("regionW" > 0 AND "regionH" > 0))
  );
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_shape_points_check"
  CHECK (
    ("points" IS NULL) = ("shape" IS NULL OR "shape" NOT IN ('arrow', 'pen'))
    AND ("shape" IS DISTINCT FROM 'arrow' OR (CASE WHEN jsonb_typeof("points") = 'array' THEN jsonb_array_length("points") = 2 ELSE false END))
  );
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_points_check"
  CHECK (
    "points" IS NULL OR (
      -- CASE: jsonb_array_length raises on a non-array, and AND does not
      -- guarantee evaluation order.
      CASE WHEN jsonb_typeof("points") = 'array' THEN (
        jsonb_array_length("points") BETWEEN 2 AND 500
        AND NOT jsonb_path_exists("points", 'strict $[*] ? (@.type() != "array")')
        AND NOT jsonb_path_exists("points", 'strict $[*] ? (@.type() == "array" && @.size() != 2)')
        AND NOT jsonb_path_exists("points", 'strict $[*][*] ? (@.type() != "number")')
        AND NOT jsonb_path_exists("points", 'strict $[*][*] ? (@.type() == "number" && (@ < 0 || @ > 1))')
      ) ELSE false END
    )
  );
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_color_check"
  CHECK ("color" IS NULL OR ("shape" IS NOT NULL AND "color" IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')));

-- Client portal authors: a signed-in client user (authorUserId is the
-- CLIENT user) who is neither staff nor a share-link guest.
ALTER TABLE "review_annotations" DROP CONSTRAINT "review_annotations_author_check";
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_author_check"
  CHECK (
    ("authorType" = 'staff' AND "authorUserId" IS NOT NULL AND "shareLinkId" IS NULL AND "authorEmail" IS NULL)
    OR ("authorType" = 'guest' AND "authorUserId" IS NULL)
    OR ("authorType" = 'client' AND "authorUserId" IS NOT NULL AND "shareLinkId" IS NULL)
  );
ALTER TABLE "review_decisions" DROP CONSTRAINT "review_decisions_actor_check";
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_actor_check"
  CHECK (
    ("actorType" = 'staff' AND "actorUserId" IS NOT NULL AND "shareLinkId" IS NULL AND "actorEmail" IS NULL)
    OR ("actorType" = 'guest' AND "actorUserId" IS NULL AND "shareLinkId" IS NOT NULL)
    OR ("actorType" = 'client' AND "actorUserId" IS NOT NULL AND "shareLinkId" IS NULL)
  );

-- Client portal decisions are only possible on a review shared with the
-- client.
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_client_decide_check"
  CHECK ("clientCanDecide" = false OR "sharedWithClient" = true);

-- Web page review: the captured URL and viewport, set together.
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_source_url_check"
  CHECK ("sourceUrl" IS NULL OR (length("sourceUrl") <= 2048 AND "sourceUrl" ~ '^https?://'));
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_capture_viewport_check"
  CHECK (
    ("captureViewport" IS NULL OR "captureViewport" IN ('desktop', 'mobile'))
    AND (("sourceUrl" IS NULL) = ("captureViewport" IS NULL))
  );

COMMIT;
