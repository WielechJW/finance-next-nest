import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export async function lockImportAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  portfolioId: string,
  accountId: string,
) {
  const [account] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT a."archivedAt" FROM "InvestmentAccount" AS a
    JOIN "Portfolio" AS p ON p."id" = a."portfolioId"
    WHERE a."id" = ${accountId}::uuid AND p."id" = ${portfolioId}::uuid AND p."userId" = ${userId}::uuid
    FOR UPDATE OF a
  `;
  if (!account)
    throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
  return account;
}
