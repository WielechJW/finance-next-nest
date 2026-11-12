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
