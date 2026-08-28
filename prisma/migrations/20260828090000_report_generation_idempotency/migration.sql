ALTER TABLE "reports" ADD COLUMN "request_id" TEXT;

CREATE UNIQUE INDEX "reports_request_id_key" ON "reports"("request_id");
