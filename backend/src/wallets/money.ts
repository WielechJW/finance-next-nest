import type { Prisma } from '../generated/prisma/client.js';

/** Serialize a stored amount or aggregate Decimal without converting to Number. */
export function formatMoney(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}
