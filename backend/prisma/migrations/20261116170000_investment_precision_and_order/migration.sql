BEGIN;

CREATE TYPE "InvestmentTimePrecision" AS ENUM ('DATE', 'INSTANT');
CREATE TYPE "InvestmentOrderingSource" AS ENUM ('EXPLICIT', 'MIGRATED_UNVERIFIED');

ALTER TABLE "InvestmentEvent"
    ADD COLUMN "timePrecision" "InvestmentTimePrecision" NOT NULL DEFAULT 'DATE',
    ADD COLUMN "executedAt" TIMESTAMPTZ(3),
    ADD COLUMN "sourceTimeZone" VARCHAR(64),
    ADD COLUMN "marketSessionOn" DATE,
    ADD COLUMN "settledOn" DATE,
    ADD COLUMN "daySequence" INTEGER,
    ADD COLUMN "orderingSource" "InvestmentOrderingSource" NOT NULL DEFAULT 'EXPLICIT',
    ADD COLUMN "fxRatePlnPerUsd" DECIMAL(28,8);

-- Pre-1.3 events have no verified economic ordering. Give them deterministic,
-- unique positions for migration safety, while marking them for human review.
WITH ordered AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "accountId", "occurredOn"
        ORDER BY "recordedAt", "id"
    )::INTEGER AS position
    FROM "InvestmentEvent"
)
UPDATE "InvestmentEvent" AS event
SET "daySequence" = ordered.position,
    "orderingSource" = 'MIGRATED_UNVERIFIED'
FROM ordered
WHERE event."id" = ordered."id";

ALTER TABLE "InvestmentEvent"
    ALTER COLUMN "daySequence" SET NOT NULL,
    ADD CONSTRAINT "InvestmentEvent_daySequence_check" CHECK ("daySequence" > 0),
    ADD CONSTRAINT "InvestmentEvent_time_check" CHECK (
        ("timePrecision" = 'DATE' AND "executedAt" IS NULL) OR
        ("timePrecision" = 'INSTANT' AND "executedAt" IS NOT NULL
            AND "sourceTimeZone" IS NOT NULL)
    ),
    ADD CONSTRAINT "InvestmentEvent_sourceTimeZone_check" CHECK (
        "sourceTimeZone" IS NULL OR
        ("sourceTimeZone" = BTRIM("sourceTimeZone") AND "sourceTimeZone" <> '')
    ),
    ADD CONSTRAINT "InvestmentEvent_Warsaw_date_check" CHECK (
        "executedAt" IS NULL OR
        ("executedAt" AT TIME ZONE 'Europe/Warsaw')::DATE = "occurredOn"
    ),
    ADD CONSTRAINT "InvestmentEvent_marketSessionOn_check" CHECK (
        "marketSessionOn" IS NULL OR
        "marketSessionOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    ),
    ADD CONSTRAINT "InvestmentEvent_settledOn_check" CHECK (
        "settledOn" IS NULL OR
        "settledOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    ),
    ADD CONSTRAINT "InvestmentEvent_fxRate_check" CHECK (
        "fxRatePlnPerUsd" IS NULL OR
        ("type" = 'FX' AND "fxRatePlnPerUsd" > 0
            AND "fxRatePlnPerUsd" <= 99999999999999999999.99999999)
    );

DROP INDEX "InvestmentEvent_accountId_occurredOn_id_idx";
CREATE UNIQUE INDEX "InvestmentEvent_accountId_occurredOn_daySequence_key"
    ON "InvestmentEvent"("accountId", "occurredOn", "daySequence");

-- Cash and gross trade amounts are settled to cents, even though the column
-- retains eight decimal places for the broader investment domain.
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_cents_check"
    CHECK ("amount" = ROUND("amount", 2));
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_gross_cents_check"
    CHECK ("grossAmount" = ROUND("grossAmount", 2));

COMMIT;
