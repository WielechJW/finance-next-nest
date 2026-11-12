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
  update: vi.fn(),
  remove: vi.fn(),
  wallet: vi.fn(),
  list: vi.fn(),
  session: {} as SessionState,
}));
vi.mock("@/lib/transactions-api", async (original) => ({
  ...(await original<typeof import("@/lib/transactions-api")>()),
  transactionsApi: {
    getCategories: mocks.categories,
    create: mocks.create,
    update: mocks.update,
    remove: mocks.remove,
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
    mocks.update.mockReset().mockResolvedValue(transaction);
    mocks.remove.mockReset().mockResolvedValue(undefined);
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
  async function openMutation(kind: "edit" | "delete") {
    const button = await screen.findByRole("button", {
      name: `${kind === "edit" ? "Edytuj" : "Usuń"}: Operacja 1`,
    });
    await userEvent.setup().click(button);
    return { button, dialog: within(screen.getByRole("dialog")) };
  }

  it("prefills editing without altering the create draft and restores focus on cancel", async () => {
    mocks.list.mockResolvedValue({
      ...historyPage(),
      items: [{ ...historyPage().items[0]!, note: "Stara notatka" }],
    });
    render(<TransactionsPanel />);
    const create = within(
      screen.getByRole("form", { name: "Nowa transakcja" }),
    );
    fireEvent.change(create.getByLabelText("Tytuł"), {
      target: { value: "Szkic nowej" },
    });
    const { button, dialog } = await openMutation("edit");
    expect((dialog.getByLabelText("Kwota") as HTMLInputElement).value).toBe(
      "12.50",
    );
    expect((dialog.getByLabelText("Tytuł") as HTMLInputElement).value).toBe(
      "Operacja 1",
    );
    expect(
      (dialog.getByLabelText("Notatka (opcjonalnie)") as HTMLInputElement)
        .value,
    ).toBe("Stara notatka");
    expect(
      (dialog.getByLabelText("Data operacji") as HTMLInputElement).value,
    ).toBe("2026-11-12");
    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.change(dialog.getByLabelText("Tytuł"), {
      target: { value: "Niezapisana zmiana" },
    });
    await userEvent
      .setup()
      .click(dialog.getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect((create.getByLabelText("Tytuł") as HTMLInputElement).value).toBe(
      "Szkic nowej",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.wallet).toHaveBeenCalledOnce();
  });

  it("validates dependent fields, saves all editable values once and clears the note", async () => {
    mocks.list.mockResolvedValueOnce(historyPage());
    const saved = {
      ...transaction,
      type: "INCOME" as const,
      categoryId: categories[1]!.id,
      title: "Poprawiona",
      amount: "50.20",
      occurredOn: "0001-01-01",
    };
    const pending = deferred<TransactionDto>();
    mocks.update.mockReturnValueOnce(pending.promise);
    mocks.list.mockResolvedValue({ ...historyPage(), items: [saved] });
    mocks.wallet
      .mockResolvedValueOnce(wallet)
      .mockResolvedValue({ ...wallet, balance: "50.20" });
    render(<TransactionsPanel />);
    const { dialog } = await openMutation("edit");
    fireEvent.change(dialog.getByLabelText("Typ operacji"), {
      target: { value: "INCOME" },
    });
    const form = dialog.getByRole("form", { name: "Edycja transakcji" });
    fireEvent.submit(form);
    expect(document.activeElement).toBe(dialog.getByLabelText("Kategoria"));
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText("Kategoria"), {
      target: { value: categories[1]!.id },
    });
    fireEvent.change(dialog.getByLabelText("Kwota"), {
      target: { value: "50,2" },
    });
    fireEvent.change(dialog.getByLabelText("Tytuł"), {
      target: { value: "  Poprawiona  " },
    });
    fireEvent.change(dialog.getByLabelText("Data operacji"), {
      target: { value: "0001-01-01" },
    });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      transaction.id,
      {
        type: "INCOME",
        categoryId: categories[1]!.id,
        amount: "50.20",
        title: "Poprawiona",
        occurredOn: "0001-01-01",
        note: null,
      },
      expect.any(AbortSignal),
    );
    expect(
      (dialog.getByRole("button", { name: "Anuluj" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).not.toBeNull();
    await act(async () => pending.resolve(saved));
    await screen.findByText("Transakcja zaktualizowana.");
    await screen.findByText("Poprawiona");
    await screen.findByText("50,20 zł");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Historia transakcji" }),
    );
    expect(mocks.wallet).toHaveBeenCalledTimes(2);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([0, 400, 503])(
    "preserves the edit draft after error %s and permits a deliberate retry",
    async (status) => {
      mocks.list.mockResolvedValue(historyPage());
      mocks.update.mockRejectedValueOnce(
        new ApiError(status, "Nie udało się zapisać."),
      );
      render(<TransactionsPanel />);
      const { dialog } = await openMutation("edit");
      fireEvent.change(dialog.getByLabelText("Tytuł"), {
        target: { value: "Zachowana zmiana" },
      });
      fireEvent.change(dialog.getByLabelText("Kwota"), {
        target: { value: "2,50" },
      });
      fireEvent.submit(dialog.getByRole("form"));
      await dialog.findByText("Nie udało się zapisać.");
      expect((dialog.getByLabelText("Tytuł") as HTMLInputElement).value).toBe(
        "Zachowana zmiana",
      );
      expect((dialog.getByLabelText("Kwota") as HTMLInputElement).value).toBe(
        "2,50",
      );
      expect(screen.queryByText("Transakcja zaktualizowana.")).toBeNull();
      expect(mocks.wallet).toHaveBeenCalledOnce();
      fireEvent.submit(dialog.getByRole("form"));
      await screen.findByText("Transakcja zaktualizowana.");
      expect(mocks.update).toHaveBeenCalledTimes(2);
    },
  );

  it("shows the deletion title and amount and cancels without sending a mutation", async () => {
    mocks.list.mockResolvedValue(historyPage());
    render(<TransactionsPanel />);
    const { button, dialog } = await openMutation("delete");
    expect(dialog.getByText(/Operacja 1/)).toBeDefined();
    expect(dialog.getByText("-12,50 zł")).toBeDefined();
    expect(document.activeElement).toBe(
      dialog.getByRole("button", { name: "Anuluj" }),
    );
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps deletion errors visible and guards repeat clicks and Escape while deleting", async () => {
    mocks.list
      .mockResolvedValueOnce(historyPage())
      .mockResolvedValue(historyPage(1, 0));
    mocks.remove.mockRejectedValueOnce(new ApiError(503, "Błąd usuwania."));
    render(<TransactionsPanel />);
    const { dialog } = await openMutation("delete");
    await userEvent
      .setup()
      .click(dialog.getByRole("button", { name: "Usuń transakcję" }));
    await dialog.findByText("Błąd usuwania.");
    expect(screen.queryByText("Transakcja usunięta.")).toBeNull();
    expect(mocks.wallet).toHaveBeenCalledOnce();
    const pending = deferred<void>();
    mocks.remove.mockReturnValueOnce(pending.promise);
    fireEvent.click(dialog.getByRole("button", { name: "Usuń transakcję" }));
    fireEvent.click(dialog.getByRole("button", { name: "Usuwanie…" }));
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(
      (dialog.getByRole("button", { name: "Anuluj" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => pending.resolve());
    await screen.findByText("Transakcja usunięta.");
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByText(
      "Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.",
    );
    expect(mocks.wallet).toHaveBeenCalledTimes(2);
  });

  it("preserves filters and fetches the last valid page after deleting its last row", async () => {
    let total = 21;
    mocks.list.mockImplementation(async (input) =>
      historyPage(input.page, total),
    );
    mocks.remove.mockImplementation(async () => {
      total = 20;
    });
    render(<TransactionsPanel />);
    await screen.findByText("Operacja 1");
    fireEvent.change(screen.getByLabelText("Filtr typu"), {
      target: { value: "EXPENSE" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Filtry historii" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Następna strona" }));
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Usuń: Operacja 21" }));
    await userEvent.setup().click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Usuń transakcję",
      }),
    );
    await screen.findByText("Operacja 1");
    expect(screen.getByText(/Liczba wyników: 20. Strona 1 z 1./)).toBeDefined();
    expect(mocks.list).toHaveBeenLastCalledWith(
      { type: "EXPENSE", page: 1, pageSize: 20 },
      expect.any(AbortSignal),
    );
    expect(
      (screen.getByLabelText("Filtr typu") as HTMLSelectElement).value,
    ).toBe("EXPENSE");
  });

  it.each(["edit", "delete"] as const)(
    "refreshes stale data on a %s 404 without claiming success",
    async (kind) => {
      mocks.list
        .mockResolvedValueOnce(historyPage())
        .mockResolvedValue(historyPage(1, 0));
      (kind === "edit" ? mocks.update : mocks.remove).mockRejectedValueOnce(
        new ApiError(404, "Nie znaleziono transakcji."),
      );
      render(<TransactionsPanel />);
      const { dialog } = await openMutation(kind);
      if (kind === "edit") fireEvent.submit(dialog.getByRole("form"));
      else
        fireEvent.click(
          dialog.getByRole("button", { name: "Usuń transakcję" }),
        );
      await dialog.findByText(/Ta transakcja nie jest już dostępna/);
      expect(
        (
          dialog.getByRole("button", {
            name: kind === "edit" ? "Zapisz zmiany" : "Usuń transakcję",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        screen.queryByText(
          kind === "edit"
            ? "Transakcja zaktualizowana."
            : "Transakcja usunięta.",
        ),
      ).toBeNull();
      await waitFor(() => expect(mocks.wallet).toHaveBeenCalledTimes(2));
      await userEvent
        .setup()
        .click(dialog.getByRole("button", { name: "Anuluj" }));
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Historia transakcji" }),
      );
    },
  );

  it.each(["edit", "delete"] as const)(
    "aborts %s on account change and ignores its late result",
    async (kind) => {
      mocks.list
        .mockResolvedValueOnce(historyPage())
        .mockResolvedValue(historyPage(1, 0));
      const pending = deferred<TransactionDto>();
      const mutation = kind === "edit" ? mocks.update : mocks.remove;
      mutation.mockReturnValueOnce(pending.promise);
      const { rerender } = render(<TransactionsPanel />);
      const { dialog } = await openMutation(kind);
      if (kind === "edit") fireEvent.submit(dialog.getByRole("form"));
      else
        fireEvent.click(
          dialog.getByRole("button", { name: "Usuń transakcję" }),
        );
      const signal = mutation.mock.calls[0]![
        kind === "edit" ? 2 : 1
      ] as AbortSignal;
      mocks.session = session("b");
      rerender(<TransactionsPanel />);
      expect(signal.aborted).toBe(true);
      await act(async () => pending.resolve(transaction));
      await screen.findByText(
        "Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.",
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(
        screen.queryByText(/Transakcja (zaktualizowana|usunięta)\./),
      ).toBeNull();
      expect(mocks.wallet).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["edit", "delete"] as const)(
    "retries only GET after a confirmed %s and a failed history refresh",
    async (kind) => {
      mocks.list
        .mockResolvedValueOnce(historyPage())
        .mockRejectedValueOnce(new ApiError(503, "Błąd odczytu."))
        .mockResolvedValueOnce(historyPage(1, 0));
      render(<TransactionsPanel />);
      const { dialog } = await openMutation(kind);
      if (kind === "edit") fireEvent.submit(dialog.getByRole("form"));
      else
        fireEvent.click(
          dialog.getByRole("button", { name: "Usuń transakcję" }),
        );
      await screen.findByText(
        kind === "edit" ? "Transakcja zaktualizowana." : "Transakcja usunięta.",
      );
      await userEvent.setup().click(
        await screen.findByRole("button", {
          name: "Ponów pobieranie historii",
        }),
      );
      await screen.findByText(
        "Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.",
      );
      expect(
        kind === "edit" ? mocks.update : mocks.remove,
      ).toHaveBeenCalledOnce();
      expect(mocks.list).toHaveBeenCalledTimes(3);
    },
  );
});
