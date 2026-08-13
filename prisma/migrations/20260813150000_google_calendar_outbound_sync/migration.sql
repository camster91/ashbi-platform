-- Ashbi-authoritative outbound Google Calendar foundation. Tokens remain
-- encrypted at rest; Google external IDs make repeat syncs idempotent.
ALTER TABLE "calendar_events" ADD COLUMN "googleEventId" TEXT;
ALTER TABLE "calendar_events" ADD COLUMN "googleEventUrl" TEXT;
ALTER TABLE "calendar_events" ADD COLUMN "googleSyncStatus" TEXT NOT NULL DEFAULT 'NOT_CONNECTED';
ALTER TABLE "calendar_events" ADD COLUMN "googleSyncError" TEXT;
ALTER TABLE "calendar_events" ADD COLUMN "googleSyncedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "calendar_events_googleEventId_key" ON "calendar_events"("googleEventId");

CREATE TABLE "google_calendar_connections" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL DEFAULT 'primary',
  "refreshTokenEncrypted" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastError" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "google_calendar_connections_userId_key" ON "google_calendar_connections"("userId");
CREATE INDEX "google_calendar_connections_organizationId_status_idx" ON "google_calendar_connections"("organizationId", "status");
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
