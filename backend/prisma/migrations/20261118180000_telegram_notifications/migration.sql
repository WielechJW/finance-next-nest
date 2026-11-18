CREATE TABLE "TelegramPairing" ("codeHash" CHAR(64) PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "expiresAt" TIMESTAMPTZ(3) NOT NULL, "consumedAt" TIMESTAMPTZ(3));
CREATE INDEX "TelegramPairing_userId_idx" ON "TelegramPairing"("userId");
CREATE TABLE "TelegramConnection" (
 "userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE, "chatId" VARCHAR(32) NOT NULL UNIQUE, "bindingId" UUID NOT NULL UNIQUE,
 "quietStart" INTEGER NOT NULL DEFAULT 1320 CHECK ("quietStart" BETWEEN 0 AND 1439), "quietEnd" INTEGER NOT NULL DEFAULT 420 CHECK ("quietEnd" BETWEEN 0 AND 1439),
 "timeZone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Warsaw', "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT FALSE, "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Notification" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "eventId" UUID UNIQUE REFERENCES "AlertEvent"("id") ON DELETE CASCADE, "kind" VARCHAR(20) NOT NULL DEFAULT 'ALERT' CHECK ("kind" IN ('ALERT', 'SUMMARY')), "summaryOn" DATE,
 "body" VARCHAR(4000) NOT NULL, "state" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED')),
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0), "runToken" UUID, "bindingId" UUID, "messageId" VARCHAR(40), "lastError" VARCHAR(40),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "sentAt" TIMESTAMPTZ(3), UNIQUE ("userId", "summaryOn")
);
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE TABLE "NotificationAttempt" (
 "id" UUID PRIMARY KEY, "notificationId" UUID NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE,
 "number" INTEGER NOT NULL CHECK ("number" > 0), "state" VARCHAR(20) NOT NULL,
 "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMPTZ(3), UNIQUE ("notificationId", "number")
);
