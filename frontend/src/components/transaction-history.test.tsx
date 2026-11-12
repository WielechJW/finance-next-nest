import { useState } from "react";
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
import {
  categories,
  deferred,
  historyPage,
  transaction,
} from "../../test/transactions";
import {
  TransactionHistory,
  type TransactionHistoryQuery,
} from "./transaction-history";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/transactions-api", () => ({
  transactionsApi: { list: mocks.list },
}));
function History({
  initial = { filters: {}, page: 1, revision: 0 },
}: {
  initial?: TransactionHistoryQuery;
}) {
  const [query, setQuery] = useState(initial);
  return (
    <TransactionHistory
      categories={{
        state: { status: "ready", items: categories },
        retry: vi.fn(),
      }}
      query={query}
      setQuery={setQuery}
    />
  );
}
const apply = () =>
  fireEvent.submit(screen.getByRole("form", { name: "Filtry historii" }));

describe("Transaction history", () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue(historyPage());
  });

  it("shows calendar dates, names and signed amounts with explicit types", async () => {
    mocks.list.mockResolvedValueOnce({
      ...historyPage(1, 2),
      items: [
        transaction,
        {
          ...transaction,
          id: "20000000-0000-4000-8000-000000000002",
          type: "INCOME",
          categoryId: categories[1]!.id,
          title: "Wypłata",
          amount: "50.20",
          occurredOn: "0001-01-01",
        },
      ],
    });
    render(<History />);
    const rows = within(
      await screen.findByRole("list", { name: "Lista transakcji" }),
    ).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("12.11.2026")).toBeDefined();
    expect(within(rows[0]!).getByText("Jedzenie")).toBeDefined();
    expect(within(rows[0]!).getByText("Wydatek")).toBeDefined();
    expect(within(rows[0]!).getByText("-12,50 zł")).toBeDefined();
    expect(within(rows[1]!).getByText("01.01.0001")).toBeDefined();
    expect(within(rows[1]!).getByText("Wynagrodzenie")).toBeDefined();
    expect(within(rows[1]!).getByText("Przychód")).toBeDefined();
    expect(within(rows[1]!).getByText("+50,20 zł")).toBeDefined();
  });

  it("paginates, applies combined filters from page one and restores the complete history on reset", async () => {
    mocks.list.mockImplementation(async (input) =>
      historyPage(input.page, input.type ? 1 : 21),
    );
    render(<History />);
    await screen.findByText("Operacja 1");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Następna strona" }));
    await screen.findByText("Operacja 21");
    fireEvent.change(screen.getByLabelText("Filtr typu"), {
      target: { value: "EXPENSE" },
    });
    fireEvent.change(screen.getByLabelText("Filtr kategorii"), {
      target: { value: categories[0]!.id },
    });
    fireEvent.change(screen.getByLabelText("Data od"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("Data do"), {
      target: { value: "2026-11-30" },
    });
    apply();
    await screen.findByText("Operacja 1");
    expect(mocks.list).toHaveBeenLastCalledWith(
      {
        type: "EXPENSE",
        categoryId: categories[0]!.id,
        from: "2026-11-01",
        to: "2026-11-30",
        page: 1,
        pageSize: 20,
      },
      expect.any(AbortSignal),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Wyczyść filtry" }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        { page: 1, pageSize: 20 },
        expect.any(AbortSignal),
      ),
    );
    expect(
      (screen.getByLabelText("Filtr typu") as HTMLSelectElement).value,
    ).toBe("");
    expect((screen.getByLabelText("Data od") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("clears an incompatible category when the filter type changes", async () => {
    render(<History />);
    await screen.findByText("Operacja 1");
    fireEvent.change(screen.getByLabelText("Filtr kategorii"), {
      target: { value: categories[1]!.id },
    });
    fireEvent.change(screen.getByLabelText("Filtr typu"), {
      target: { value: "EXPENSE" },
    });
    expect(
      (screen.getByLabelText("Filtr kategorii") as HTMLSelectElement).value,
    ).toBe("");
    expect(screen.queryByRole("option", { name: "Wynagrodzenie" })).toBeNull();
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("validates a reversed date range before sending filters", async () => {
    render(<History />);
    await screen.findByText("Operacja 1");
    fireEvent.change(screen.getByLabelText("Data od"), {
      target: { value: "2026-11-30" },
    });
    fireEvent.change(screen.getByLabelText("Data do"), {
      target: { value: "2026-11-01" },
    });
    apply();
    expect(screen.getByRole("alert").textContent).toContain(
      "Data do nie może być wcześniejsza",
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Data do"));
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("distinguishes an empty wallet from filters without matches", async () => {
    mocks.list.mockResolvedValue(historyPage(1, 0));
    render(<History />);
    expect(
      (
        await screen.findByRole("link", { name: "Dodaj pierwszą transakcję" })
      ).getAttribute("href"),
    ).toBe("#transaction-form-heading");
    fireEvent.change(screen.getByLabelText("Filtr typu"), {
      target: { value: "INCOME" },
    });
    apply();
    await screen.findByText("Brak transakcji spełniających wybrane filtry.");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Pokaż całą historię" }));
    await screen.findByText(
      "Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek.",
    );
  });

  it("ignores a late response for an old filter and cancels its request", async () => {
    const old = deferred<ReturnType<typeof historyPage>>();
    mocks.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      ...historyPage(),
      items: [
        {
          ...transaction,
          title: "Aktualny przychód",
          type: "INCOME",
          categoryId: categories[1]!.id,
        },
      ],
    });
    render(<History />);
    expect(screen.getByRole("status").textContent).toBe("Ładowanie historii…");
    const signal = mocks.list.mock.calls[0]![1] as AbortSignal;
    fireEvent.change(screen.getByLabelText("Filtr typu"), {
      target: { value: "INCOME" },
    });
    apply();
    await screen.findByText("Aktualny przychód");
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(historyPage()));
    expect(screen.queryByText("Operacja 1")).toBeNull();
    expect(screen.getByText("Aktualny przychód")).toBeDefined();
  });

  it("retries the same filtered request after an error", async () => {
    mocks.list
      .mockRejectedValueOnce(new ApiError(503, "Spróbuj ponownie."))
      .mockResolvedValueOnce(historyPage());
    render(
      <History
        initial={{ filters: { type: "INCOME" }, page: 1, revision: 0 }}
      />,
    );
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Ponów pobieranie historii",
      }),
    );
    await screen.findByText("Operacja 1");
    expect(mocks.list).toHaveBeenLastCalledWith(
      { type: "INCOME", page: 1, pageSize: 20 },
      expect.any(AbortSignal),
    );
  });

  it("returns to an existing page when the result set shrinks", async () => {
    mocks.list.mockImplementation(async (input) => historyPage(input.page, 1));
    render(<History initial={{ filters: {}, page: 2, revision: 0 }} />);
    await screen.findByText("Operacja 1");
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 20 },
      expect.any(AbortSignal),
    );
  });

  it("cancels an unmounted request", async () => {
    const pending = deferred<ReturnType<typeof historyPage>>();
    mocks.list.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<History />);
    const signal = mocks.list.mock.calls[0]![1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(historyPage()));
  });
});
