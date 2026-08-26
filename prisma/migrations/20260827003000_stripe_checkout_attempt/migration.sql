ALTER TABLE "invoices"
  ADD COLUMN "stripeCheckoutAttempt" INTEGER NOT NULL DEFAULT 0;
