BEGIN;

ALTER TABLE "InvestmentEvent"
    ADD COLUMN "payloadHash" CHAR(64),
    ADD CONSTRAINT "InvestmentEvent_payloadHash_check" CHECK (
        "payloadHash" IS NULL OR "payloadHash" ~ '^[0-9a-f]{64}$'
    );

COMMIT;
