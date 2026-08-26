ALTER TABLE "invoices" ADD COLUMN "creationRequestId" TEXT;

CREATE UNIQUE INDEX "invoices_creationRequestId_key" ON "invoices"("creationRequestId");
