BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX "credentials_id_org_client_key" ON "credentials"("id","organizationId","clientId");
ALTER TABLE "client_service_projects"
 ADD COLUMN "credentialId" TEXT,
 ADD COLUMN "refreshOutcome" TEXT,
 ADD COLUMN "refreshPartial" BOOLEAN,
 ADD COLUMN "providerTotalCount" INTEGER,
 ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
 ADD CONSTRAINT "service_project_credential_fkey" FOREIGN KEY ("credentialId","organizationId","clientId") REFERENCES "credentials"("id","organizationId","clientId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT "service_project_refresh_bounds" CHECK (("refreshOutcome" IS NULL OR "refreshOutcome" IN ('OK','EMPTY','UNAVAILABLE')) AND ("providerTotalCount" IS NULL OR "providerTotalCount">=0));
CREATE INDEX "service_project_credential_idx" ON "client_service_projects"("credentialId","organizationId","clientId");
ALTER TABLE "client_service_reports"
 ADD COLUMN "providerEditedAt" TIMESTAMP(3),
 ADD COLUMN "provenance" TEXT NOT NULL DEFAULT 'ADMIN_PUBLISHED_SNAPSHOT',
 ADD CONSTRAINT "service_report_provenance_bounds" CHECK ("provenance" IN ('ADMIN_PUBLISHED_SNAPSHOT','OPENSEO_SAVED_REPORT_PULL'));
COMMIT;
