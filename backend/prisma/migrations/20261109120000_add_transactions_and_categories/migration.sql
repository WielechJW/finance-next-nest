BEGIN;

CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "TransactionType" NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "categoryId" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "note" VARCHAR(1000),
    "occurredOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id"),
    -- The upper bound also excludes PostgreSQL's special numeric NaN value.
    CONSTRAINT "Transaction_amount_check"
        CHECK ("amount" > 0 AND "amount" <= 999999999999.99),
    CONSTRAINT "Transaction_occurredOn_check"
        CHECK ("occurredOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
);

CREATE UNIQUE INDEX "Category_id_type_key" ON "Category"("id", "type");
CREATE INDEX "Transaction_walletId_occurredOn_id_idx"
    ON "Transaction"("walletId", "occurredOn", "id");
CREATE INDEX "Transaction_categoryId_type_idx" ON "Transaction"("categoryId", "type");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_type_fkey"
    FOREIGN KEY ("categoryId", "type") REFERENCES "Category"("id", "type")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
