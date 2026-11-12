import { describe, expect, it } from "vitest";
import {
  isCalendarDate,
  normalizeTransactionAmount,
  warsawToday,
} from "./transaction-input";

describe("Transaction money", () => {
  it.each([
    ["12,5", "12.50"],
    ["0,01", "0.01"],
    ["0.10", "0.10"],
    [" 123 ", "123.00"],
    ["999999999999,99", "999999999999.99"],
  ])("normalizes %s without losing cents", (value, expected) =>
    expect(normalizeTransactionAmount(value)).toBe(expected),
  );
  it.each([
    "",
    "0",
    "-0,00",
    "-0,01",
    "1,234",
    "1e2",
    "NaN",
    "01,00",
    "1000000000000,00",
  ])("rejects %s as a transaction amount", (value) =>
    expect(() => normalizeTransactionAmount(value)).toThrow(
      "Podaj dodatnią kwotę",
    ),
  );
});

describe("Transaction calendar dates", () => {
  it.each(["0001-01-01", "2024-02-29", "9999-12-31"])("accepts %s", (value) =>
    expect(isCalendarDate(value)).toBe(true),
  );
  it.each([
    "",
    "0000-01-01",
    "10000-01-01",
    "2026-02-29",
    "2026-04-31",
    "2026-11-12T00:00:00Z",
    "2026-11-12\n",
  ])("rejects %s", (value) => expect(isCalendarDate(value)).toBe(false));
  it.each([
    ["2026-01-31T23:30:00.000Z", "2026-02-01"],
    ["2026-07-31T22:30:00.000Z", "2026-08-01"],
    ["2026-10-25T22:30:00.000Z", "2026-10-25"],
    ["2026-10-25T23:30:00.000Z", "2026-10-26"],
  ])("uses Warsaw's day for %s", (instant, expected) =>
    expect(warsawToday(new Date(instant))).toBe(expected),
  );
});
