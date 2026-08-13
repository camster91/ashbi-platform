-- Provider identifiers support durable Slack-to-Ashbi reply threading and
-- reconciliation without querying or relying on opaque metadata JSON.
ALTER TABLE "chat_messages" ADD COLUMN "externalMessageId" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "externalThreadId" TEXT;

CREATE INDEX "chat_messages_projectId_externalSource_externalMessageId_idx"
  ON "chat_messages"("projectId", "externalSource", "externalMessageId");
CREATE INDEX "chat_messages_projectId_externalSource_externalThreadId_idx"
  ON "chat_messages"("projectId", "externalSource", "externalThreadId");
