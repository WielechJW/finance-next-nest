-- Archiving preserves every event and allows reading/reconciling the ledger.
ALTER TABLE "InvestmentAccount" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
