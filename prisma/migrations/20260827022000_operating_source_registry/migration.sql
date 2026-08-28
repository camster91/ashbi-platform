CREATE TABLE "operating_source_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "destinationId" TEXT,
    "outcome" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "decisionCandidateId" TEXT,
    "decisionFingerprint" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operating_source_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operating_source_records_sourceSystem_check" CHECK ("sourceSystem" IN ('NOTION', 'BONSAI')),
    CONSTRAINT "operating_source_records_entityType_check" CHECK ("entityType" IN ('PROJECT', 'TASK')),
    CONSTRAINT "operating_source_records_outcome_check" CHECK ("outcome" IN ('IMPORTED', 'LINKED', 'RETAINED_SOURCE', 'EXCLUDED', 'REPAIR_REQUIRED')),
    CONSTRAINT "operating_source_records_sourceFingerprint_check" CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "operating_source_records_decisionFingerprint_check" CHECK ("decisionFingerprint" IS NULL OR "decisionFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "operating_source_records_organizationId_sourceSystem_entity_key"
ON "operating_source_records"("organizationId", "sourceSystem", "entityType", "sourceId");

CREATE INDEX "operating_source_records_organizationId_entityType_destinat_idx"
ON "operating_source_records"("organizationId", "entityType", "destinationId");

CREATE INDEX "operating_source_records_organizationId_outcome_idx"
ON "operating_source_records"("organizationId", "outcome");

ALTER TABLE "operating_source_records"
ADD CONSTRAINT "operating_source_records_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
