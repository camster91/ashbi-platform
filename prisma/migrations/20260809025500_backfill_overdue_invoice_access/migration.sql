UPDATE "invoices"
SET "publicAccessExpiresAt" = NOW() + INTERVAL '30 days'
WHERE status = 'OVERDUE'
  AND "publicAccessExpiresAt" IS NULL
  AND "publicAccessRevokedAt" IS NULL;
