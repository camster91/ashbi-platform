-- Tenant-owned public inquiry records with durable consent, attribution, and idempotency evidence.
CREATE TABLE "leads" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountOwnerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "company" TEXT,
  "phone" TEXT,
  "serviceLine" TEXT NOT NULL,
  "businessContext" TEXT NOT NULL,
  "requestedOutcome" TEXT NOT NULL,
  "timing" TEXT,
  "budgetBand" TEXT,
  "budgetCurrency" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "qualificationNotes" TEXT,
  "qualifiedAt" TIMESTAMP(3),
  "convertedClientId" TEXT,
  "convertedAt" TIMESTAMP(3),
  "source" TEXT,
  "medium" TEXT,
  "campaign" TEXT,
  "landingPage" TEXT NOT NULL,
  "referrer" TEXT,
  "clickId" TEXT,
  "consentVersion" TEXT NOT NULL,
  "consentAt" TIMESTAMP(3) NOT NULL,
  "intakeIdempotencyKey" TEXT NOT NULL,
  "intakePayloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "properties" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leads_organizationId_intakeIdempotencyKey_key" ON "leads"("organizationId", "intakeIdempotencyKey");
CREATE INDEX "leads_organizationId_status_createdAt_idx" ON "leads"("organizationId", "status", "createdAt");
CREATE INDEX "leads_organizationId_email_idx" ON "leads"("organizationId", "email");
CREATE INDEX "leads_accountOwnerId_status_idx" ON "leads"("accountOwnerId", "status");
CREATE INDEX "leads_convertedClientId_idx" ON "leads"("convertedClientId");
CREATE INDEX "lead_events_organizationId_eventName_occurredAt_idx" ON "lead_events"("organizationId", "eventName", "occurredAt");
CREATE INDEX "lead_events_leadId_occurredAt_idx" ON "lead_events"("leadId", "occurredAt");

ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_accountOwnerId_fkey" FOREIGN KEY ("accountOwnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
