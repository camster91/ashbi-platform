-- Single-use client-portal magic links: record the jti of each redeemed link
-- so the same emailed link cannot be exchanged for a session twice.
--
-- Additive only: one new table and its indexes. No existing row is touched,
-- so rolling back the application image is safe (old code never reads it).

-- CreateTable
CREATE TABLE "client_portal_link_redemptions" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_link_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_link_redemptions_jti_key" ON "client_portal_link_redemptions"("jti");

-- CreateIndex
CREATE INDEX "client_portal_link_redemptions_expiresAt_idx" ON "client_portal_link_redemptions"("expiresAt");
