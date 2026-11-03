import type { Prisma } from '../generated/prisma/client.js';

/** Serialize a stored Decimal(14,2) amount without converting it to Number. */
export function formatMoney(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}
