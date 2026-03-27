-- Invoice Module Migration
-- Adds enhanced fields to invoices, invoice_payments, invoice_line_items, and line_item_templates

-- ─── Enhance invoices table ────────────────────────────────────────────────

-- Add new fields to invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 13;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "taxType" TEXT NOT NULL DEFAULT 'HST';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paymentNotes" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "isRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "recurringInterval" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "recurringNextDate" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- Add projectId FK
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS "invoices_status_dueDate_idx" ON "invoices"("status", "dueDate");
CREATE INDEX IF NOT EXISTS "invoices_clientId_status_idx" ON "invoices"("clientId", "status");

-- ─── Enhance invoice_line_items table ──────────────────────────────────────

ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "itemType" TEXT NOT NULL DEFAULT 'LABOR';
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

-- ─── Create invoice_payments table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "invoice_payments" (
    "id"            TEXT NOT NULL,
    "amount"        DOUBLE PRECISION NOT NULL,
    "method"        TEXT NOT NULL DEFAULT 'BANK',
    "notes"         TEXT,
    "transactionId" TEXT,
    "paidAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId"     TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Create line_item_templates table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "line_item_templates" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemType"    TEXT NOT NULL DEFAULT 'LABOR',
    "unitPrice"   DOUBLE PRECISION NOT NULL,
    "unit"        TEXT NOT NULL DEFAULT 'hr',
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_item_templates_pkey" PRIMARY KEY ("id")
);

-- ─── Seed default line item templates ──────────────────────────────────────

INSERT INTO "line_item_templates" ("id", "name", "description", "itemType", "unitPrice", "unit")
SELECT
    'tmpl-' || substr(md5(random()::text), 0, 16),
    t.name, t.description, t.itemType, t.unitPrice, t.unit
FROM (VALUES
    ('Brand Strategy', 'Brand strategy consulting and planning', 'LABOR', 150.00, 'hr'),
    ('Design Work', 'UI/UX design and visual assets', 'LABOR', 120.00, 'hr'),
    ('Web Development', 'Frontend/backend development', 'LABOR', 130.00, 'hr'),
    ('Project Management', 'Project coordination and communication', 'LABOR', 100.00, 'hr'),
    ('Copywriting', 'Brand and marketing copy', 'LABOR', 90.00, 'hr'),
    ('Monthly Retainer — Starter', 'Monthly brand management — Starter tier', 'LABOR', 999.00, 'flat'),
    ('Monthly Retainer — Growth', 'Monthly brand management — Growth tier', 'LABOR', 1999.00, 'flat'),
    ('Monthly Retainer — Scale', 'Monthly brand management — Scale tier', 'LABOR', 3999.00, 'flat'),
    ('Stock Photos / Assets', 'Licensed stock imagery and assets', 'MATERIALS', 150.00, 'flat'),
    ('Printing / Production', 'Print materials and production costs', 'MATERIALS', 0.00, 'flat')
) AS t(name, description, itemType, unitPrice, unit)
WHERE NOT EXISTS (SELECT 1 FROM "line_item_templates" WHERE "name" = t.name);
