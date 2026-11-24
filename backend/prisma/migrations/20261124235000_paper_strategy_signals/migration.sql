ALTER TABLE "Order" ADD COLUMN "signalId" UUID;
CREATE UNIQUE INDEX "Order_connectionId_signalId_key" ON "Order"("connectionId", "signalId");
CREATE INDEX "Order_signalId_idx" ON "Order"("signalId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_signalId_fkey"
  FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
