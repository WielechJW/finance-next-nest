import type { TransactionType } from '../generated/prisma/client.js';

export interface CategoryResponse {
  id: string;
  name: string;
  type: TransactionType;
}
