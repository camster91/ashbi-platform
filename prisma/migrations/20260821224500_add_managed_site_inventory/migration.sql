CREATE TABLE "managed_sites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'INVENTORIED',
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_sites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "managed_sites_organizationId_url_key" ON "managed_sites"("organizationId", "url");
CREATE INDEX "managed_sites_organizationId_idx" ON "managed_sites"("organizationId");
CREATE INDEX "managed_sites_clientId_idx" ON "managed_sites"("clientId");
CREATE INDEX "managed_sites_platform_idx" ON "managed_sites"("platform");

ALTER TABLE "managed_sites" ADD CONSTRAINT "managed_sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "managed_sites" ADD CONSTRAINT "managed_sites_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
