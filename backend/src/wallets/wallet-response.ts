import type { Currency } from '../generated/prisma/client.js';

export interface WalletResponse {
  id: string;
  name: string;
  currency: Currency;
  openingBalance: string;
  balance: string;
}
