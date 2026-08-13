-- External collaboration messages are clearly marked and are not assigned to
-- an Ashbi user account. Existing authored chat messages remain unchanged.
ALTER TABLE "chat_messages" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "externalAuthorName" TEXT;
ALTER TABLE "chat_messages" ALTER COLUMN "authorId" DROP NOT NULL;
