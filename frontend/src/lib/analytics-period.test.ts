import { describe, expect, it } from "vitest";
import {
  analyticsLabels,
  analyticsMonth,
  analyticsQuery,
} from "./analytics-period";
import { analyticsCents, analyticsChartValues } from "./analytics-money";

describe("Analytics period input", () => {
  it.each([
    [false, "2026-03-31T22:00:00Z", "2026-04-01", "2026-04-30"],
    [true, "2026-01-15T12:00:00Z", "2025-12-01", "2025-12-31"],
    [true, "2024-03-15T12:00:00Z", "2024-02-01", "2024-02-29"],
    [false, "2100-02-15T12:00:00Z", "2100-02-01", "2100-02-28"],
  ] as const)(
    "chooses the Warsaw month (%s, %s)",
    (previous, instant, from, to) => {
      expect(analyticsMonth(previous, new Date(instant))).toEqual({ from, to });
    },
  );
  it("fills leap day and DST dates without shifting calendar labels", () => {
    expect(
      analyticsLabels({
        from: "2024-02-28",
        to: "2024-03-01",
        granularity: "day",
      }),
    ).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(
      analyticsLabels({
        from: "2026-03-28",
        to: "2026-03-30",
        granularity: "day",
      }),
    ).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });
  it("labels partial months across the year and calendar bounds", () => {
    expect(
      analyticsLabels({
        from: "2026-11-15",
        to: "2027-02-10",
        granularity: "month",
      }),
    ).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(
      analyticsLabels({
        from: "0001-01-01",
        to: "0001-01-01",
        granularity: "day",
      }),
    ).toEqual(["0001-01-01"]);
    expect(
      analyticsLabels({
        from: "9999-12-01",
        to: "9999-12-31",
        granularity: "month",
      }),
    ).toEqual(["9999-12"]);
  });
  it("accepts exactly 366 daily or 120 monthly points", () => {
    expect(
      analyticsLabels({
        from: "2024-01-01",
        to: "2024-12-31",
        granularity: "day",
      }),
    ).toHaveLength(366);
    expect(
      analyticsLabels({
        from: "2020-01-31",
        to: "2029-12-01",
        granularity: "month",
      }),
    ).toHaveLength(120);
  });
  it.each([
    ["", "2024-02-01", "day"],
    ["2026-02-29", "2026-03-01", "day"],
    ["2024-03-02", "2024-03-01", "day"],
    ["2024-01-01", "2025-01-01", "day"],
    ["2020-01-01", "2030-01-01", "month"],
  ] as const)(
    "rejects invalid or oversized ranges (%s, %s, %s)",
    (from, to, granularity) => {
      expect(() => analyticsQuery(from, to, granularity)).toThrow();
    },
  );
});

describe("Exact analytics amounts and chart coordinates", () => {
  it("keeps cents beyond safe integer precision", () => {
    expect(analyticsCents("999999999999999999.99")).toBe(
      BigInt("99999999999999999999"),
    );
    expect(analyticsCents("-0.10")).toBe(BigInt(-10));
  });
  it("normalizes huge amounts into finite geometry without changing their strings", () => {
    const amounts = [
      "1" + "0".repeat(350) + ".00",
      "2" + "0".repeat(350) + ".00",
    ];
    expect(analyticsChartValues(amounts)).toEqual([50, 100]);
    expect(amounts[0]).toHaveLength(354);
    expect(analyticsChartValues(["0.00", "0.00"])).toEqual([0, 0]);
  });
});
