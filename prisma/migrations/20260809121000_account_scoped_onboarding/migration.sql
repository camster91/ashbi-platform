CREATE TABLE "onboarding_progress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleSnapshot" TEXT NOT NULL,
    "skippedTaskIds" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_progress_userId_key" ON "onboarding_progress"("userId");
CREATE INDEX "onboarding_progress_organizationId_userId_idx" ON "onboarding_progress"("organizationId", "userId");

ALTER TABLE "onboarding_progress"
  ADD CONSTRAINT "onboarding_progress_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "onboarding_progress"
  ADD CONSTRAINT "onboarding_progress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_onboarding_progress_tenant()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "users"
    WHERE "id" = NEW."userId"
      AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'onboarding progress user must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onboarding_progress_tenant_guard
BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "onboarding_progress"
FOR EACH ROW EXECUTE FUNCTION enforce_onboarding_progress_tenant();
