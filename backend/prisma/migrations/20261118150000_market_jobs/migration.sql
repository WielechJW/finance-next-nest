CREATE TABLE "MarketJob" (
 "id" UUID PRIMARY KEY, "key" VARCHAR(200) NOT NULL UNIQUE, "kind" VARCHAR(30) NOT NULL, "payload" JSONB NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED')),
 "priority" INTEGER NOT NULL DEFAULT 10, "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
 "runAfter" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMPTZ(3), "runToken" UUID,
 "errorCode" VARCHAR(40), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL, "finishedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "MarketJob_status_runAfter_priority_idx" ON "MarketJob"("status", "runAfter", "priority");
CREATE TABLE "WorkerHeartbeat" ("name" VARCHAR(80) PRIMARY KEY, "updatedAt" TIMESTAMPTZ(3) NOT NULL);
