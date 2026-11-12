import type {
  CategoryDto,
  TransactionDto,
  TransactionListDto,
} from "../src/lib/transaction-types";
import type { WalletDto } from "../src/lib/wallet-types";

export const categories: CategoryDto[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Jedzenie",
    type: "EXPENSE",
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Wynagrodzenie",
    type: "INCOME",
  },
];
export const transaction: TransactionDto = {
  id: "20000000-0000-4000-8000-000000000001",
  walletId: "30000000-0000-4000-8000-000000000001",
  type: "EXPENSE",
  categoryId: categories[0]!.id,
  amount: "12.50",
  title: "Zakupy",
  occurredOn: "2026-11-12",
  note: null,
  createdAt: "2026-11-12T12:00:00.000Z",
  updatedAt: "2026-11-12T12:00:00.000Z",
};
export const wallet: WalletDto = {
  id: transaction.walletId,
  name: "Mój portfel",
  currency: "PLN",
  openingBalance: "0.00",
  balance: "0.00",
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function historyPage(page = 1, total = 1): TransactionListDto {
  return {
    page,
    pageSize: 20,
    total,
    items: Array.from(
      { length: Math.min(20, Math.max(0, total - (page - 1) * 20)) },
      (_, index) => {
        const number = (page - 1) * 20 + index + 1;
        return {
          ...transaction,
          id:
            "20000000-0000-4000-8000-" + number.toString(16).padStart(12, "0"),
          title: "Operacja " + number,
        };
      },
    ),
  };
}
