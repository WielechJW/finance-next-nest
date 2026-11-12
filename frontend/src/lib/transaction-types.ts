export type TransactionType = "INCOME" | "EXPENSE";

export interface CategoryDto {
  id: string;
  name: string;
  type: TransactionType;
}

export interface CreateTransactionInput {
  type: TransactionType;
  amount: string;
  categoryId: string;
  title: string;
  occurredOn: string;
  note?: string;
}

export interface TransactionDto extends Omit<CreateTransactionInput, "note"> {
  id: string;
  walletId: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionFilters {
  type?: TransactionType;
  categoryId?: string;
  from?: string;
  to?: string;
}

export interface ListTransactionsInput extends TransactionFilters {
  page?: number;
  pageSize?: number;
}

export interface TransactionListDto {
  items: TransactionDto[];
  page: number;
  pageSize: number;
  total: number;
}
