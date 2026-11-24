-- CreateEnum
CREATE TYPE "StrategySignalSide" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "Strategy" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "ruleKey" VARCHAR(80) NOT NULL,
    "codeVersion" VARCHAR(32) NOT NULL,
    "parameters" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyRun" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL,
    "input" JSONB NOT NULL,
    "decision" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "side" "StrategySignalSide" NOT NULL,
    "rationale" VARCHAR(500) NOT NULL,
    "expectedSessionOn" DATE NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Strategy_accountId_createdAt_idx" ON "Strategy"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Strategy_instrumentId_idx" ON "Strategy"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_strategyId_number_key" ON "StrategyVersion"("strategyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyRun_versionId_decidedAt_key" ON "StrategyRun"("versionId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_runId_key" ON "Signal"("runId");

-- CreateIndex
CREATE INDEX "Signal_instrumentId_decidedAt_idx" ON "Signal"("instrumentId", "decidedAt");

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InvestmentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyRun" ADD CONSTRAINT "StrategyRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "StrategyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StrategyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

