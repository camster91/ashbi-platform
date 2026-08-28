CREATE TABLE "migration_review_packets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "importRequestId" TEXT NOT NULL,
    "sourceReviewSha256" TEXT NOT NULL,
    "mappingDecisionSha256" TEXT NOT NULL,
    "supplementalSha256" TEXT,
    "sourcePreparedAt" TIMESTAMP(3) NOT NULL,
    "sourceReview" JSONB NOT NULL,
    "mappingDecision" JSONB NOT NULL,
    "supplementalEvidence" JSONB,
    "reviewBrief" JSONB NOT NULL,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_review_packets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "migration_review_packets_kind_check" CHECK ("kind" IN ('NOTION_BONSAI_PROJECT_LINK')),
    CONSTRAINT "migration_review_packets_sourceReviewSha256_check" CHECK ("sourceReviewSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "migration_review_packets_mappingDecisionSha256_check" CHECK ("mappingDecisionSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "migration_review_packets_supplementalSha256_check" CHECK ("supplementalSha256" IS NULL OR "supplementalSha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "migration_review_decisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewNote" TEXT,
    "reviewedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_review_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "migration_review_decisions_decision_check" CHECK ("decision" IN ('APPROVED', 'REJECTED'))
);

CREATE UNIQUE INDEX "migration_review_packets_organizationId_importRequestId_key"
ON "migration_review_packets"("organizationId", "importRequestId");
CREATE UNIQUE INDEX "migration_review_packets_organizationId_kind_sourceReviewSha256_key"
ON "migration_review_packets"("organizationId", "kind", "sourceReviewSha256");
CREATE INDEX "migration_review_packets_organizationId_createdAt_idx"
ON "migration_review_packets"("organizationId", "createdAt");
CREATE UNIQUE INDEX "migration_review_decisions_organizationId_requestId_key"
ON "migration_review_decisions"("organizationId", "requestId");
CREATE INDEX "migration_review_decisions_organizationId_packetId_candidateId_decidedAt_idx"
ON "migration_review_decisions"("organizationId", "packetId", "candidateId", "decidedAt");

ALTER TABLE "migration_review_packets"
ADD CONSTRAINT "migration_review_packets_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "migration_review_decisions"
ADD CONSTRAINT "migration_review_decisions_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "migration_review_decisions"
ADD CONSTRAINT "migration_review_decisions_packetId_fkey"
FOREIGN KEY ("packetId") REFERENCES "migration_review_packets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
