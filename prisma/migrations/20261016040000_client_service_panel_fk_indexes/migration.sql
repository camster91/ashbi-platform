-- Leading FK indexes keep client deletion and mapping integrity checks bounded.
-- Additive only: existing saved report rows and provider metadata are unchanged.
CREATE INDEX "client_service_projects_clientId_organizationId_idx"
  ON "client_service_projects"("clientId", "organizationId");
CREATE INDEX "client_service_reports_clientId_organizationId_idx"
  ON "client_service_reports"("clientId", "organizationId");
CREATE INDEX "client_service_reports_mappingId_organizationId_clientId_idx"
  ON "client_service_reports"("mappingId", "organizationId", "clientId");
