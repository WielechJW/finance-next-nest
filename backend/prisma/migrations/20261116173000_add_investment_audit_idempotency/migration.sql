BEGIN;

ALTER TABLE "InvestmentEvent"
    ADD COLUMN "sourceKey" VARCHAR(100),
    ADD COLUMN "externalOperationId" VARCHAR(128),
    ADD COLUMN "idempotencyKey" VARCHAR(128),
    ADD COLUMN "recordedBy" VARCHAR(128);

-- Older events have no reliable author or concrete provider identifier.
-- Preserve that uncertainty instead of inventing an attribution.
UPDATE "InvestmentEvent"
SET "sourceKey" = CASE
        WHEN "source" = 'MANUAL' THEN 'manual'
        ELSE 'legacy:' || LOWER("source"::TEXT)
    END,
    "recordedBy" = 'legacy:unknown';

ALTER TABLE "InvestmentEvent"
    ALTER COLUMN "sourceKey" SET NOT NULL,
    ALTER COLUMN "recordedBy" SET NOT NULL,
    ADD CONSTRAINT "InvestmentEvent_sourceKey_check" CHECK (
        "sourceKey" = BTRIM("sourceKey") AND
        "sourceKey" ~ '^[a-z0-9][a-z0-9._:-]*$' AND
        (("source" = 'MANUAL' AND "sourceKey" = 'manual') OR
         ("source" <> 'MANUAL' AND "sourceKey" <> 'manual'))
    ),
    ADD CONSTRAINT "InvestmentEvent_externalOperationId_check" CHECK (
        "externalOperationId" IS NULL OR
        ("source" <> 'MANUAL' AND
         "externalOperationId" = BTRIM("externalOperationId") AND
         "externalOperationId" <> '')
    ),
    ADD CONSTRAINT "InvestmentEvent_idempotencyKey_check" CHECK (
        "idempotencyKey" IS NULL OR
        ("idempotencyKey" = BTRIM("idempotencyKey") AND
         "idempotencyKey" <> '')
    ),
    ADD CONSTRAINT "InvestmentEvent_recordedBy_check" CHECK (
        "recordedBy" = BTRIM("recordedBy") AND "recordedBy" <> ''
    );

CREATE UNIQUE INDEX "InvestmentEvent_external_identity_key"
    ON "InvestmentEvent"("accountId", "source", "sourceKey", "externalOperationId");
CREATE UNIQUE INDEX "InvestmentEvent_accountId_idempotencyKey_key"
    ON "InvestmentEvent"("accountId", "idempotencyKey");
CREATE INDEX "InvestmentEvent_accountId_recordedAt_id_idx"
    ON "InvestmentEvent"("accountId", "recordedAt", "id");

COMMIT;
