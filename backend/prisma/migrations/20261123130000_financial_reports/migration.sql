-- CreateEnum
CREATE TYPE "FinancialReportScope" AS ENUM ('CONSOLIDATED', 'STANDALONE');

-- CreateEnum
CREATE TYPE "FinancialReportPeriod" AS ENUM ('ANNUAL', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "FinancialReportCurrency" AS ENUM ('PLN', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "FundamentalMetric" AS ENUM ('REVENUE', 'EBIT', 'NET_INCOME', 'OPERATING_CASH_FLOW', 'LONG_TERM_DEBT');

-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "companyId" UUID;

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "scope" "FinancialReportScope" NOT NULL,
    "periodKind" "FinancialReportPeriod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "publishedOn" DATE NOT NULL,
    "currency" "FinancialReportCurrency" NOT NULL,
    "sourceUrl" VARCHAR(2048) NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "pdf" BYTEA NOT NULL,
    "parsedReport" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundamentalFact" (
    "reportId" UUID NOT NULL,
    "metric" "FundamentalMetric" NOT NULL,
    "amount" DECIMAL(38,10) NOT NULL,
    "unit" VARCHAR(16) NOT NULL,
    "period" VARCHAR(64) NOT NULL,
    "page" INTEGER NOT NULL,

    CONSTRAINT "FundamentalFact_pkey" PRIMARY KEY ("reportId","metric")
);

-- CreateIndex
CREATE INDEX "FinancialReport_userId_createdAt_idx" ON "FinancialReport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialReport_companyId_idx" ON "FinancialReport"("companyId");

-- CreateIndex
CREATE INDEX "FinancialReport_instrumentId_idx" ON "FinancialReport"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialReport_period_version_key" ON "FinancialReport"("userId", "companyId", "scope", "periodKind", "periodStart", "periodEnd", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialReport_period_hash_key" ON "FinancialReport"("userId", "companyId", "scope", "periodKind", "periodStart", "periodEnd", "contentHash");

-- CreateIndex
CREATE INDEX "Instrument_companyId_idx" ON "Instrument"("companyId");

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialReport" ADD CONSTRAINT "FinancialReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialReport" ADD CONSTRAINT "FinancialReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialReport" ADD CONSTRAINT "FinancialReport_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundamentalFact" ADD CONSTRAINT "FundamentalFact_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
