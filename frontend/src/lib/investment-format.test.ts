import { describe, expect, it } from "vitest";
import {
  formatInvestment,
  investmentInput,
  investmentSourceInstant,
} from "./investment-format";

describe("investment decimal strings", () => {
  it("preserves ten decimal places and amounts above Number precision", () => {
    expect(investmentInput("0,0000000001", 10)).toBe("0.0000000001");
    expect(investmentInput("99999999999999999999,99", 2)).toBe(
      "99999999999999999999.99",
    );
    expect(
      formatInvestment("99999999999999999999.99", 2).replace(/\s/g, ""),
    ).toBe("99999999999999999999,99");
    expect(formatInvestment("-0.0000000001")).toBe("−0,0000000001");
    expect(formatInvestment("6.0000000000")).toBe("6");
    expect(formatInvestment("303.00000000", 2)).toBe("303,00");
  });
  it.each(["1e2", "-1", "01", "1 000", "1.00000000001", "0"])(
    "rejects invalid quantity %s",
    (value) => {
      expect(() => investmentInput(value, 10)).toThrow();
    },
  );
  it("permits zero commissions and rejects fractional cash beyond cents", () => {
    expect(investmentInput("0", 2, true)).toBe("0");
    expect(() => investmentInput("0.001", 2)).toThrow();
  });
  it("preserves the source offset and milliseconds when correcting an instant", () => {
    expect(
      investmentSourceInstant("2026-11-10T10:15:30.123Z", "Europe/Warsaw"),
    ).toBe("2026-11-10T11:15:30.123+01:00");
    expect(
      investmentSourceInstant("2026-07-10T14:00:00.000Z", "America/New_York"),
    ).toBe("2026-07-10T10:00:00.000-04:00");
  });
});
