-- Align the database with prisma/schema.prisma where the migration chain had
-- drifted from it (found by `prisma migrate diff` against a freshly migrated
-- database).

-- ChatMessage.author is optional in the schema, so deleting a user should
-- keep their messages and clear the author, not block the delete. The
-- baseline created this foreign key with ON DELETE RESTRICT.
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_authorId_fkey";
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
