CREATE TABLE "monitoring_incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'UPTIME_KUMA',
    "externalEventId" TEXT NOT NULL,
    "monitorName" TEXT NOT NULL,
    "monitorUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "pingMs" INTEGER,
    "emittedAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "triageStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "triageReason" TEXT,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiSeverity" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiSummary" TEXT,
    "recommendedAction" TEXT,
    "humanActionRequired" BOOLEAN NOT NULL DEFAULT true,
    "aiTriage" JSONB,
    "triagedAt" TIMESTAMP(3),
    "notificationDisposition" TEXT NOT NULL DEFAULT 'SHADOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitoring_incidents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "monitoring_incidents_externalEventId_key" ON "monitoring_incidents"("externalEventId");
CREATE INDEX "monitoring_incidents_organizationId_createdAt_idx" ON "monitoring_incidents"("organizationId", "createdAt" DESC);
CREATE INDEX "monitoring_incidents_siteId_createdAt_idx" ON "monitoring_incidents"("siteId", "createdAt" DESC);
CREATE INDEX "monitoring_incidents_monitorUrl_createdAt_idx" ON "monitoring_incidents"("monitorUrl", "createdAt" DESC);
CREATE INDEX "monitoring_incidents_status_createdAt_idx" ON "monitoring_incidents"("status", "createdAt" DESC);

ALTER TABLE "monitoring_incidents" ADD CONSTRAINT "monitoring_incidents_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "monitoring_incidents" ADD CONSTRAINT "monitoring_incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
