CREATE TABLE "portal_handoff_requests" (
 "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "requestedById" TEXT NOT NULL, "contactId" TEXT NOT NULL, "creationSessionVersion" INTEGER NOT NULL CHECK("creationSessionVersion">=0),
 "question" TEXT NOT NULL CHECK(length("question") BETWEEN 1 AND 2000 AND "question" ~ '[^[:space:]]'),
 "idempotencyKey" TEXT NOT NULL CHECK("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 "inputHash" TEXT NOT NULL CHECK("inputHash" ~ '^[0-9a-f]{64}$'),
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK("status" IN ('PENDING','CLAIMED','RESOLVED')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK("revision">0), "ownerId" TEXT, "changedById" TEXT NOT NULL,
 "requeueReason" TEXT CHECK("requeueReason" IN ('OWNER_UNAVAILABLE','RECOVERY')),
 "claimedAt" TIMESTAMP(3), "resolvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "portal_handoff_requests_organizationId_fkey" FOREIGN KEY("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "portal_handoff_requests_clientId_organizationId_fkey" FOREIGN KEY("clientId","organizationId") REFERENCES "clients"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "portal_handoff_requests_projectId_organizationId_fkey" FOREIGN KEY("projectId","organizationId") REFERENCES "projects"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(("status"='PENDING' AND "ownerId" IS NULL AND "claimedAt" IS NULL AND "resolvedAt" IS NULL)
  OR ("status"='CLAIMED' AND "ownerId" IS NOT NULL AND "claimedAt" IS NOT NULL AND "resolvedAt" IS NULL)
  OR ("status"='RESOLVED' AND "ownerId" IS NOT NULL AND "claimedAt" IS NOT NULL AND "resolvedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "portal_handoffs_principal_intent_key" ON "portal_handoff_requests"("organizationId","requestedById","contactId","idempotencyKey");
CREATE INDEX "portal_handoffs_project_status_id_idx" ON "portal_handoff_requests"("organizationId","projectId","status","id");
CREATE INDEX "portal_handoffs_principal_id_idx" ON "portal_handoff_requests"("organizationId","requestedById","contactId","id");
CREATE INDEX "portal_handoff_requests_clientId_organizationId_idx" ON "portal_handoff_requests"("clientId","organizationId");
CREATE INDEX "portal_handoff_requests_projectId_organizationId_idx" ON "portal_handoff_requests"("projectId","organizationId");

CREATE FUNCTION portal_handoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_role TEXT; actor_active BOOLEAN; actor_org TEXT; owner_ok BOOLEAN;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Human handoff records are retained'; END IF;
 IF NOT EXISTS(SELECT 1 FROM projects p JOIN clients c ON c.id=p."clientId" WHERE p.id=NEW."projectId" AND p."organizationId"=NEW."organizationId" AND p."clientId"=NEW."clientId" AND p."deletedAt" IS NULL AND c."organizationId"=NEW."organizationId" AND c."deletedAt" IS NULL AND c.status='ACTIVE' AND c."relationshipStatus" NOT IN ('ARCHIVED','CHURNED')) THEN RAISE EXCEPTION 'Handoff project unavailable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.revision<>1 OR NEW."changedById"<>NEW."requestedById" OR NEW."requeueReason" IS NOT NULL THEN RAISE EXCEPTION 'Invalid handoff origin'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users u JOIN contacts k ON lower(k.email)=lower(u.email) AND k."clientId"=u."clientId" WHERE u.id=NEW."requestedById" AND k.id=NEW."contactId" AND u."organizationId"=NEW."organizationId" AND u."clientId"=NEW."clientId" AND u."isActive" AND u.role='CLIENT' AND u."sessionVersion"=NEW."creationSessionVersion") THEN RAISE EXCEPTION 'Portal principal unavailable'; END IF;
  IF NEW."inputHash"<>encode(sha256(convert_to(NEW.question,'UTF8')),'hex') THEN RAISE EXCEPTION 'Invalid handoff input digest'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='RESOLVED' OR ROW(NEW.id,NEW."organizationId",NEW."clientId",NEW."projectId",NEW."requestedById",NEW."contactId",NEW."creationSessionVersion",NEW.question,NEW."idempotencyKey",NEW."inputHash",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."organizationId",OLD."clientId",OLD."projectId",OLD."requestedById",OLD."contactId",OLD."creationSessionVersion",OLD.question,OLD."idempotencyKey",OLD."inputHash",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Handoff immutable origin or stale revision'; END IF;
 SELECT role,"isActive","organizationId" INTO actor_role,actor_active,actor_org FROM users WHERE id=NEW."changedById";
 IF actor_active IS NOT TRUE OR actor_org IS DISTINCT FROM NEW."organizationId" OR actor_role NOT IN ('ADMIN','TEAM') THEN RAISE EXCEPTION 'Handoff staff unavailable'; END IF;
 IF OLD.status='PENDING' AND NEW.status='CLAIMED' AND NEW."ownerId"=NEW."changedById" AND NEW."requeueReason" IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='CLAIMED' AND NEW.status='RESOLVED' AND NEW."ownerId"=OLD."ownerId" AND NEW."claimedAt"=OLD."claimedAt" AND NEW."requeueReason" IS NULL AND (NEW."changedById"=OLD."ownerId" OR actor_role='ADMIN') THEN RETURN NEW; END IF;
 IF OLD.status='CLAIMED' AND NEW.status='PENDING' AND actor_role='ADMIN' AND NEW."requeueReason" IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM users WHERE id=OLD."ownerId" AND "organizationId"=NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM')) INTO owner_ok;
  IF NEW."requeueReason"='OWNER_UNAVAILABLE' AND owner_ok THEN RAISE EXCEPTION 'Handoff owner is still available'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Invalid handoff transition';
END;
$$;
CREATE TRIGGER portal_handoff_guard BEFORE INSERT OR UPDATE OR DELETE ON "portal_handoff_requests" FOR EACH ROW EXECUTE FUNCTION portal_handoff_guard();
