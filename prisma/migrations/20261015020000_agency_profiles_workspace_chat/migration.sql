-- CreateTable
CREATE TABLE "client_agent_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Account manager',
    "instructions" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "pluginIds" JSONB NOT NULL DEFAULT '["client-work"]',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_chat_channels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "directKey" TEXT,
    "createdById" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_chat_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_chat_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leftAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_chat_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_chat_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "clientKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_agent_profiles_organizationId_clientId_key" ON "client_agent_profiles"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_agent_profiles_id_organizationId_key" ON "client_agent_profiles"("id", "organizationId");

-- CreateIndex
CREATE INDEX "workspace_chat_channels_organizationId_updatedAt_idx" ON "workspace_chat_channels"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_chat_channels_id_organizationId_key" ON "workspace_chat_channels"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_chat_channels_organizationId_directKey_key" ON "workspace_chat_channels"("organizationId", "directKey");

-- CreateIndex
CREATE INDEX "workspace_chat_members_organizationId_userId_leftAt_idx" ON "workspace_chat_members"("organizationId", "userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_chat_members_channelId_userId_key" ON "workspace_chat_members"("channelId", "userId");

-- CreateIndex
CREATE INDEX "workspace_chat_messages_organizationId_channelId_createdAt__idx" ON "workspace_chat_messages"("organizationId", "channelId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_chat_messages_channelId_clientKey_key" ON "workspace_chat_messages"("channelId", "clientKey");

-- AddForeignKey
ALTER TABLE "client_agent_profiles" ADD CONSTRAINT "client_agent_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_agent_profiles" ADD CONSTRAINT "client_agent_profiles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_agent_profiles" ADD CONSTRAINT "client_agent_profiles_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_agent_profiles" ADD CONSTRAINT "client_agent_profiles_updatedById_organizationId_fkey" FOREIGN KEY ("updatedById", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_channels" ADD CONSTRAINT "workspace_chat_channels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_channels" ADD CONSTRAINT "workspace_chat_channels_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_channels" ADD CONSTRAINT "workspace_chat_channels_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_channels" ADD CONSTRAINT "workspace_chat_channels_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_members" ADD CONSTRAINT "workspace_chat_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_members" ADD CONSTRAINT "workspace_chat_members_channelId_organizationId_fkey" FOREIGN KEY ("channelId", "organizationId") REFERENCES "workspace_chat_channels"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_members" ADD CONSTRAINT "workspace_chat_members_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_messages" ADD CONSTRAINT "workspace_chat_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_messages" ADD CONSTRAINT "workspace_chat_messages_channelId_organizationId_fkey" FOREIGN KEY ("channelId", "organizationId") REFERENCES "workspace_chat_channels"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_messages" ADD CONSTRAINT "workspace_chat_messages_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chat_messages" ADD CONSTRAINT "workspace_chat_messages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "workspace_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense in depth for raw SQL/background writers as well as the tenant proxy.
ALTER TABLE "client_agent_profiles" ADD CONSTRAINT "client_agent_profile_bounds" CHECK (
  char_length(btrim("name")) BETWEEN 1 AND 100 AND char_length("instructions") <= 2000
  AND "revision" > 0 AND "portalEnabled" = false
  AND jsonb_typeof("pluginIds") = 'array' AND jsonb_array_length("pluginIds") <= 1
  AND "pluginIds" <@ '["client-work"]'::jsonb
);
ALTER TABLE "workspace_chat_channels" ADD CONSTRAINT "workspace_chat_channel_shape" CHECK (
  char_length(btrim("name")) BETWEEN 1 AND 120 AND "revision" > 0 AND (
    ("kind" IN ('COMPANY','DIRECT') AND "clientId" IS NULL AND "projectId" IS NULL)
    OR ("kind" = 'CLIENT' AND "clientId" IS NOT NULL AND "projectId" IS NULL)
    OR ("kind" = 'PROJECT' AND "clientId" IS NOT NULL AND "projectId" IS NOT NULL)
  ) AND (("kind" = 'DIRECT' AND "directKey" IS NOT NULL) OR ("kind" <> 'DIRECT' AND "directKey" IS NULL))
);
ALTER TABLE "workspace_chat_messages" ADD CONSTRAINT "workspace_chat_message_bounds" CHECK (
  char_length(btrim("content")) BETWEEN 1 AND 4000
  AND ("clientKey" IS NULL OR char_length("clientKey") BETWEEN 8 AND 128)
  AND ("parentId" IS NULL OR "parentId" <> "id")
);

CREATE FUNCTION ashbi_validate_agent_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    RAISE EXCEPTION 'agent profile identity is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM clients WHERE id = NEW."clientId" AND "organizationId" = NEW."organizationId" AND "deletedAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent client unavailable' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM users WHERE id = NEW."updatedById" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent staff unavailable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_agent_profile_scope BEFORE INSERT OR UPDATE ON client_agent_profiles FOR EACH ROW EXECUTE FUNCTION ashbi_validate_agent_profile();

CREATE FUNCTION ashbi_validate_workspace_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."directKey" IS DISTINCT FROM OLD."directKey"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    RAISE EXCEPTION 'channel identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."clientId" IS NOT NULL THEN
    PERFORM 1 FROM clients WHERE id = NEW."clientId" AND "organizationId" = NEW."organizationId" AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'channel client unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW."projectId" IS NOT NULL THEN
    PERFORM 1 FROM projects WHERE id = NEW."projectId" AND "organizationId" = NEW."organizationId" AND "clientId" = NEW."clientId" AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'channel project unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM users WHERE id = NEW."createdById" AND "organizationId" = NEW."organizationId" AND "isActive"
      AND role IN ('ADMIN','TEAM') AND (NEW.kind <> 'COMPANY' OR role = 'ADMIN') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'channel staff unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_channel_scope BEFORE INSERT OR UPDATE ON workspace_chat_channels FOR EACH ROW EXECUTE FUNCTION ashbi_validate_workspace_channel();

CREATE FUNCTION ashbi_validate_workspace_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."channelId" IS DISTINCT FROM OLD."channelId" OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    RAISE EXCEPTION 'channel membership identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR (OLD."leftAt" IS NOT NULL AND NEW."leftAt" IS NULL) THEN
    PERFORM 1 FROM users WHERE id = NEW."userId" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'channel member unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_member_scope BEFORE INSERT OR UPDATE ON workspace_chat_members FOR EACH ROW EXECUTE FUNCTION ashbi_validate_workspace_member();

CREATE FUNCTION ashbi_validate_workspace_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room workspace_chat_channels%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."channelId" IS DISTINCT FROM OLD."channelId" OR NEW."authorId" IS DISTINCT FROM OLD."authorId") THEN
    RAISE EXCEPTION 'message identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO room FROM workspace_chat_channels WHERE id = NEW."channelId" AND "organizationId" = NEW."organizationId" AND "archivedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel unavailable' USING ERRCODE = '23514'; END IF;
  IF room."clientId" IS NOT NULL THEN
    PERFORM 1 FROM clients WHERE id = room."clientId" AND "organizationId" = NEW."organizationId" AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'channel client unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  IF room."projectId" IS NOT NULL THEN
    PERFORM 1 FROM projects WHERE id = room."projectId" AND "organizationId" = NEW."organizationId" AND "clientId" = room."clientId" AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'channel project unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  PERFORM 1 FROM workspace_chat_members WHERE "channelId" = NEW."channelId" AND "organizationId" = NEW."organizationId" AND "userId" = NEW."authorId" AND "leftAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message membership unavailable' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM users WHERE id = NEW."authorId" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message staff unavailable' USING ERRCODE = '23514'; END IF;
  IF NEW."parentId" IS NOT NULL THEN
    PERFORM 1 FROM workspace_chat_messages WHERE id = NEW."parentId" AND "channelId" = NEW."channelId" AND "organizationId" = NEW."organizationId";
    IF NOT FOUND THEN RAISE EXCEPTION 'message parent unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_message_scope BEFORE INSERT OR UPDATE ON workspace_chat_messages FOR EACH ROW EXECUTE FUNCTION ashbi_validate_workspace_message();
CREATE INDEX "client_agent_profiles_clientId_idx" ON "client_agent_profiles"("clientId");
CREATE INDEX "client_agent_profiles_createdById_organizationId_idx" ON "client_agent_profiles"("createdById", "organizationId");
CREATE INDEX "client_agent_profiles_updatedById_organizationId_idx" ON "client_agent_profiles"("updatedById", "organizationId");
CREATE INDEX "workspace_chat_channels_clientId_idx" ON "workspace_chat_channels"("clientId");
CREATE INDEX "workspace_chat_channels_projectId_idx" ON "workspace_chat_channels"("projectId");
CREATE INDEX "workspace_chat_channels_createdById_organizationId_idx" ON "workspace_chat_channels"("createdById", "organizationId");
CREATE INDEX "workspace_chat_members_channelId_organizationId_idx" ON "workspace_chat_members"("channelId", "organizationId");
CREATE INDEX "workspace_chat_members_userId_organizationId_idx" ON "workspace_chat_members"("userId", "organizationId");
CREATE INDEX "workspace_chat_messages_channelId_organizationId_idx" ON "workspace_chat_messages"("channelId", "organizationId");
CREATE INDEX "workspace_chat_messages_authorId_organizationId_idx" ON "workspace_chat_messages"("authorId", "organizationId");
CREATE INDEX "workspace_chat_messages_parentId_idx" ON "workspace_chat_messages"("parentId");
