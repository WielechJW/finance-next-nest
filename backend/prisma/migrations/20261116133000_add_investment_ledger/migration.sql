BEGIN;

CREATE TYPE "InvestmentEventType" AS ENUM (
    'DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'DIVIDEND',
    'FEE', 'FX', 'SPLIT', 'OPENING_POSITION', 'CORRECTION'
);
CREATE TYPE "InvestmentEventSource" AS ENUM ('MANUAL', 'IMPORT', 'BROKER', 'SYSTEM');
CREATE TYPE "CashEntryKind" AS ENUM (
    'EXTERNAL_TRANSFER', 'TRADE_GROSS', 'COMMISSION',
    'DIVIDEND_GROSS', 'WITHHOLDING_TAX', 'FEE', 'FX'
);

CREATE TABLE "InvestmentEvent" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "InvestmentEventType" NOT NULL,
    "source" "InvestmentEventSource" NOT NULL DEFAULT 'MANUAL',
    "occurredOn" DATE NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correctionOfId" UUID,
    "correctionReason" VARCHAR(500),

    CONSTRAINT "InvestmentEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InvestmentEvent_occurredOn_check"
        CHECK ("occurredOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
    CONSTRAINT "InvestmentEvent_correction_check" CHECK (
        (
            "type" = 'CORRECTION' AND "correctionOfId" IS NOT NULL
            AND "correctionOfId" <> "id"
            AND "correctionReason" IS NOT NULL
            AND BTRIM("correctionReason") <> ''
        ) OR (
            "type" <> 'CORRECTION' AND "correctionOfId" IS NULL
            AND "correctionReason" IS NULL
        )
    )
);

CREATE TABLE "Trade" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "unitPrice" DECIMAL(28,10) NOT NULL,
    "grossAmount" DECIMAL(28,8) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Trade_values_check" CHECK (
        "quantity" > 0 AND "quantity" <= 999999999999999999.9999999999
        AND "unitPrice" > 0 AND "unitPrice" <= 999999999999999999.9999999999
        AND "grossAmount" > 0 AND "grossAmount" <= 99999999999999999999.99999999
    )
);

CREATE TABLE "CashEntry" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "CashEntryKind" NOT NULL,
    "currency" "InvestmentCurrency" NOT NULL,
    "amount" DECIMAL(28,8) NOT NULL,

    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CashEntry_amount_check" CHECK (
        "amount" <> 0 AND ABS("amount") <= 99999999999999999999.99999999
    )
);

CREATE TABLE "SecurityEntry" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,

    CONSTRAINT "SecurityEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SecurityEntry_quantity_check" CHECK (
        "quantity" <> 0 AND ABS("quantity") <= 999999999999999999.9999999999
    )
);

CREATE UNIQUE INDEX "InvestmentEvent_id_accountId_key"
    ON "InvestmentEvent"("id", "accountId");
CREATE INDEX "InvestmentEvent_accountId_occurredOn_id_idx"
    ON "InvestmentEvent"("accountId", "occurredOn", "id");
CREATE INDEX "InvestmentEvent_correctionOfId_idx"
    ON "InvestmentEvent"("correctionOfId");
CREATE UNIQUE INDEX "Trade_eventId_key" ON "Trade"("eventId");
CREATE INDEX "Trade_instrumentId_idx" ON "Trade"("instrumentId");
CREATE INDEX "CashEntry_eventId_idx" ON "CashEntry"("eventId");
CREATE INDEX "SecurityEntry_eventId_idx" ON "SecurityEntry"("eventId");
CREATE INDEX "SecurityEntry_instrumentId_idx" ON "SecurityEntry"("instrumentId");

ALTER TABLE "InvestmentEvent" ADD CONSTRAINT "InvestmentEvent_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InvestmentAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentEvent" ADD CONSTRAINT "InvestmentEvent_correctionOfId_fkey"
    FOREIGN KEY ("correctionOfId", "accountId") REFERENCES "InvestmentEvent"("id", "accountId")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "InvestmentEvent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "InvestmentEvent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityEntry" ADD CONSTRAINT "SecurityEntry_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "InvestmentEvent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityEntry" ADD CONSTRAINT "SecurityEntry_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
