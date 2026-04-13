-- CreateTable: RateCard
CREATE TABLE IF NOT EXISTS "rate_cards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "rates" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Integration
CREATE TABLE IF NOT EXISTS "integrations" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "orgId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: RateCard -> Client
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.table_constraints
   WHERE constraint_name = 'rate_cards_clientId_fkey' AND table_name = 'rate_cards'
 ) THEN
   ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rate_cards_clientId_idx" ON "rate_cards"("clientId");