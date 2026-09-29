-- New invoices default to CAD (the currency the UI, PDFs and emails have
-- always shown) instead of USD. Metadata-only change (no table rewrite, no
-- lock beyond a brief ACCESS EXCLUSIVE for the catalog update). Existing rows
-- are NOT rewritten (owner decision); scripts/backfill-invoice-currency.mjs
-- reports suspect rows and applies owner-approved corrections.
ALTER TABLE "invoices" ALTER COLUMN "currency" SET DEFAULT 'CAD';
