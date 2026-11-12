import type { TransactionType } from '../generated/prisma/client.js';

export interface TransactionResponse {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: string;
  categoryId: string;
  title: string;
  note: string | null;
  occurredOn: string;
  createdAt: string;
  updatedAt: string;
}
