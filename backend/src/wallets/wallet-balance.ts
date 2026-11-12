import type { Prisma, Wallet } from '../generated/prisma/client.js';

export type WalletWithBalance = Pick<
  Wallet,
  'id' | 'name' | 'currency' | 'openingBalance'
> & { balance: Prisma.Decimal };

export async function findWalletWithBalance(
  database: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string,
): Promise<WalletWithBalance | null> {
  // A single statement reads the opening balance and entire history from the
  // same snapshot. PostgreSQL numeric keeps sums exact beyond Decimal(14,2)
  // and the default precision of Decimal arithmetic in JavaScript.
  const [wallet] = await database.$queryRaw<WalletWithBalance[]>`
    SELECT w."id", w."name", w."currency", w."openingBalance",
      w."openingBalance" + COALESCE(SUM(
        CASE WHEN t."type" = 'INCOME' THEN t."amount" ELSE -t."amount" END
      ), 0) AS "balance"
    FROM "Wallet" w
    LEFT JOIN "Transaction" t ON t."walletId" = w."id"
    WHERE w."userId" = ${userId}::uuid
    GROUP BY w."id"
  `;
  return wallet ?? null;
}
