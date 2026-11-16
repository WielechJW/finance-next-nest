BEGIN;

CREATE TABLE "OpeningLot" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "totalCost" DECIMAL(28,8) NOT NULL,
    "acquiredOn" DATE NOT NULL,

    CONSTRAINT "OpeningLot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OpeningLot_values_check" CHECK (
        "quantity" > 0 AND "quantity" <= 999999999999999999.9999999999
        AND "totalCost" >= 0 AND "totalCost" <= 99999999999999999999.99999999
        AND "acquiredOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    )
);

CREATE UNIQUE INDEX "OpeningLot_eventId_key" ON "OpeningLot"("eventId");
CREATE INDEX "OpeningLot_instrumentId_idx" ON "OpeningLot"("instrumentId");

ALTER TABLE "OpeningLot" ADD CONSTRAINT "OpeningLot_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "InvestmentEvent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpeningLot" ADD CONSTRAINT "OpeningLot_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
