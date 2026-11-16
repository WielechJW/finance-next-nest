BEGIN;

ALTER TABLE "InvestmentEvent"
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "activeSlot" INTEGER DEFAULT 1,
    ADD CONSTRAINT "InvestmentEvent_revision_check" CHECK ("revision" >= 0),
    ADD CONSTRAINT "InvestmentEvent_activeSlot_check" CHECK ("activeSlot" IS NULL OR "activeSlot" = 1);

DROP INDEX "InvestmentEvent_accountId_occurredOn_daySequence_key";
CREATE UNIQUE INDEX "InvestmentEvent_accountId_occurredOn_daySequence_activeSlot_key"
    ON "InvestmentEvent"("accountId", "occurredOn", "daySequence", "activeSlot");

ALTER TABLE "InvestmentEvent" DROP CONSTRAINT "InvestmentEvent_correction_check";
ALTER TABLE "InvestmentEvent" ADD CONSTRAINT "InvestmentEvent_correction_check" CHECK (
    (
        "correctionOfId" IS NULL AND "correctionReason" IS NULL
        AND "type" <> 'CORRECTION' AND "revision" = 0
    ) OR (
        "correctionOfId" IS NOT NULL AND "correctionOfId" <> "id"
        AND "correctionReason" IS NOT NULL AND BTRIM("correctionReason") <> ''
        AND ("type" = 'CORRECTION' OR "revision" > 0)
    )
);

COMMIT;
