import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsFixture,
  analyticsQueryFixture as query,
} from "../../test/analytics";
import { analyticsApi } from "./analytics-api";
import { UNAUTHORIZED_EVENT } from "./api-client";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
describe("Analytics API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  });
  it.each(["summary", "categories", "trends"] as const)(
    "reads %s with the exact applied range, cookies and cancellation",
    async (method) => {
      const data = analyticsFixture()[method];
      fetchMock.mockResolvedValueOnce(json({ ...data, userId: "private" }));
      expect(await analyticsApi[method](query)).toEqual(data);
      const [url, options] = fetchMock.mock.calls[0];
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/analytics/" + method);
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        from: query.from,
        to: query.to,
        ...(method === "trends" ? { granularity: "day" } : {}),
      });
      expect(options).toMatchObject({
        credentials: "include",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      });
    },
  );
  it.each(["summary", "categories", "trends"] as const)(
    "rejects a stale range or wrong currency from %s",
    async (method) => {
      for (const extra of [
        { from: "2025-01-01" },
        { to: "2025-01-01" },
        { currency: "EUR" },
      ]) {
        fetchMock.mockResolvedValueOnce(
          json({ ...analyticsFixture()[method], ...extra }),
        );
        await expect(analyticsApi[method](query)).rejects.toMatchObject({
          status: 502,
        });
      }
    },
  );
  it.each([
    null,
    [],
    { income: 50.2 },
    { expenses: "-1.00" },
    { periodResult: "30.11" },
  ])(
    "rejects malformed or inconsistent summary amounts (%#)",
    async (extra) => {
      fetchMock.mockResolvedValueOnce(
        json(
          extra === null || Array.isArray(extra)
            ? extra
            : { ...analyticsFixture().summary, ...extra },
        ),
      );
      await expect(analyticsApi.summary(query)).rejects.toMatchObject({
        status: 502,
      });
    },
  );
  it("preserves large exact amounts and accepts zero reports", async () => {
    const big = analyticsFixture(query, {
      income: "999999999999999999.99",
      expenses: "0.00",
      periodResult: "999999999999999999.99",
    });
    fetchMock.mockResolvedValueOnce(json(big.summary));
    expect((await analyticsApi.summary(query)).income).toBe(
      "999999999999999999.99",
    );
    fetchMock.mockResolvedValueOnce(json(big.categories));
    expect((await analyticsApi.categories(query)).items).toEqual([]);
  });
  it("rejects inconsistent categories, duplicate IDs and invalid shares", async () => {
    const data = analyticsFixture().categories;
    for (const extra of [
      { totalExpenses: "0.00" },
      { items: [data.items[0], data.items[0]] },
      { items: [{ ...data.items[0], categoryId: "invalid" }] },
      { items: [{ ...data.items[0], percentage: "100.01" }] },
      { items: [{ ...data.items[0], percentage: "-1.00" }] },
      { items: [{ ...data.items[0], amount: "0.00" }] },
    ]) {
      fetchMock.mockResolvedValueOnce(json({ ...data, ...extra }));
      await expect(analyticsApi.categories(query)).rejects.toMatchObject({
        status: 502,
      });
    }
  });
  it("rejects missing, duplicated, out-of-order or wrong-granularity trend points", async () => {
    const data = analyticsFixture().trends;
    for (const extra of [
      { granularity: "month" },
      { items: data.items.slice(1) },
      { items: data.items.toReversed() },
      { items: data.items.map(() => data.items[0]) },
      {
        items: [
          { ...data.items[0], periodResult: "99.99" },
          ...data.items.slice(1),
        ],
      },
    ]) {
      fetchMock.mockResolvedValueOnce(json({ ...data, ...extra }));
      await expect(analyticsApi.trends(query)).rejects.toMatchObject({
        status: 502,
      });
    }
  });
  it("reads partial monthly series using monthly labels", async () => {
    const monthly = {
      from: "2026-11-15",
      to: "2027-01-10",
      granularity: "month" as const,
    };
    const data = analyticsFixture(monthly).trends;
    fetchMock.mockResolvedValueOnce(json(data));
    expect(await analyticsApi.trends(monthly)).toEqual(data);
  });
  it.each(["summary", "categories", "trends"] as const)(
    "notifies the session when %s returns 401",
    async (method) => {
      const listener = vi.fn();
      window.addEventListener(UNAUTHORIZED_EVENT, listener);
      try {
        fetchMock.mockResolvedValueOnce(json({ message: "Zaloguj się." }, 401));
        await expect(analyticsApi[method](query)).rejects.toMatchObject({
          status: 401,
        });
        expect(listener).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener(UNAUTHORIZED_EVENT, listener);
      }
    },
  );
  it("ignores an aborted response even when fetch completes late", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const pending = analyticsApi.summary(query, controller.signal);
    controller.abort();
    resolve(json(analyticsFixture().summary));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
