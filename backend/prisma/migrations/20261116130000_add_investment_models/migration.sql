BEGIN;

CREATE TYPE "InvestmentCurrency" AS ENUM ('PLN', 'USD');

CREATE TABLE "Portfolio" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Portfolio_name_check" CHECK ("name" = BTRIM("name") AND "name" <> '')
);

CREATE TABLE "InvestmentAccount" (
    "id" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InvestmentAccount_name_check" CHECK ("name" = BTRIM("name") AND "name" <> '')
);

CREATE TABLE "Instrument" (
    "id" UUID NOT NULL,
    "ticker" VARCHAR(32) NOT NULL,
    "mic" VARCHAR(4) NOT NULL,
    "currency" "InvestmentCurrency" NOT NULL,
    "isin" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Instrument_ticker_check" CHECK ("ticker" = BTRIM("ticker") AND "ticker" <> ''),
    CONSTRAINT "Instrument_mic_check" CHECK ("mic" ~ '^[A-Z0-9]{4}$'),
    CONSTRAINT "Instrument_isin_check" CHECK ("isin" IS NULL OR "isin" ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$')
);

CREATE TABLE "InstrumentProviderMapping" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "symbol" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstrumentProviderMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InstrumentProviderMapping_provider_check" CHECK ("provider" = BTRIM("provider") AND "provider" <> ''),
    CONSTRAINT "InstrumentProviderMapping_symbol_check" CHECK ("symbol" = BTRIM("symbol") AND "symbol" <> '')
);

CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");
CREATE INDEX "InvestmentAccount_portfolioId_idx" ON "InvestmentAccount"("portfolioId");
CREATE UNIQUE INDEX "Instrument_mic_ticker_key" ON "Instrument"("mic", "ticker");
CREATE INDEX "Instrument_isin_idx" ON "Instrument"("isin");
CREATE UNIQUE INDEX "InstrumentProviderMapping_provider_symbol_key"
    ON "InstrumentProviderMapping"("provider", "symbol");
CREATE UNIQUE INDEX "InstrumentProviderMapping_instrumentId_provider_key"
    ON "InstrumentProviderMapping"("instrumentId", "provider");

ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentAccount" ADD CONSTRAINT "InvestmentAccount_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstrumentProviderMapping" ADD CONSTRAINT "InstrumentProviderMapping_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
