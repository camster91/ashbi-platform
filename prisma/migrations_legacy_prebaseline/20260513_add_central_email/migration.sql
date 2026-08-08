-- Create sent_emails table
CREATE TABLE IF NOT EXISTS "sent_emails" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "to_name" TEXT,
    "subject" TEXT NOT NULL,
    "mailgun_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sent_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sent_emails_entity_idx" ON "sent_emails"("entity_type", "entity_id");
