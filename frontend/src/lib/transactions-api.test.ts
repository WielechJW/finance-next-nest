import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, transaction, historyPage } from "../../test/transactions";
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
  it("serializes only active filters and pagination, and validates the returned page", async () => {
    const data = historyPage(2, 21);
    fetchMock.mockResolvedValueOnce(json(data));
    expect(
      await transactionsApi.list({
        type: "EXPENSE",
        categoryId: transaction.categoryId,
        from: "2026-11-01",
        to: "2026-11-30",
        page: 2,
        pageSize: 20,
      }),
    ).toEqual(data);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/transactions");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      type: "EXPENSE",
      categoryId: transaction.categoryId,
      from: "2026-11-01",
      to: "2026-11-30",
      page: "2",
      pageSize: "20",
    });
    expect(init).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it("omits the query string for an unfiltered default request", async () => {
    fetchMock.mockResolvedValueOnce(json(historyPage(1, 0)));
    await transactionsApi.list();
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://localhost:3001/transactions",
    );
  });
  it("PATCHes only allowed fields, preserves omitted fields and explicitly clears a note", async () => {
    fetchMock.mockResolvedValueOnce(json(transaction));
    const input = {
      amount: "12.50",
      note: null,
      walletId: "foreign",
      id: "foreign",
    };
    expect(await transactionsApi.update(transaction.id, input)).toEqual(
      transaction,
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://localhost:3001/transactions/${transaction.id}`);
    expect(init).toMatchObject({
      method: "PATCH",
      credentials: "include",
      cache: "no-store",
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      amount: "12.50",
      note: null,
    });
  });
  it.each([
    { ...transaction, amount: "invalid" },
    { ...transaction, id: "20000000-0000-4000-8000-000000000002" },
  ])(
    "rejects malformed or mismatched PATCH responses (%#)",
    async (payload) => {
      fetchMock.mockResolvedValueOnce(json(payload));
      await expect(
        transactionsApi.update(transaction.id, { title: "Zmiana" }),
      ).rejects.toMatchObject({ status: 502 });
    },
  );
  it("DELETEs with session cookies and accepts an empty 204 response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      transactionsApi.remove(transaction.id),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      `http://localhost:3001/transactions/${transaction.id}`,
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      }),
    ]);
  });
  it.each(["update", "remove"] as const)(
    "propagates cancellation during %s",
    async (operation) => {
      const controller = new AbortController();
      fetchMock.mockImplementationOnce(async (_input, init) => {
        controller.abort();
        expect(init?.signal?.aborted).toBe(true);
        return operation === "update"
          ? json(transaction)
          : new Response(null, { status: 204 });
      });
      await expect(
        operation === "update"
          ? transactionsApi.update(
              transaction.id,
              { title: "Zmiana" },
              controller.signal,
            )
          : transactionsApi.remove(transaction.id, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    },
  );
  it.each([
    null,
    {},
    { ...historyPage(), page: "1" },
    { ...historyPage(), total: -1 },
    { ...historyPage(), pageSize: 101 },
    { ...historyPage(), page: 2 },
    { ...historyPage(), total: 2 },
    { ...historyPage(), items: [{ ...transaction, amount: 12.5 }] },
    { ...historyPage(1, 2), items: [transaction, transaction] },
  ])(
    "rejects malformed history or inconsistent pagination (%#)",
    async (payload) => {
      fetchMock.mockResolvedValueOnce(json(payload));
      await expect(transactionsApi.list()).rejects.toMatchObject({
        status: 502,
      });
    },
  );

  it.each(["categories", "create", "history"] as const)(
    "notifies the session about a 401 during %s",
    async (operation) => {
      const listener = vi.fn();
      window.addEventListener(UNAUTHORIZED_EVENT, listener);
      try {
        fetchMock.mockResolvedValueOnce(json({ message: "Zaloguj się." }, 401));
        await expect(
          operation === "categories"
            ? transactionsApi.getCategories()
            : operation === "history"
              ? transactionsApi.list()
              : transactionsApi.create({ ...transaction, note: undefined }),
        ).rejects.toMatchObject({ status: 401 });
        expect(listener).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener(UNAUTHORIZED_EVENT, listener);
      }
    },
  );
});
