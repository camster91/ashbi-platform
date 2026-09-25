-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "stripeCheckoutAmountMinor" INTEGER,
ADD COLUMN     "stripeCheckoutAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeCheckoutCurrency" TEXT,
ADD COLUMN     "stripeCheckoutExpiresAt" TIMESTAMP(3);
