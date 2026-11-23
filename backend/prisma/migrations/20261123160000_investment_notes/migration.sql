-- CreateTable
CREATE TABLE "InvestmentNote" (
    "userId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "thesis" VARCHAR(4000) NOT NULL,
    "risks" VARCHAR(4000) NOT NULL,
    "reviewConditions" VARCHAR(4000) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InvestmentNote_pkey" PRIMARY KEY ("userId","instrumentId")
);

-- CreateIndex
CREATE INDEX "InvestmentNote_instrumentId_idx" ON "InvestmentNote"("instrumentId");

-- AddForeignKey
ALTER TABLE "InvestmentNote" ADD CONSTRAINT "InvestmentNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentNote" ADD CONSTRAINT "InvestmentNote_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
