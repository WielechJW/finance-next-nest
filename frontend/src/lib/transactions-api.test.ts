import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, transaction } from "../../test/transactions";
import { UNAUTHORIZED_EVENT } from "./api-client";
import { transactionsApi } from "./transactions-api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("Transaction API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  });
  it("loads and selects category fields with cookies and no cache", async () => {
    fetchMock.mockResolvedValueOnce(
      json(categories.map((item) => ({ ...item, private: "ignored" }))),
    );
    expect(await transactionsApi.getCategories()).toEqual(categories);
    expect(fetchMock.mock.calls[0]).toEqual([
      "http://localhost:3001/categories",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    ]);
  });
  it.each([
    null,
    {},
    [{ ...categories[0], type: "OTHER" }],
    [{ ...categories[0], id: "invalid" }],
    [categories[0], categories[0]],
  ])("rejects malformed category collections (%#)", async (payload) => {
    fetchMock.mockResolvedValueOnce(json(payload));
    await expect(transactionsApi.getCategories()).rejects.toMatchObject({
      status: 502,
    });
  });
  it("sends only editable fields and preserves the exact money/date response", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ...transaction, userId: "private" }, 201),
    );
    const input = {
      type: transaction.type,
      amount: "12.50",
      categoryId: transaction.categoryId,
      title: "Zakupy",
      occurredOn: "2026-11-12",
      walletId: "foreign",
    };
    expect(await transactionsApi.create(input)).toEqual(transaction);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:3001/transactions");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      type: "EXPENSE",
      amount: "12.50",
      categoryId: transaction.categoryId,
      title: "Zakupy",
      occurredOn: "2026-11-12",
    });
  });
  it.each([
    { ...transaction, amount: 12.5 },
    { ...transaction, amount: "0.00" },
    { ...transaction, amount: "-1.00" },
    { ...transaction, occurredOn: "2026-02-30" },
    { ...transaction, categoryId: "invalid" },
    { ...transaction, note: {} },
    { ...transaction, createdAt: "invalid" },
  ])("rejects a malformed created transaction (%#)", async (payload) => {
    fetchMock.mockResolvedValueOnce(json(payload, 201));
    await expect(
      transactionsApi.create({ ...transaction, note: undefined }),
    ).rejects.toMatchObject({ status: 502 });
  });
  it.each(["categories", "create"] as const)(
    "notifies the session about a 401 during %s",
    async (operation) => {
      const listener = vi.fn();
      window.addEventListener(UNAUTHORIZED_EVENT, listener);
      try {
        fetchMock.mockResolvedValueOnce(json({ message: "Zaloguj się." }, 401));
        await expect(
          operation === "categories"
            ? transactionsApi.getCategories()
            : transactionsApi.create({ ...transaction, note: undefined }),
        ).rejects.toMatchObject({ status: 401 });
        expect(listener).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener(UNAUTHORIZED_EVENT, listener);
      }
    },
  );
});
