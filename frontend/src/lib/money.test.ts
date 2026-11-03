import { describe, expect, it } from "vitest";
import { formatPLN, isMoneyString, normalizeMoneyInput } from "./money";

describe("Money input", () => {
  it.each([
    ["123", "123.00"],
    ["123,4", "123.40"],
    ["123,45", "123.45"],
    ["123.45", "123.45"],
    [" -0,05 ", "-0.05"],
    ["0,1", "0.10"],
    ["0,2", "0.20"],
    ["-0", "0.00"],
    ["-0,00", "0.00"],
    ["999999999999,99", "999999999999.99"],
    ["-999999999999,99", "-999999999999.99"],
  ])("normalizes %s to %s without changing cents", (input, expected) => {
    expect(normalizeMoneyInput(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "1,234",
    "-1.234",
    "1e2",
    "NaN",
    "Infinity",
    "+1,00",
    "01,00",
    "1 234,50",
    "1,234.50",
    ".10",
    "1,",
    "--1",
    "0x10",
    "1000000000000",
    "-1000000000000,00",
  ])("rejects an ambiguous, invalid or out-of-range input: %s", (input) => {
    expect(() => normalizeMoneyInput(input)).toThrow("Podaj kwotę");
  });

  it.each([
    null,
    0,
    0.1,
    {},
    [],
    "1",
    "1.0",
    "1,00",
    "01.00",
    "1.001",
    "1.00\n",
  ])("rejects a noncanonical API amount (%#)", (value) =>
    expect(isMoneyString(value)).toBe(false),
  );
});

describe("PLN presentation", () => {
  it.each([
    ["0.00", "0,00\u00a0zł"],
    ["-0.00", "0,00\u00a0zł"],
    ["0.10", "0,10\u00a0zł"],
    ["0.20", "0,20\u00a0zł"],
    ["-0.01", "-0,01\u00a0zł"],
    ["1234.50", "1\u00a0234,50\u00a0zł"],
    ["-250.50", "-250,50\u00a0zł"],
    ["999999999999.99", "999\u00a0999\u00a0999\u00a0999,99\u00a0zł"],
    ["-999999999999.99", "-999\u00a0999\u00a0999\u00a0999,99\u00a0zł"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatPLN(value)).toBe(expected);
  });

  it("rejects malformed values instead of rounding them for display", () => {
    expect(() => formatPLN("0.001")).toThrow("Nieprawidłowy format kwoty");
  });
});
