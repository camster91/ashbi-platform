-- CreateTable
CREATE TABLE "public_inquiries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "serviceLine" TEXT NOT NULL,
    "businessContext" TEXT NOT NULL,
    "requestedOutcome" TEXT NOT NULL,
    "timing" TEXT,
    "budgetBand" TEXT,
    "budgetCurrency" TEXT,
    "privacyVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "attribution" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_inquiries_organizationId_createdAt_idx" ON "public_inquiries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "public_inquiries_ownerId_idx" ON "public_inquiries"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "public_inquiries_organizationId_idempotencyKey_key" ON "public_inquiries"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "public_inquiries" ADD CONSTRAINT "public_inquiries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_inquiries" ADD CONSTRAINT "public_inquiries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
