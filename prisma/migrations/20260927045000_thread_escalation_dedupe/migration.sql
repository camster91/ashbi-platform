-- Per-thread escalation dedupe: each SLA escalation level notifies once per
-- activity cycle instead of on every quarter-hourly sweep.
ALTER TABLE "threads" ADD COLUMN "lastEscalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "threads" ADD COLUMN "lastEscalatedAt" TIMESTAMP(3);
