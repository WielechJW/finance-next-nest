CREATE TABLE "TransactionCreation" (
    "walletId" UUID NOT NULL REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "key" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "transactionId" UUID UNIQUE REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY ("walletId", "key")
);
