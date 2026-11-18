ALTER TABLE "Instrument" ADD COLUMN "name" VARCHAR(200);
CREATE TABLE "MarketDataBudget" (
  "provider" VARCHAR(30) NOT NULL, "keyHash" CHAR(64) NOT NULL, "day" DATE NOT NULL,
  "spent" INTEGER NOT NULL DEFAULT 0 CHECK ("spent" >= 0),
  "lastRequestAt" TIMESTAMPTZ(3), "blockedUntil" TIMESTAMPTZ(3),
  PRIMARY KEY ("provider", "keyHash", "day")
);
