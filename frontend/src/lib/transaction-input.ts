import { normalizeMoneyInput } from "./money";

export function normalizeTransactionAmount(value: string): string {
  try {
    const amount = normalizeMoneyInput(value);
    if (amount !== "0.00" && !amount.startsWith("-")) return amount;
  } catch {
    // Use the transaction range rather than the opening balance's signed range.
  }
  throw new Error(
    "Podaj dodatnią kwotę od 0,01 do 999999999999,99, z maksymalnie dwoma miejscami po przecinku.",
  );
}

export function isCalendarDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length !== 10 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  )
    return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function warsawToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
