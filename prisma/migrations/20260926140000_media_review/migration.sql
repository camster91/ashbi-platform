-- Media review slice 1 (#417, docs/media-review.md): review sessions over
-- project attachments, positioned/timestamped annotations, append-only
-- approval decisions and expiring client share links.
--
-- Additive only: four new tables, their indexes, constraints and triggers.
-- No existing table or row is touched, so rolling back the application
-- image is safe (the old code never reads these tables).

-- CreateTable
CREATE TABLE "review_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousSessionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_annotations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorType" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT,
    "shareLinkId" TEXT,
    "body" TEXT NOT NULL,
    "timecodeMs" INTEGER,
    "regionX" DOUBLE PRECISION,
    "regionY" DOUBLE PRECISION,
    "regionW" DOUBLE PRECISION,
    "regionH" DOUBLE PRECISION,
    "pageNumber" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT,
    "shareLinkId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_share_links" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "allowDecision" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_sessions_previousSessionId_key" ON "review_sessions"("previousSessionId");

-- CreateIndex
CREATE INDEX "review_sessions_organizationId_projectId_createdAt_idx" ON "review_sessions"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "review_sessions_attachmentId_idx" ON "review_sessions"("attachmentId");

-- CreateIndex
CREATE INDEX "review_annotations_sessionId_createdAt_idx" ON "review_annotations"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "review_annotations_parentId_idx" ON "review_annotations"("parentId");

-- CreateIndex
CREATE INDEX "review_annotations_shareLinkId_idx" ON "review_annotations"("shareLinkId");

-- CreateIndex
CREATE INDEX "review_decisions_sessionId_createdAt_idx" ON "review_decisions"("sessionId", "createdAt");

-- CreateIndex
-- One decision per share link (staff decisions have a NULL shareLinkId,
-- and NULLs never collide in a unique index).
CREATE UNIQUE INDEX "review_decisions_shareLinkId_key" ON "review_decisions"("shareLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "review_share_links_tokenHash_key" ON "review_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "review_share_links_sessionId_createdAt_idx" ON "review_share_links"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: a file under review cannot be deleted, so approval evidence can
-- never disappear with it. The delete routes answer 409 ATTACHMENT_UNDER_REVIEW.
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_previousSessionId_fkey" FOREIGN KEY ("previousSessionId") REFERENCES "review_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "review_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "review_annotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "review_share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "review_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_share_links" ADD CONSTRAINT "review_share_links_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "review_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Closed vocabularies and bounds. Prisma does not model CHECK constraints;
-- they are enforced here only.
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_status_check"
  CHECK ("status" IN ('open', 'approved', 'changes_requested', 'closed'));
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_title_check"
  CHECK (length("title") BETWEEN 1 AND 200);
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_previous_check"
  CHECK ("previousSessionId" IS NULL OR "previousSessionId" <> "id");

-- An annotation's author is exactly one of: a staff user, or a named guest
-- who came in through a share link.
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_author_check"
  CHECK (
    ("authorType" = 'staff' AND "authorUserId" IS NOT NULL AND "shareLinkId" IS NULL AND "authorEmail" IS NULL)
    OR ("authorType" = 'guest' AND "authorUserId" IS NULL)
  );
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_author_name_check"
  CHECK (length("authorName") BETWEEN 1 AND 120);
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_author_email_check"
  CHECK ("authorEmail" IS NULL OR length("authorEmail") <= 254);
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_body_check"
  CHECK (length("body") BETWEEN 1 AND 5000);
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_timecode_check"
  CHECK ("timecodeMs" IS NULL OR "timecodeMs" BETWEEN 0 AND 86400000);
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_page_check"
  CHECK ("pageNumber" IS NULL OR "pageNumber" BETWEEN 1 AND 10000);
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_region_check"
  CHECK (
    ("regionX" IS NULL AND "regionY" IS NULL AND "regionW" IS NULL AND "regionH" IS NULL)
    OR (
      "regionX" IS NOT NULL AND "regionY" IS NOT NULL AND "regionW" IS NOT NULL AND "regionH" IS NOT NULL
      AND "regionX" BETWEEN 0 AND 1 AND "regionY" BETWEEN 0 AND 1
      AND "regionW" >= 0 AND "regionH" >= 0
      AND "regionX" + "regionW" <= 1 AND "regionY" + "regionH" <= 1
    )
  );
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_resolved_check"
  CHECK (("resolvedAt" IS NULL) = ("resolvedById" IS NULL));
ALTER TABLE "review_annotations" ADD CONSTRAINT "review_annotations_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_decision_check"
  CHECK ("decision" IN ('approved', 'changes_requested'));
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_actor_check"
  CHECK (
    ("actorType" = 'staff' AND "actorUserId" IS NOT NULL AND "shareLinkId" IS NULL AND "actorEmail" IS NULL)
    OR ("actorType" = 'guest' AND "actorUserId" IS NULL AND "shareLinkId" IS NOT NULL)
  );
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_actor_name_check"
  CHECK (length("actorName") BETWEEN 1 AND 120);
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_note_check"
  CHECK ("note" IS NULL OR length("note") <= 2000);

-- Share links: a SHA-256 hex token hash, and an expiry after creation and at
-- most 90 days out.
ALTER TABLE "review_share_links" ADD CONSTRAINT "review_share_links_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "review_share_links" ADD CONSTRAINT "review_share_links_expiry_check"
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '90 days');
ALTER TABLE "review_share_links" ADD CONSTRAINT "review_share_links_label_check"
  CHECK ("label" IS NULL OR length("label") <= 120);
ALTER TABLE "review_share_links" ADD CONSTRAINT "review_share_links_revoked_check"
  CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt");

-- Review decisions are append-only approval evidence, like audit_events: no
-- role with table write access can rewrite one. A decision row may be
-- deleted only by the cascade from deleting its session (project or
-- organization lifecycle; retention is decided in #310), which the trigger
-- recognises because the session row is already gone.
CREATE OR REPLACE FUNCTION deny_review_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "review_sessions" WHERE "id" = OLD."sessionId"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'review decisions are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER review_decisions_append_only
BEFORE UPDATE OR DELETE ON "review_decisions"
FOR EACH ROW EXECUTE FUNCTION deny_review_decision_mutation();

CREATE TRIGGER review_decisions_no_truncate
BEFORE TRUNCATE ON "review_decisions"
FOR EACH STATEMENT EXECUTE FUNCTION deny_review_decision_mutation();
