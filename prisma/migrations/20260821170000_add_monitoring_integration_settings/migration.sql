CREATE TABLE "monitoring_integration_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "minimaxApiKeyEncrypted" TEXT,
    "minimaxApiKeyKeyVersion" TEXT,
    "minimaxModel" TEXT NOT NULL DEFAULT 'MiniMax-M2.5',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitoring_integration_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "monitoring_integration_settings_organizationId_key" ON "monitoring_integration_settings"("organizationId");

ALTER TABLE "monitoring_integration_settings" ADD CONSTRAINT "monitoring_integration_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
