-- External collaboration messages are clearly marked and are not assigned to
-- an Ashbi user account. Existing authored chat messages remain unchanged.
ALTER TABLE "chat_messages" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "externalAuthorName" TEXT;
ALTER TABLE "chat_messages" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_authorId_fkey";
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
