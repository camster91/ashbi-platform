-- Existing work remains unclassified. Classification does not change access.
ALTER TABLE "projects" ADD COLUMN "portfolio" TEXT;
ALTER TABLE "projects" ADD CONSTRAINT "projects_portfolio_check"
  CHECK ("portfolio" IS NULL OR "portfolio" IN ('ASHBI_DESIGN', 'FREELANCE'));
CREATE INDEX "projects_organizationId_portfolio_idx" ON "projects"("organizationId", "portfolio");
