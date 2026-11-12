import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { SessionState } from "@/lib/session-store";
import type { TransactionDto } from "@/lib/transaction-types";
import {
  categories,
  deferred,
  transaction,
  wallet,
  historyPage,
} from "../../test/transactions";
import { TransactionsPanel } from "./transactions-panel";

const mocks = vi.hoisted(() => ({
  categories: vi.fn(),
  create: vi.fn(),
  wallet: vi.fn(),
  list: vi.fn(),
  session: {} as SessionState,
}));
vi.mock("@/lib/transactions-api", async (original) => ({
  ...(await original<typeof import("@/lib/transactions-api")>()),
  transactionsApi: {
    getCategories: mocks.categories,
    create: mocks.create,
    list: mocks.list,
  },
}));
vi.mock("@/lib/wallet-api", () => ({ walletApi: { get: mocks.wallet } }));
vi.mock("./session-provider", () => ({
  useSession: () => ({ state: mocks.session }),
}));
function session(id: string): SessionState {
  return {
    status: "authenticated",
    user: { id, email: id + "@example.invalid", createdAt: "2026-11-12" },
    error: null,
  };
}
async function fillAndSubmit() {
  await within(
    screen.getByRole("form", { name: "Nowa transakcja" }),
  ).findByRole("option", { name: "Jedzenie" });
  fireEvent.change(screen.getByLabelText("Kwota"), {
    target: { value: "12,50" },
  });
  fireEvent.change(screen.getByLabelText("Tytuł"), {
    target: { value: "Zakupy" },
  });
  fireEvent.change(screen.getByLabelText("Kategoria"), {
    target: { value: categories[0]!.id },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Nowa transakcja" }));
}

describe("Transactions panel", () => {
  beforeEach(() => {
    mocks.session = session("a");
    mocks.categories.mockReset().mockResolvedValue(categories);
    mocks.create.mockReset().mockResolvedValue(transaction);
    mocks.wallet.mockReset().mockResolvedValue(wallet);
    mocks.list.mockReset().mockResolvedValue(historyPage(1, 0));
  });
  it("refreshes the displayed wallet after a confirmed transaction", async () => {
    mocks.wallet
      .mockResolvedValueOnce(wallet)
      .mockResolvedValueOnce({ ...wallet, balance: "-12.50" });
    render(<TransactionsPanel />);
    await screen.findByText("0,00 zł");
    await fillAndSubmit();
    await screen.findByText("Wydatek zapisany.");
    await screen.findByText("-12,50 zł");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.wallet).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.categories).toHaveBeenCalledOnce();
  });
  it("retries only the balance read when it fails after a successful POST", async () => {
    mocks.wallet
      .mockResolvedValueOnce(wallet)
      .mockRejectedValueOnce(new ApiError(503, "Spróbuj ponownie."))
      .mockResolvedValueOnce({ ...wallet, balance: "-12.50" });
    render(<TransactionsPanel />);
    await screen.findByText("0,00 zł");
    await fillAndSubmit();
    await screen.findByText("Wydatek zapisany.");
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Odśwież saldo" }));
    await screen.findByText("-12,50 zł");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.wallet).toHaveBeenCalledTimes(3);
    expect((screen.getByLabelText("Kwota") as HTMLInputElement).value).toBe("");
  });
  it("clears drafts and ignores late wallet and POST responses after an account change", async () => {
    const oldWallet = deferred<typeof wallet>();
    const oldSave = deferred<TransactionDto>();
    const oldHistory = deferred<ReturnType<typeof historyPage>>();
    mocks.list
      .mockReturnValueOnce(oldHistory.promise)
      .mockResolvedValueOnce(historyPage(1, 0));
    mocks.wallet
      .mockReturnValueOnce(oldWallet.promise)
      .mockResolvedValueOnce({ ...wallet, balance: "50.20" });
    mocks.create.mockReturnValueOnce(oldSave.promise);
    const { rerender } = render(<TransactionsPanel />);
    await fillAndSubmit();
    const signal = mocks.create.mock.calls[0]![1] as AbortSignal;
    mocks.session = session("b");
    rerender(<TransactionsPanel />);
    await screen.findByText("50,20 zł");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      oldSave.resolve(transaction);
      oldWallet.resolve({ ...wallet, balance: "-999.99" });
      oldHistory.resolve(historyPage(1, 1));
    });
    expect(screen.queryByText("Wydatek zapisany.")).toBeNull();
    expect(screen.queryByText("-999,99 zł")).toBeNull();
    expect((screen.getByLabelText("Tytuł") as HTMLInputElement).value).toBe("");
    expect(mocks.wallet).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Operacja 1")).toBeNull();
  });

  it("preserves applied filters and returns to page one when a new operation is saved", async () => {
    mocks.list.mockImplementation(async (input) => historyPage(input.page, 21));
    render(<TransactionsPanel />);
    await screen.findByText("Operacja 1");
    fireEvent.change(screen.getByLabelText("Filtr typu"), {
      target: { value: "INCOME" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Filtry historii" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await screen.findByText("Operacja 1");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Następna strona" }));
    await screen.findByText("Operacja 21");
    await fillAndSubmit();
    await screen.findByText("Wydatek zapisany.");
    await screen.findByText("Operacja 1");
    expect(mocks.list).toHaveBeenLastCalledWith(
      { type: "INCOME", page: 1, pageSize: 20 },
      expect.any(AbortSignal),
    );
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.wallet).toHaveBeenCalledTimes(2);
  });
});
