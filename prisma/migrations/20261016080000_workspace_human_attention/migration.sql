ALTER TABLE workspace_chat_messages ADD COLUMN "attentionRecipientIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "intentHash" TEXT;
CREATE UNIQUE INDEX "workspace_chat_messages_id_organizationId_key" ON workspace_chat_messages(id,"organizationId");
ALTER TABLE workspace_chat_messages ADD CONSTRAINT workspace_chat_attention_payload_bounds CHECK (
  cardinality("attentionRecipientIds") <= 29
  AND ("intentHash" IS NULL OR "intentHash" ~ '^[a-f0-9]{64}$')
  AND (cardinality("attentionRecipientIds") = 0 OR "intentHash" IS NOT NULL)
);
CREATE TABLE workspace_chat_attention (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("channelId","organizationId") REFERENCES workspace_chat_channels(id,"organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("messageId","organizationId") REFERENCES workspace_chat_messages(id,"organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("recipientId","organizationId") REFERENCES users(id,"organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("messageId","recipientId")
);
CREATE INDEX "workspace_chat_attention_organizationId_recipientId_acknowl_idx" ON workspace_chat_attention("organizationId","recipientId","acknowledgedAt",id);
CREATE INDEX "workspace_chat_attention_channelId_organizationId_idx" ON workspace_chat_attention("channelId","organizationId");
CREATE INDEX "workspace_chat_attention_messageId_organizationId_idx" ON workspace_chat_attention("messageId","organizationId");
CREATE INDEX "workspace_chat_attention_recipientId_organizationId_idx" ON workspace_chat_attention("recipientId","organizationId");

CREATE FUNCTION ashbi_workspace_attention_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW."attentionRecipientIds" IS DISTINCT FROM OLD."attentionRecipientIds" OR NEW."intentHash" IS DISTINCT FROM OLD."intentHash"
    OR (OLD."intentHash" IS NOT NULL AND (NEW.content IS DISTINCT FROM OLD.content OR NEW."clientKey" IS DISTINCT FROM OLD."clientKey"
      OR (NEW."parentId" IS DISTINCT FROM OLD."parentId" AND NOT (NEW."parentId" IS NULL AND OLD."parentId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_chat_messages WHERE id=OLD."parentId")))))) THEN
    RAISE EXCEPTION 'message intent is immutable' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(NEW."attentionRecipientIds") AS recipient WHERE recipient IS NULL OR char_length(btrim(recipient)) NOT BETWEEN 1 AND 100 OR recipient=NEW."authorId")
    OR cardinality(NEW."attentionRecipientIds")<>(SELECT count(DISTINCT recipient) FROM unnest(NEW."attentionRecipientIds") AS recipient) THEN
    RAISE EXCEPTION 'invalid attention recipients' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_attention_intent BEFORE INSERT OR UPDATE ON workspace_chat_messages FOR EACH ROW EXECUTE FUNCTION ashbi_workspace_attention_intent();

CREATE FUNCTION ashbi_validate_workspace_attention() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room workspace_chat_channels%ROWTYPE; msg workspace_chat_messages%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."channelId" IS DISTINCT FROM OLD."channelId"
      OR NEW."messageId" IS DISTINCT FROM OLD."messageId" OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (OLD."acknowledgedAt" IS NOT NULL AND NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt") THEN
      RAISE EXCEPTION 'attention identity and acknowledgement are immutable' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."acknowledgedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'new attention must be pending' USING ERRCODE='23514';
  END IF;
  -- Same channel-first ordering as sends and membership revocation.
  SELECT * INTO room FROM workspace_chat_channels WHERE id=NEW."channelId" AND "organizationId"=NEW."organizationId" AND "archivedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attention channel unavailable' USING ERRCODE='23514'; END IF;
  IF room."clientId" IS NOT NULL THEN
    PERFORM 1 FROM clients WHERE id=room."clientId" AND "organizationId"=NEW."organizationId" AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'attention client unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  IF room."projectId" IS NOT NULL THEN
    PERFORM 1 FROM projects WHERE id=room."projectId" AND "organizationId"=NEW."organizationId" AND "clientId"=room."clientId" AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'attention project unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO msg FROM workspace_chat_messages WHERE id=NEW."messageId" AND "channelId"=NEW."channelId" AND "organizationId"=NEW."organizationId";
  IF NOT FOUND OR NOT NEW."recipientId"=ANY(msg."attentionRecipientIds") OR NEW."recipientId"=msg."authorId" THEN
    RAISE EXCEPTION 'attention message mismatch' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM workspace_chat_members WHERE "channelId"=NEW."channelId" AND "organizationId"=NEW."organizationId" AND "userId"=NEW."recipientId" AND "leftAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attention membership unavailable' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM users WHERE id=NEW."recipientId" AND "organizationId"=NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attention human unavailable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_attention_scope BEFORE INSERT OR UPDATE ON workspace_chat_attention FOR EACH ROW EXECUTE FUNCTION ashbi_validate_workspace_attention();

-- Every selected recipient and only those recipients must commit with the
-- message. Deferral permits the message and child rows in the same transaction.
CREATE FUNCTION ashbi_workspace_attention_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message_id TEXT; msg workspace_chat_messages%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='workspace_chat_messages' THEN message_id:=NEW.id;
  ELSIF TG_OP='DELETE' THEN message_id:=OLD."messageId";
  ELSE message_id:=NEW."messageId"; END IF;
  SELECT * INTO msg FROM workspace_chat_messages WHERE id=message_id;
  IF FOUND AND (SELECT array_agg(recipient ORDER BY recipient) FROM unnest(msg."attentionRecipientIds") AS recipient)
    IS DISTINCT FROM (SELECT array_agg("recipientId" ORDER BY "recipientId") FROM workspace_chat_attention WHERE "messageId"=msg.id AND "organizationId"=msg."organizationId" AND "channelId"=msg."channelId") THEN
    RAISE EXCEPTION 'attention recipients must commit atomically' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workspace_message_attention_complete AFTER INSERT ON workspace_chat_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ashbi_workspace_attention_complete();
CREATE CONSTRAINT TRIGGER workspace_attention_complete AFTER INSERT OR DELETE ON workspace_chat_attention DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ashbi_workspace_attention_complete();
