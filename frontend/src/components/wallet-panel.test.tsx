import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { SessionState } from "@/lib/session-store";
import type { UpdateWalletInput, WalletDto } from "@/lib/wallet-types";
import { WalletPanel } from "./wallet-panel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  session: {} as SessionState,
}));
vi.mock("@/lib/wallet-api", () => ({
  walletApi: { get: mocks.get, update: mocks.update },
}));
vi.mock("./session-provider", () => ({
  useSession: () => ({ state: mocks.session }),
}));

const wallet: WalletDto = {
  id: "wallet-a",
  name: "Mój portfel",
  currency: "PLN",
  openingBalance: "0.00",
  balance: "0.00",
};
function session(id: string): SessionState {
  return {
    status: "authenticated",
    user: { id, email: `${id}@example.invalid`, createdAt: "2026-11-03" },
    error: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function ready() {
  const result = render(<WalletPanel />);
  await screen.findByRole("heading", { name: wallet.name });
  return result;
}
const nameField = () =>
  screen.getByLabelText("Nazwa portfela") as HTMLInputElement;
const balanceField = () =>
  screen.getByLabelText("Saldo początkowe", {
    exact: true,
  }) as HTMLInputElement;
const saveButton = () =>
  screen.getByRole("button", { name: "Zapisz zmiany" }) as HTMLButtonElement;

describe("Wallet panel", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(wallet);
    mocks.update
      .mockReset()
      .mockImplementation(async (input: UpdateWalletInput) => ({
        ...wallet,
        ...input,
        balance: input.openingBalance ?? wallet.balance,
      }));
    mocks.session = session("a");
  });

  it("shows loading before presenting the real balances and the initial setup hint", async () => {
    const pending = deferred<WalletDto>();
    mocks.get.mockReturnValueOnce(pending.promise);
    render(<WalletPanel />);
    expect(screen.getByRole("status").textContent).toBe("Ładowanie portfela…");
    expect(screen.queryByText("0,00 zł")).toBeNull();
    await act(async () => pending.resolve(wallet));
    expect(screen.getAllByText("0,00 zł")).toHaveLength(2);
    expect(
      screen.getByText("Możesz ustawić saldo początkowe swojego portfela."),
    ).toBeDefined();
    expect(balanceField().value).toBe("0,00");
    expect(saveButton().disabled).toBe(true);
  });

  it("shows distinct opening and current balances from the API", async () => {
    mocks.get.mockResolvedValueOnce({
      ...wallet,
      openingBalance: "10.10",
      balance: "20.20",
    });
    await ready();
    expect(screen.getByText("10,10 zł")).toBeDefined();
    expect(screen.getByText("20,20 zł")).toBeDefined();
  });

  it("retries a failed load", async () => {
    mocks.get.mockRejectedValueOnce(new ApiError(0, "Brak połączenia."));
    render(<WalletPanel />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Brak połączenia.",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await screen.findByRole("heading", { name: wallet.name });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("normalizes a Polish amount, uses the server response and sends only changed fields", async () => {
    await ready();
    const user = userEvent.setup();
    fireEvent.change(balanceField(), { target: { value: "-250,5" } });
    await user.click(saveButton());
    await screen.findByText("Zmiany zapisane.");
    expect(mocks.update).toHaveBeenCalledWith(
      { openingBalance: "-250.50" },
      expect.any(AbortSignal),
    );
    expect(screen.getAllByText("-250,50 zł")).toHaveLength(2);
    expect(balanceField().value).toBe("-250,50");
    expect(saveButton().disabled).toBe(true);

    mocks.update.mockResolvedValueOnce({
      ...wallet,
      name: "Budżet domowy",
      openingBalance: "-250.50",
      balance: "-250.50",
    });
    fireEvent.change(nameField(), { target: { value: "  Budżet domowy  " } });
    await user.click(saveButton());
    await screen.findByRole("heading", { name: "Budżet domowy" });
    expect(mocks.update).toHaveBeenLastCalledWith(
      { name: "Budżet domowy" },
      expect.any(AbortSignal),
    );
    expect(nameField().value).toBe("Budżet domowy");
  });

  it("does not send empty patches for equivalent values", async () => {
    await ready();
    fireEvent.change(balanceField(), { target: { value: "-0" } });
    fireEvent.change(nameField(), { target: { value: "  Mój portfel  " } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(saveButton().closest("form")!);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["", "0", "name"],
    [" ", "0", "name"],
    ["a".repeat(101), "0", "name"],
    ["Valid", "", "openingBalance"],
    ["Valid", "0,001", "openingBalance"],
    ["Valid", "1000000000000", "openingBalance"],
    ["Valid", "1e2", "openingBalance"],
  ])(
    "rejects invalid settings and focuses the field (%#)",
    async (name, amount, field) => {
      await ready();
      fireEvent.change(nameField(), { target: { value: name } });
      fireEvent.change(balanceField(), { target: { value: amount } });
      fireEvent.submit(saveButton().closest("form")!);
      expect(mocks.update).not.toHaveBeenCalled();
      const invalid = field === "name" ? nameField() : balanceField();
      expect(invalid.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(invalid);
      expect(screen.getByRole("alert").textContent).toContain(
        "Popraw zaznaczone pola",
      );
    },
  );

  it("accepts names of 100 Unicode characters", async () => {
    await ready();
    fireEvent.change(nameField(), { target: { value: "💰".repeat(100) } });
    await userEvent.setup().click(saveButton());
    await screen.findByText("Zmiany zapisane.");
    expect(mocks.update.mock.calls[0][0].name).toBe("💰".repeat(100));
  });

  it("blocks concurrent submissions and keeps the last saved summary until success", async () => {
    const pending = deferred<WalletDto>();
    mocks.update.mockReturnValueOnce(pending.promise);
    await ready();
    fireEvent.change(balanceField(), { target: { value: "0,10" } });
    const form = saveButton().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(nameField().disabled).toBe(true);
    expect(balanceField().disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Zapisywanie…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getAllByText("0,00 zł")).toHaveLength(2);
    await act(async () =>
      pending.resolve({ ...wallet, openingBalance: "0.10", balance: "0.10" }),
    );
    expect(screen.getAllByText("0,10 zł")).toHaveLength(2);
  });

  it.each([0, 400, 403])(
    "preserves inputs after a %s save failure and supports retry",
    async (status) => {
      mocks.update.mockRejectedValueOnce(
        new ApiError(status, "Nie udało się zapisać."),
      );
      await ready();
      fireEvent.change(nameField(), { target: { value: "Nowa nazwa" } });
      fireEvent.change(balanceField(), { target: { value: "-0,01" } });
      const user = userEvent.setup();
      await user.click(saveButton());
      await screen.findByText("Nie udało się zapisać.");
      expect(nameField().value).toBe("Nowa nazwa");
      expect(balanceField().value).toBe("-0,01");
      expect(screen.getByRole("heading", { name: wallet.name })).toBeDefined();
      expect(saveButton().disabled).toBe(false);
      await user.click(saveButton());
      await screen.findByText("Zmiany zapisane.");
      expect(mocks.update).toHaveBeenCalledTimes(2);
    },
  );

  it("clears the wallet on an account change and ignores the old load response", async () => {
    const first = deferred<WalletDto>();
    const second = {
      ...wallet,
      id: "wallet-b",
      name: "Portfel B",
      balance: "0.20",
    };
    mocks.get.mockReturnValueOnce(first.promise).mockResolvedValueOnce(second);
    const { rerender } = render(<WalletPanel />);
    const signal = mocks.get.mock.calls[0][0] as AbortSignal;
    mocks.session = session("b");
    rerender(<WalletPanel />);
    expect(signal.aborted).toBe(true);
    await screen.findByRole("heading", { name: "Portfel B" });
    await act(async () => first.resolve(wallet));
    expect(screen.queryByRole("heading", { name: wallet.name })).toBeNull();
    expect(screen.getByText("0,20 zł")).toBeDefined();
  });

  it("aborts a pending save on an account change and ignores its late response", async () => {
    const pending = deferred<WalletDto>();
    mocks.update.mockReturnValueOnce(pending.promise);
    const { rerender } = await ready();
    fireEvent.change(nameField(), { target: { value: "Portfel A" } });
    fireEvent.submit(saveButton().closest("form")!);
    const signal = mocks.update.mock.calls[0][1] as AbortSignal;
    mocks.get.mockResolvedValueOnce({
      ...wallet,
      id: "wallet-b",
      name: "Portfel B",
    });
    mocks.session = session("b");
    rerender(<WalletPanel />);
    expect(signal.aborted).toBe(true);
    await screen.findByRole("heading", { name: "Portfel B" });
    await act(async () => pending.resolve({ ...wallet, name: "Portfel A" }));
    expect(screen.queryByRole("heading", { name: "Portfel A" })).toBeNull();
    expect(screen.queryByText("Zmiany zapisane.")).toBeNull();
    expect(nameField().value).toBe("Portfel B");
  });

  it("unmounts private data and aborts requests while the session is being checked", async () => {
    const { rerender } = await ready();
    const signal = mocks.get.mock.calls[0][0] as AbortSignal;
    mocks.session = { status: "loading", user: null, error: null };
    rerender(<WalletPanel />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("heading", { name: wallet.name })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });
});
