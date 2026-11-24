-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "mappedInstrumentId" UUID;

-- CreateIndex
CREATE INDEX "ImportRow_mappedInstrumentId_idx" ON "ImportRow"("mappedInstrumentId");

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_mappedInstrumentId_fkey" FOREIGN KEY ("mappedInstrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

