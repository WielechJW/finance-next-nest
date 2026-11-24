-- CreateEnum
CREATE TYPE "PortfolioMode" AS ENUM ('MANUAL', 'PAPER');

-- CreateEnum
CREATE TYPE "BrokerMode" AS ENUM ('LOCAL_PAPER');

-- CreateEnum
CREATE TYPE "PaperSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PaperOrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "PaperOrderState" AS ENUM ('INTENT', 'SENT', 'ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaperEventKind" AS ENUM ('SENT', 'ACCEPTED', 'FILL', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "mode" "PortfolioMode" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "BrokerConnection" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "mode" "BrokerMode" NOT NULL DEFAULT 'LOCAL_PAPER',
    "idempotencyKey" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "openingOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "clientOrderId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "side" "PaperSide" NOT NULL,
    "type" "PaperOrderType" NOT NULL,
    "state" "PaperOrderState" NOT NULL DEFAULT 'INTENT',
    "quantity" DECIMAL(28,10) NOT NULL,
    "filledQuantity" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "limitPrice" DECIMAL(28,10),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "externalEventId" VARCHAR(128) NOT NULL,
    "kind" "PaperEventKind" NOT NULL,
    "happenedAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fill" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "executionId" VARCHAR(128) NOT NULL,
    "executedAt" TIMESTAMPTZ(3) NOT NULL,
    "daySequence" INTEGER NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "price" DECIMAL(28,10) NOT NULL,
    "fee" DECIMAL(28,8) NOT NULL,
    "ledgerEventId" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,

    CONSTRAINT "Fill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrokerConnection_accountId_key" ON "BrokerConnection"("accountId");

-- CreateIndex
CREATE INDEX "BrokerConnection_userId_createdAt_idx" ON "BrokerConnection"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerConnection_userId_idempotencyKey_key" ON "BrokerConnection"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_connectionId_createdAt_idx" ON "Order"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_instrumentId_idx" ON "Order"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_connectionId_key" ON "Order"("id", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_connectionId_clientOrderId_key" ON "Order"("connectionId", "clientOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_connectionId_idempotencyKey_key" ON "Order"("connectionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_happenedAt_idx" ON "OrderEvent"("orderId", "happenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_orderId_externalEventId_key" ON "OrderEvent"("orderId", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Fill_ledgerEventId_key" ON "Fill"("ledgerEventId");

-- CreateIndex
CREATE INDEX "Fill_orderId_connectionId_executedAt_idx" ON "Fill"("orderId", "connectionId", "executedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Fill_connectionId_executionId_key" ON "Fill"("connectionId", "executionId");

-- AddForeignKey
ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InvestmentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_orderId_connectionId_fkey" FOREIGN KEY ("orderId", "connectionId") REFERENCES "Order"("id", "connectionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_ledgerEventId_fkey" FOREIGN KEY ("ledgerEventId") REFERENCES "InvestmentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Order"
  ADD CONSTRAINT "Order_paper_quantities_check" CHECK (
    "quantity" > 0 AND "quantity" < 'Infinity'::numeric AND
    "filledQuantity" >= 0 AND "filledQuantity" <= "quantity"
  ),
  ADD CONSTRAINT "Order_paper_limit_check" CHECK (
    ("type" = 'MARKET' AND "limitPrice" IS NULL) OR
    ("type" = 'LIMIT' AND "limitPrice" IS NOT NULL AND "limitPrice" > 0 AND "limitPrice" < 'Infinity'::numeric)
  );

ALTER TABLE "Fill" ADD CONSTRAINT "Fill_paper_values_check" CHECK (
  "daySequence" >= 3 AND "quantity" > 0 AND "quantity" < 'Infinity'::numeric AND
  "price" > 0 AND "price" < 'Infinity'::numeric AND "fee" >= 0 AND "fee" < 'Infinity'::numeric
);
