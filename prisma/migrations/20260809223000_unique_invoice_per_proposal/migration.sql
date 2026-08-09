-- One approved proposal must not create more than one invoice. PostgreSQL will
-- reject this migration without deleting data if historical duplicates exist.
CREATE UNIQUE INDEX "invoices_proposalId_key" ON "invoices"("proposalId");
