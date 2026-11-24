-- AlterEnum
ALTER TYPE "ImportBatchStatus" ADD VALUE 'CONFIRMED';

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "confirmationHash" CHAR(64),
ADD COLUMN     "confirmedAt" TIMESTAMPTZ(3);

