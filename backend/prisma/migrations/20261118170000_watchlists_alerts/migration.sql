CREATE TABLE "Watchlist" ("id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "name" VARCHAR(100) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");
CREATE TABLE "WatchlistItem" ("id" UUID PRIMARY KEY, "watchlistId" UUID NOT NULL REFERENCES "Watchlist"("id") ON DELETE CASCADE, "instrumentId" UUID NOT NULL REFERENCES "Instrument"("id") ON DELETE RESTRICT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("watchlistId", "instrumentId"));
CREATE TABLE "PriceAlert" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "instrumentId" UUID NOT NULL REFERENCES "Instrument"("id") ON DELETE RESTRICT,
 "direction" VARCHAR(10) NOT NULL CHECK ("direction" IN ('ABOVE', 'BELOW')), "mode" VARCHAR(10) NOT NULL CHECK ("mode" IN ('ONCE', 'REARM')),
 "threshold" DECIMAL(28,10) NOT NULL CHECK ("threshold" > 0 AND "threshold" <> 'NaN'), "active" BOOLEAN NOT NULL DEFAULT TRUE, "armed" BOOLEAN NOT NULL DEFAULT FALSE,
 "cooldownMinutes" INTEGER NOT NULL DEFAULT 1440 CHECK ("cooldownMinutes" BETWEEN 0 AND 525600),
 "lastSessionOn" DATE, "lastSatisfied" BOOLEAN, "lastPriceBarId" UUID, "lastTriggeredAt" TIMESTAMPTZ(3), "deletedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PriceAlert_userId_deletedAt_idx" ON "PriceAlert"("userId", "deletedAt");
CREATE INDEX "PriceAlert_instrumentId_active_idx" ON "PriceAlert"("instrumentId", "active");
CREATE TABLE "AlertEvent" (
 "id" UUID PRIMARY KEY, "alertId" UUID NOT NULL REFERENCES "PriceAlert"("id") ON DELETE CASCADE,
 "priceBarId" UUID NOT NULL REFERENCES "PriceBar"("id") ON DELETE RESTRICT,
 "sessionOn" DATE NOT NULL, "price" DECIMAL(28,10) NOT NULL, "threshold" DECIMAL(28,10) NOT NULL,
 "direction" VARCHAR(10) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("alertId", "sessionOn")
);
