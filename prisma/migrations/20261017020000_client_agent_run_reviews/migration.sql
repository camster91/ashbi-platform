BEGIN;

-- Additive sidecar: old application builds ignore it; terminal run guards and
-- all established confidentiality-floor migrations remain untouched.
CREATE TABLE "client_agent_run_reviews" (
  "runId" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_agent_run_reviews_run_scope_fkey" FOREIGN KEY ("runId", "organizationId")
    REFERENCES "client_agent_runs"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_agent_run_reviews_organization_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "client_agent_run_reviews_organizationId_idx" ON "client_agent_run_reviews"("organizationId");
CREATE UNIQUE INDEX "client_agent_run_reviews_runId_organizationId_key" ON "client_agent_run_reviews"("runId", "organizationId");

CREATE FUNCTION client_agent_run_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Run attention review is immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM client_agent_runs r
    WHERE r.id=NEW."runId" AND r."organizationId"=NEW."organizationId" AND r.status IN ('FAILED','UNKNOWN')) THEN
    RAISE EXCEPTION 'Only failed or uncertain runs have reviewable attention';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_agent_run_review_guard BEFORE INSERT OR UPDATE ON "client_agent_run_reviews"
  FOR EACH ROW EXECUTE FUNCTION client_agent_run_review_guard();

COMMIT;
