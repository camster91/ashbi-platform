ALTER TABLE "migration_review_packets"
ADD COLUMN "evidenceFingerprint" TEXT;

UPDATE "migration_review_packets"
SET "evidenceFingerprint" = "sourceReviewSha256" || ':' || "mappingDecisionSha256" || ':' || COALESCE("supplementalSha256", '-');

ALTER TABLE "migration_review_packets"
ALTER COLUMN "evidenceFingerprint" SET NOT NULL;

ALTER TABLE "migration_review_packets"
DROP CONSTRAINT "migration_review_packets_kind_check";

ALTER TABLE "migration_review_packets"
ADD CONSTRAINT "migration_review_packets_kind_check"
CHECK ("kind" IN (
  'NOTION_BONSAI_PROJECT_LINK',
  'NOTION_BONSAI_TASK_DISPOSITION',
  'NOTION_BONSAI_PROJECT_DISPOSITION'
));

ALTER TABLE "migration_review_packets"
ADD CONSTRAINT "migration_review_packets_evidenceFingerprint_check"
CHECK ("evidenceFingerprint" ~ '^[0-9a-f]{64}:[0-9a-f]{64}:(-|[0-9a-f]{64})$');

DROP INDEX "migration_review_packets_organizationId_kind_sourceReviewSha256_key";

CREATE UNIQUE INDEX "migration_review_packets_organizationId_kind_evidenceFinger_key"
ON "migration_review_packets"("organizationId", "kind", "evidenceFingerprint");

CREATE INDEX "migration_review_packets_organizationId_kind_sourceReviewSh_idx"
ON "migration_review_packets"("organizationId", "kind", "sourceReviewSha256");
