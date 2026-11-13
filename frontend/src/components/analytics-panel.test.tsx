import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsFixture } from "../../test/analytics";
import { deferred } from "../../test/transactions";
import { ApiError } from "@/lib/api-client";
import type { AnalyticsQuery, AnalyticsSummary } from "@/lib/analytics-types";
import type { SessionState } from "@/lib/session-store";
import { AnalyticsPanel } from "./analytics-panel";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  categories: vi.fn(),
  trends: vi.fn(),
  session: {} as SessionState,
}));
vi.mock("@/lib/analytics-api", () => ({
  analyticsApi: {
    summary: mocks.summary,
    categories: mocks.categories,
    trends: mocks.trends,
  },
}));
vi.mock("./session-provider", () => ({
  useSession: () => ({ state: mocks.session }),
}));
vi.mock("./analytics-charts", () => ({
  CategoryChart: () => <div>Wykres kategorii</div>,
  TrendChart: () => <div>Wykres trendu</div>,
}));
const authenticated = (id: string): SessionState => ({
  status: "authenticated",
  user: { id, email: id + "@example.invalid", createdAt: "2026-11-13" },
  error: null,
});
const summaryRegion = () =>
  screen.getByRole("region", { name: "Podsumowanie okresu" });
async function custom(from: string, to: string, granularity = "day") {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Własny zakres" }));
  fireEvent.change(screen.getByLabelText("Data od"), {
    target: { value: from },
  });
  fireEvent.change(screen.getByLabelText("Data do"), { target: { value: to } });
  fireEvent.change(screen.getByLabelText("Podział trendu"), {
    target: { value: granularity },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Filtry analityki" }));
}
describe("Analytics panel", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/dashboard/analytics");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
    mocks.session = authenticated("a");
    mocks.summary
      .mockReset()
      .mockImplementation(
        async (query: AnalyticsQuery) => analyticsFixture(query).summary,
      );
    mocks.categories
      .mockReset()
      .mockImplementation(
        async (query: AnalyticsQuery) => analyticsFixture(query).categories,
      );
    mocks.trends
      .mockReset()
      .mockImplementation(
        async (query: AnalyticsQuery) => analyticsFixture(query).trends,
      );
  });
  it("loads all reports for the same Warsaw month and exposes exact accessible values", async () => {
    render(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    for (const method of [mocks.summary, mocks.categories, mocks.trends])
      expect(method).toHaveBeenCalledWith(
        { from: "2026-11-01", to: "2026-11-30", granularity: "day" },
        expect.any(AbortSignal),
      );
    expect(
      screen.getByText(/Saldo początkowe nie jest wliczane/),
    ).toBeDefined();
    await userEvent.setup().click(screen.getByText("Pokaż dane kategorii"));
    const table = screen.getByRole("table", {
      name: /Wydatki według kategorii/,
    });
    expect(
      within(table).getByRole("rowheader", { name: "Jedzenie" }),
    ).toBeDefined();
    expect(within(table).getByText("20,10 zł")).toBeDefined();
    await userEvent.setup().click(screen.getByText("Pokaż dane trendu"));
    expect(
      screen.getByRole("table", { name: /Przychody i wydatki w czasie/ }),
    ).toBeDefined();
  });
  it("keeps custom edits as a draft until apply and changes all reports together", async () => {
    render(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Własny zakres" }));
    fireEvent.change(screen.getByLabelText("Data od"), {
      target: { value: "2024-02-01" },
    });
    fireEvent.change(screen.getByLabelText("Data do"), {
      target: { value: "2024-02-29" },
    });
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Podział trendu"), {
      target: { value: "month" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Filtry analityki" }));
    await waitFor(() => expect(mocks.trends).toHaveBeenCalledTimes(2));
    for (const method of [mocks.summary, mocks.categories, mocks.trends])
      expect(method).toHaveBeenLastCalledWith(
        { from: "2024-02-01", to: "2024-02-29", granularity: "month" },
        expect.any(AbortSignal),
      );
    expect(
      screen.getByText(
        "Podział miesięczny · Okresy bez operacji mają wartość zero.",
      ),
    ).toBeDefined();
  });
  it("applies presets immediately and rejects invalid or oversized drafts without requests", async () => {
    render(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Poprzedni miesiąc" }));
    await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(2));
    expect(mocks.summary.mock.calls[1][0]).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    await custom("2026-11-30", "2026-11-01");
    expect(screen.getByRole("alert").textContent).toContain("Data od");
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    await custom("2024-01-01", "2025-01-01");
    expect(screen.getByRole("alert").textContent).toContain("366 dni");
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    await custom("2020-01-01", "2030-01-01", "month");
    expect(screen.getByRole("alert").textContent).toContain("120 miesięcy");
  });
  it("keeps successful reports when one fails and retries only that section", async () => {
    mocks.categories.mockRejectedValueOnce(
      new ApiError(503, "Spróbuj ponownie."),
    );
    render(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    expect(await screen.findByText("Wykres trendu")).toBeDefined();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Ponów kategorie" }));
    await screen.findByText("Wykres kategorii");
    expect(mocks.categories).toHaveBeenCalledTimes(2);
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    expect(mocks.trends).toHaveBeenCalledTimes(1);
  });
  it("clears old values immediately and ignores a late response after changing the period", async () => {
    const old = deferred<AnalyticsSummary>();
    mocks.summary.mockReturnValueOnce(old.promise);
    render(<AnalyticsPanel />);
    const signal = mocks.summary.mock.calls[0][1] as AbortSignal;
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Poprzedni miesiąc" }));
    await within(summaryRegion()).findByText("30,10 zł");
    expect(signal.aborted).toBe(true);
    await act(async () =>
      old.resolve({
        ...analyticsFixture().summary,
        income: "999.99",
        expenses: "0.00",
        periodResult: "999.99",
      }),
    );
    expect(within(summaryRegion()).queryByText("999,99 zł")).toBeNull();
  });
  it("shows loading instead of cached values when applying A, B, A rapidly", async () => {
    render(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    const next = deferred<AnalyticsSummary>();
    mocks.summary
      .mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(next.promise);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Poprzedni miesiąc" }));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Bieżący miesiąc" }));
    expect(within(summaryRegion()).getByRole("status").textContent).toBe(
      "Pobieranie podsumowania…",
    );
    expect(within(summaryRegion()).queryByText("30,10 zł")).toBeNull();
    await act(async () => next.resolve(analyticsFixture().summary));
    await within(summaryRegion()).findByText("30,10 zł");
  });
  it("drops the previous account and ignores all late responses after switching users", async () => {
    const old = deferred<AnalyticsSummary>();
    mocks.summary.mockReturnValueOnce(old.promise);
    const { rerender } = render(<AnalyticsPanel />);
    const signal = mocks.summary.mock.calls[0][1] as AbortSignal;
    mocks.session = authenticated("b");
    rerender(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    expect(signal.aborted).toBe(true);
    await act(async () =>
      old.resolve({
        ...analyticsFixture().summary,
        income: "999.99",
        expenses: "0.00",
        periodResult: "999.99",
      }),
    );
    expect(screen.queryByText("999,99 zł")).toBeNull();
    expect(mocks.categories).toHaveBeenCalledTimes(2);
    expect(mocks.trends).toHaveBeenCalledTimes(2);
  });
  it("shows zero cards and an empty expense message while preserving the zero trend", async () => {
    const zero = { income: "0.00", expenses: "0.00", periodResult: "0.00" };
    mocks.summary.mockImplementation(
      async (query) => analyticsFixture(query, zero).summary,
    );
    mocks.categories.mockImplementation(
      async (query) => analyticsFixture(query, zero).categories,
    );
    mocks.trends.mockImplementation(
      async (query) => analyticsFixture(query, zero).trends,
    );
    render(<AnalyticsPanel />);
    await screen.findByText("Brak transakcji w wybranym okresie.");
    expect(within(summaryRegion()).getAllByText("0,00 zł")).toHaveLength(3);
    expect(screen.getByText("Brak wydatków w wybranym okresie.")).toBeDefined();
    expect(screen.getByText("Wykres trendu")).toBeDefined();
  });
  it("does not request reports without an authenticated session", () => {
    mocks.session = { status: "unauthenticated", user: null, error: null };
    render(<AnalyticsPanel />);
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(mocks.trends).not.toHaveBeenCalled();
  });
  it("restores the applied range after remount and refreshes it instead of keeping old data", async () => {
    const first = render(<AnalyticsPanel />);
    await within(summaryRegion()).findByText("30,10 zł");
    await custom("2024-02-01", "2024-02-29", "month");
    await waitFor(() => expect(mocks.trends).toHaveBeenCalledTimes(2));
    first.unmount();
    render(<AnalyticsPanel />);
    await waitFor(() => expect(mocks.trends).toHaveBeenCalledTimes(3));
    expect(mocks.trends).toHaveBeenLastCalledWith(
      { from: "2024-02-01", to: "2024-02-29", granularity: "month" },
      expect.any(AbortSignal),
    );
    expect((screen.getByLabelText("Data od") as HTMLInputElement).value).toBe(
      "2024-02-01",
    );
  });
});
