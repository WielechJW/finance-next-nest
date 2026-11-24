-- CreateEnum
CREATE TYPE "BacktestPhase" AS ENUM ('DEVELOPMENT', 'OUT_OF_SAMPLE');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "baselineId" UUID,
    "phase" "BacktestPhase" NOT NULL,
    "status" "BacktestStatus" NOT NULL,
    "fromOn" DATE NOT NULL,
    "toOn" DATE NOT NULL,
    "modelVersion" VARCHAR(32) NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "input" JSONB NOT NULL,
    "report" JSONB,
    "error" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacktestRun_versionId_createdAt_idx" ON "BacktestRun"("versionId", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestRun_baselineId_idx" ON "BacktestRun"("baselineId");

-- AddForeignKey
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "StrategyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

