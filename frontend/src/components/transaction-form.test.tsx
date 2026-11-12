import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type {
  CreateTransactionInput,
  TransactionDto,
} from "@/lib/transaction-types";
import { categories, deferred, transaction } from "../../test/transactions";
import { TransactionForm } from "./transaction-form";

const mocks = vi.hoisted(() => ({ categories: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/transactions-api", async (original) => ({
  ...(await original<typeof import("@/lib/transactions-api")>()),
  transactionsApi: { getCategories: mocks.categories, create: mocks.create },
}));
const field = (label: string) =>
  screen.getByLabelText(label, { exact: true }) as HTMLInputElement;
const form = () => screen.getByRole("form", { name: "Nowa transakcja" });
const save = () =>
  screen.getByRole("button", {
    name: "Zapisz transakcję",
  }) as HTMLButtonElement;
function fill() {
  fireEvent.change(field("Kwota"), { target: { value: "12,5" } });
  fireEvent.change(field("Kategoria"), {
    target: { value: categories[0]!.id },
  });
  fireEvent.change(field("Tytuł"), { target: { value: "  Zakupy  " } });
  fireEvent.change(field("Data operacji"), { target: { value: "9999-12-31" } });
  fireEvent.change(field("Notatka (opcjonalnie)"), {
    target: { value: "  Obiad  " },
  });
}
async function ready(onCreated = vi.fn()) {
  const result = render(<TransactionForm onCreated={onCreated} />);
  await screen.findByRole("option", { name: "Jedzenie" });
  return { ...result, onCreated };
}

describe("Transaction form", () => {
  beforeEach(() => {
    mocks.categories.mockReset().mockResolvedValue(categories);
    mocks.create
      .mockReset()
      .mockImplementation(async (input: CreateTransactionInput) => ({
        ...transaction,
        ...input,
        note: input.note ?? null,
      }));
  });
  it("filters categories and clears the selected category after changing type", async () => {
    await ready();
    fill();
    expect(screen.queryByRole("option", { name: "Wynagrodzenie" })).toBeNull();
    await userEvent.setup().selectOptions(field("Typ operacji"), "INCOME");
    expect(field("Kategoria").value).toBe("");
    expect(screen.queryByRole("option", { name: "Jedzenie" })).toBeNull();
    expect(screen.getByRole("option", { name: "Wynagrodzenie" })).toBeDefined();
  });
  it.each(["EXPENSE", "INCOME"] as const)(
    "submits %s and resets only the new entry fields after success",
    async (type) => {
      const { onCreated } = await ready();
      fill();
      if (type === "INCOME") {
        fireEvent.change(field("Typ operacji"), { target: { value: type } });
        fireEvent.change(field("Kategoria"), {
          target: { value: categories[1]!.id },
        });
      }
      fireEvent.submit(form());
      await screen.findByText(
        type === "INCOME" ? "Przychód zapisany." : "Wydatek zapisany.",
      );
      expect(mocks.create).toHaveBeenCalledWith(
        {
          type,
          amount: "12.50",
          categoryId: categories[type === "INCOME" ? 1 : 0]!.id,
          title: "Zakupy",
          occurredOn: "9999-12-31",
          note: "  Obiad  ",
        },
        expect.any(AbortSignal),
      );
      expect(onCreated).toHaveBeenCalledOnce();
      expect(field("Kwota").value).toBe("");
      expect(field("Tytuł").value).toBe("");
      expect(field("Notatka (opcjonalnie)").value).toBe("");
      expect(field("Data operacji").value).toBe("9999-12-31");
      expect(field("Kategoria").value).not.toBe("");
    },
  );
  it.each([
    ["Kwota", "0"],
    ["Kwota", "-1,00"],
    ["Kwota", "0,001"],
    ["Kategoria", ""],
    ["Tytuł", " "],
    ["Tytuł", "a".repeat(101)],
    ["Data operacji", ""],
    ["Notatka (opcjonalnie)", "a".repeat(1001)],
  ])("marks %s as invalid and focuses the field (%#)", async (label, value) => {
    await ready();
    fill();
    fireEvent.change(field(label), { target: { value } });
    fireEvent.submit(form());
    expect(field(label).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field(label));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Popraw zaznaczone pola.",
    );
  });
  it("blocks concurrent submits and disables controls until the request completes", async () => {
    const pending = deferred<TransactionDto>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const { onCreated } = await ready();
    fill();
    fireEvent.submit(form());
    fireEvent.submit(form());
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(
      (
        screen.getByRole("button", {
          name: "Zapisywanie…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(field("Kwota").disabled).toBe(true);
    await act(async () => pending.resolve(transaction));
    expect(onCreated).toHaveBeenCalledOnce();
    expect(save().disabled).toBe(false);
  });
  it("preserves the complete draft after a network error and allows retry", async () => {
    mocks.create.mockRejectedValueOnce(new ApiError(0, "Sprawdź połączenie."));
    await ready();
    fill();
    fireEvent.submit(form());
    await screen.findByText("Sprawdź połączenie.");
    expect(field("Kwota").value).toBe("12,5");
    expect(field("Tytuł").value).toBe("  Zakupy  ");
    expect(field("Data operacji").value).toBe("9999-12-31");
    expect(field("Notatka (opcjonalnie)").value).toBe("  Obiad  ");
    expect(field("Kategoria").value).toBe(categories[0]!.id);
    fireEvent.submit(form());
    await screen.findByText("Wydatek zapisany.");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("allows retrying a failed category request while retaining typed data", async () => {
    mocks.categories.mockRejectedValueOnce(
      new ApiError(503, "Spróbuj ponownie."),
    );
    render(<TransactionForm onCreated={vi.fn()} />);
    await screen.findByRole("button", { name: "Ponów pobieranie kategorii" });
    expect(save().disabled).toBe(true);
    fireEvent.change(field("Tytuł"), { target: { value: "Zachowany tytuł" } });
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Ponów pobieranie kategorii" }),
      );
    await screen.findByRole("option", { name: "Jedzenie" });
    expect(field("Tytuł").value).toBe("Zachowany tytuł");
    expect(mocks.categories).toHaveBeenCalledTimes(2);
  });
  it("uses the current type when categories finish loading and handles an empty category list", async () => {
    const pending = deferred<typeof categories>();
    mocks.categories.mockReturnValueOnce(pending.promise);
    render(<TransactionForm onCreated={vi.fn()} />);
    expect(save().disabled).toBe(true);
    fireEvent.change(field("Typ operacji"), { target: { value: "INCOME" } });
    await act(async () => pending.resolve([]));
    expect(
      screen.getByText("Brak kategorii dla wybranego typu operacji."),
    ).toBeDefined();
    expect(save().disabled).toBe(true);
  });
  it("aborts an unmounted save and ignores a late success", async () => {
    const pending = deferred<TransactionDto>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const { unmount, onCreated } = await ready();
    fill();
    fireEvent.submit(form());
    const signal = mocks.create.mock.calls[0]![1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(transaction));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
