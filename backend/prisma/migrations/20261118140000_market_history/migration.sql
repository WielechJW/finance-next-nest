CREATE TYPE "CorporateActionKind" AS ENUM ('SPLIT', 'DIVIDEND');
CREATE TABLE "PriceBar" (
  "id" UUID PRIMARY KEY, "instrumentId" UUID NOT NULL REFERENCES "Instrument"("id") ON DELETE RESTRICT,
  "source" VARCHAR(30) NOT NULL, "sessionOn" DATE NOT NULL,
  "open" DECIMAL(28,10) NOT NULL CHECK ("open" > 0 AND "open" <> 'NaN'),
  "high" DECIMAL(28,10) NOT NULL CHECK ("high" > 0 AND "high" <> 'NaN'),
  "low" DECIMAL(28,10) NOT NULL CHECK ("low" > 0 AND "low" <> 'NaN'),
  "close" DECIMAL(28,10) NOT NULL CHECK ("close" > 0 AND "close" <> 'NaN'),
  "adjustedClose" DECIMAL(28,10) NOT NULL CHECK ("adjustedClose" > 0 AND "adjustedClose" <> 'NaN'),
  "volume" DECIMAL(28,0) NOT NULL CHECK ("volume" >= 0 AND "volume" <> 'NaN'),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0), "currentSlot" INTEGER DEFAULT 1 CHECK ("currentSlot" = 1),
  "contentHash" CHAR(64) NOT NULL, "publishedAt" TIMESTAMPTZ(3), "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("high" >= GREATEST("open", "close") AND "low" <= LEAST("open", "close") AND "high" >= "low"),
  UNIQUE ("instrumentId", "source", "sessionOn", "revision"), UNIQUE ("instrumentId", "source", "sessionOn", "currentSlot")
);
CREATE INDEX "PriceBar_instrumentId_sessionOn_idx" ON "PriceBar"("instrumentId", "sessionOn");
CREATE TABLE "FxRate" (
  "id" UUID PRIMARY KEY, "source" VARCHAR(30) NOT NULL,
  "base" "InvestmentCurrency" NOT NULL DEFAULT 'USD', "quote" "InvestmentCurrency" NOT NULL DEFAULT 'PLN',
  "sessionOn" DATE NOT NULL, "rate" DECIMAL(28,8) NOT NULL CHECK ("rate" > 0 AND "rate" <> 'NaN'),
  "reference" VARCHAR(80) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "currentSlot" INTEGER DEFAULT 1 CHECK ("currentSlot" = 1), "contentHash" CHAR(64) NOT NULL,
  "publishedAt" TIMESTAMPTZ(3), "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("base" = 'USD' AND "quote" = 'PLN'),
  UNIQUE ("source", "base", "quote", "sessionOn", "revision"), UNIQUE ("source", "base", "quote", "sessionOn", "currentSlot")
);
CREATE TABLE "CorporateAction" (
  "id" UUID PRIMARY KEY, "instrumentId" UUID NOT NULL REFERENCES "Instrument"("id") ON DELETE RESTRICT,
  "source" VARCHAR(30) NOT NULL, "kind" "CorporateActionKind" NOT NULL, "exDate" DATE NOT NULL, "paymentOn" DATE,
  "currency" "InvestmentCurrency", "amount" DECIMAL(28,8), "amountBasis" VARCHAR(30),
  "numerator" DECIMAL(28,10), "denominator" DECIMAL(28,10),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0), "currentSlot" INTEGER DEFAULT 1 CHECK ("currentSlot" = 1),
  "contentHash" CHAR(64) NOT NULL, "publishedAt" TIMESTAMPTZ(3), "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("kind" = 'DIVIDEND' AND "amount" IS NOT NULL AND "amount" >= 0 AND "amount" <> 'NaN' AND "currency" IS NOT NULL AND "amountBasis" IS NOT NULL AND "numerator" IS NULL AND "denominator" IS NULL)
    OR ("kind" = 'SPLIT' AND "numerator" IS NOT NULL AND "denominator" IS NOT NULL AND "numerator" > 0 AND "numerator" <> 'NaN' AND "denominator" > 0 AND "denominator" <> 'NaN' AND "amount" IS NULL AND "currency" IS NULL)),
  UNIQUE ("instrumentId", "source", "kind", "exDate", "revision"), UNIQUE ("instrumentId", "source", "kind", "exDate", "currentSlot")
);
