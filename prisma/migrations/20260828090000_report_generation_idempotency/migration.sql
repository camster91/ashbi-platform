ALTER TABLE "reports" ADD COLUMN "requestId" TEXT;

CREATE UNIQUE INDEX "reports_requestId_key" ON "reports"("requestId");
