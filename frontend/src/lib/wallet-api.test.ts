import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHORIZED_EVENT } from "./api-client";
import { walletApi } from "./wallet-api";

const wallet = {
  id: "wallet-id",
  name: "Mój portfel",
  currency: "PLN",
  openingBalance: "0.00",
  balance: "0.00",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("Wallet API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  });

  it("loads a wallet with cookies and no cache, selecting only public fields", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ...wallet, userId: "private-owner" }),
    );
    expect(await walletApi.get()).toEqual(wallet);
    expect(fetchMock.mock.calls[0]).toEqual([
      "http://localhost:3001/wallet",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    ]);
  });

  it("patches only allowed provided fields and reads the authoritative response", async () => {
    const updated = { ...wallet, openingBalance: "-0.10", balance: "30.00" };
    fetchMock.mockResolvedValueOnce(json(updated));
    const input = {
      openingBalance: "-0.10",
      userId: "other-user",
      balance: "999.99",
    };
    expect(await walletApi.update(input)).toEqual(updated);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({
      openingBalance: "-0.10",
    });
    expect(new Headers(init!.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it.each(["2999999999999.97", "-2999999999999.97"])(
    "accepts the calculated balance %s beyond the individual amount range",
    async (balance) => {
      const loaded = { ...wallet, balance };
      fetchMock.mockResolvedValueOnce(json(loaded));
      expect(await walletApi.get()).toEqual(loaded);
    },
  );

  it.each([
    null,
    [],
    {},
    { ...wallet, id: "" },
    { ...wallet, name: " " },
    { ...wallet, currency: "EUR" },
    { ...wallet, openingBalance: 0 },
    { ...wallet, openingBalance: "1000000000000.00" },
    { ...wallet, openingBalance: "-1000000000000.00" },
    { ...wallet, balance: "0,00" },
    { ...wallet, balance: "0.001" },
    { ...wallet, balance: "1.00\n" },
  ])("rejects invalid wallet responses (%#)", async (payload) => {
    fetchMock.mockResolvedValueOnce(json(payload));
    await expect(walletApi.get()).rejects.toMatchObject({ status: 502 });
  });

  it.each(["get", "update"] as const)(
    "notifies the session about a 401 during %s",
    async (method) => {
      const listener = vi.fn();
      window.addEventListener(UNAUTHORIZED_EVENT, listener);
      try {
        fetchMock.mockResolvedValueOnce(json({ message: "Zaloguj się." }, 401));
        const operation =
          method === "get"
            ? walletApi.get()
            : walletApi.update({ name: "Nowa nazwa" });
        await expect(operation).rejects.toMatchObject({ status: 401 });
        expect(listener).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener(UNAUTHORIZED_EVENT, listener);
      }
    },
  );

  it("cancels an obsolete request", async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const controller = new AbortController();
    const pending = walletApi.get(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
