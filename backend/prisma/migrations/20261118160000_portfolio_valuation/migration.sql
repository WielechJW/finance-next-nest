CREATE TABLE "InvestmentSplit" (
 "id" UUID PRIMARY KEY, "eventId" UUID NOT NULL UNIQUE REFERENCES "InvestmentEvent"("id") ON DELETE CASCADE,
 "instrumentId" UUID NOT NULL REFERENCES "Instrument"("id") ON DELETE RESTRICT,
 "numerator" DECIMAL(28,10) NOT NULL CHECK ("numerator" > 0 AND "numerator" <> 'NaN'),
 "denominator" DECIMAL(28,10) NOT NULL CHECK ("denominator" > 0 AND "denominator" <> 'NaN'),
 CHECK ("numerator" <> "denominator")
);
CREATE INDEX "InvestmentSplit_instrumentId_idx" ON "InvestmentSplit"("instrumentId");
ALTER TABLE "InvestmentEvent" ADD COLUMN "corporateActionId" UUID REFERENCES "CorporateAction"("id") ON DELETE RESTRICT;
CREATE TABLE "PortfolioValuationSnapshot" (
 "id" UUID PRIMARY KEY, "portfolioId" UUID NOT NULL REFERENCES "Portfolio"("id") ON DELETE CASCADE,
 "asOf" DATE NOT NULL, "contentHash" CHAR(64) NOT NULL, "ledgerHash" CHAR(64) NOT NULL, "data" JSONB NOT NULL,
 "currentSlot" INTEGER DEFAULT 1 CHECK ("currentSlot" = 1), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("portfolioId", "asOf", "contentHash"), UNIQUE ("portfolioId", "asOf", "currentSlot")
);
