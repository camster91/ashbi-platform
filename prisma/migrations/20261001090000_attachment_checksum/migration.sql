-- Upload checksums (#417, docs/media-review.md "Upload checksums"): a
-- nullable lowercase hex SHA-256 of each newly stored attachment, computed
-- from the in-memory bytes while the file is written. Review asset versions
-- are attachments, so the review evidence export carries it too.
--
-- Additive only: one nullable column and a CHECK on its format. Existing rows
-- stay NULL (their files are not re-read), and older application images never
-- read the column, so rolling back the image is safe.
--
-- Atomicity: Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT keeps the column and its constraint together.
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "attachments" ADD COLUMN "checksumSha256" TEXT;

-- NOT VALID skips a scan of existing rows (all NULL); new writes are checked.
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_checksum_sha256_format_check"
  CHECK ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$') NOT VALID;

COMMIT;
