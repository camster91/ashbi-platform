-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryMessageId" TEXT,
ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "deliveryStatusAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryMessageId" TEXT,
ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "deliveryStatusAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryMessageId" TEXT,
ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "deliveryStatusAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryMessageId" TEXT,
ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "deliveryStatusAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mailgun_webhook_receipts" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailgun_webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mailgun_webhook_receipts_token_key" ON "mailgun_webhook_receipts"("token");

-- CreateIndex
CREATE INDEX "mailgun_webhook_receipts_receivedAt_idx" ON "mailgun_webhook_receipts"("receivedAt");

