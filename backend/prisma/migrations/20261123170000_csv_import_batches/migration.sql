-- CreateEnum
CREATE TYPE "ImportFileFormat" AS ENUM ('GENERIC', 'IBKR_FLEX');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PARSED', 'INVALID');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "format" "ImportFileFormat" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "encoding" VARCHAR(24) NOT NULL,
    "separator" CHAR(1) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "batchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "data" JSONB,
    "error" VARCHAR(512),

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("batchId","number")
);

-- CreateIndex
CREATE INDEX "ImportBatch_authorId_idx" ON "ImportBatch"("authorId");

-- CreateIndex
CREATE INDEX "ImportBatch_accountId_createdAt_idx" ON "ImportBatch"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_accountId_authorId_format_contentHash_key" ON "ImportBatch"("accountId", "authorId", "format", "contentHash");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InvestmentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

