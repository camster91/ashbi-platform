CREATE UNIQUE INDEX "clients_id_organizationId_key" ON "clients"("id", "organizationId");
CREATE TABLE "client_service_projects" (
 "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
 "provider" TEXT NOT NULL DEFAULT 'OPENSEO' CHECK ("provider" = 'OPENSEO'),
 "providerProjectId" TEXT NOT NULL CHECK (length("providerProjectId") BETWEEN 1 AND 100),
 "displayLabel" TEXT NOT NULL CHECK (length("displayLabel") BETWEEN 1 AND 100),
 "enabled" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "lastAttemptAt" TIMESTAMP(3), "lastSuccessAt" TIMESTAMP(3), "lastOutcome" TEXT,
 "failureCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "service_project_outcome_check" CHECK ("lastOutcome" IS NULL OR "lastOutcome" IN ('OK','EMPTY','UNAVAILABLE')),
 CONSTRAINT "service_project_failure_check" CHECK (("lastOutcome" IS NOT NULL AND "lastOutcome" = 'UNAVAILABLE' AND "failureCode" IS NOT NULL AND "failureCode" IN ('PROVIDER_UNAVAILABLE','AUTH_REQUIRED','REPORT_UNAVAILABLE')) OR ("lastOutcome" IS DISTINCT FROM 'UNAVAILABLE' AND "failureCode" IS NULL)),
 CONSTRAINT "client_service_projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "client_service_projects_clientId_organizationId_fkey" FOREIGN KEY ("clientId","organizationId") REFERENCES "clients"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "service_project_provider_key" ON "client_service_projects"("organizationId","clientId","provider","providerProjectId");
CREATE UNIQUE INDEX "client_service_projects_id_organizationId_clientId_key" ON "client_service_projects"("id","organizationId","clientId");
CREATE INDEX "client_service_projects_organizationId_clientId_enabled_idx" ON "client_service_projects"("organizationId","clientId","enabled");
CREATE TABLE "client_service_reports" (
 "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "mappingId" TEXT NOT NULL,
 "providerReportId" TEXT NOT NULL CHECK (length("providerReportId") BETWEEN 1 AND 100),
 "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 200), "summary" TEXT NOT NULL CHECK (length("summary") BETWEEN 1 AND 4000),
 "sourceReportedAt" TIMESTAMP(3), "hubStoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "client_service_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "client_service_reports_clientId_organizationId_fkey" FOREIGN KEY ("clientId","organizationId") REFERENCES "clients"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "client_service_reports_mappingId_organizationId_clientId_fkey" FOREIGN KEY ("mappingId","organizationId","clientId") REFERENCES "client_service_projects"("id","organizationId","clientId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "client_service_reports_mappingId_providerReportId_key" ON "client_service_reports"("mappingId","providerReportId");
CREATE INDEX "client_service_reports_organizationId_clientId_hubStoredAt_idx" ON "client_service_reports"("organizationId","clientId","hubStoredAt");
