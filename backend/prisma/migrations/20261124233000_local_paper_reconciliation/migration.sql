-- AlterTable
ALTER TABLE "BrokerConnection" ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaperVenueOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "clientOrderId" UUID NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaperVenueOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperVenueEvent" (
    "id" UUID NOT NULL,
    "venueOrderId" UUID NOT NULL,
    "eventKey" VARCHAR(128) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,

    CONSTRAINT "PaperVenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperReconciliation" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperVenueOrder_orderId_key" ON "PaperVenueOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperVenueOrder_clientOrderId_key" ON "PaperVenueOrder"("clientOrderId");

-- CreateIndex
CREATE INDEX "PaperVenueEvent_venueOrderId_occurredAt_idx" ON "PaperVenueEvent"("venueOrderId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaperVenueEvent_venueOrderId_eventKey_key" ON "PaperVenueEvent"("venueOrderId", "eventKey");

-- CreateIndex
CREATE INDEX "PaperReconciliation_connectionId_createdAt_idx" ON "PaperReconciliation"("connectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaperVenueOrder" ADD CONSTRAINT "PaperVenueOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperVenueEvent" ADD CONSTRAINT "PaperVenueEvent_venueOrderId_fkey" FOREIGN KEY ("venueOrderId") REFERENCES "PaperVenueOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperReconciliation" ADD CONSTRAINT "PaperReconciliation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

