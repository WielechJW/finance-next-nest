-- CreateEnum
CREATE TYPE "StrategyRunMode" AS ENUM ('MANUAL', 'SCHEDULED');

-- DropIndex
DROP INDEX "StrategyRun_versionId_decidedAt_key";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "signalId" UUID;

-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN     "notifyOnSignal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StrategyRun" ADD COLUMN     "mode" "StrategyRunMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "scheduledSessionOn" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_signalId_key" ON "Notification"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyRun_versionId_decidedAt_mode_key" ON "StrategyRun"("versionId", "decidedAt", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyRun_versionId_scheduledSessionOn_key" ON "StrategyRun"("versionId", "scheduledSessionOn");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Notification" DROP CONSTRAINT "Notification_kind_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_kind_check" CHECK ("kind" IN ('ALERT', 'SUMMARY', 'SIGNAL'));
