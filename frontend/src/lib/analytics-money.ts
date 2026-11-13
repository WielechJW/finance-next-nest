import { isMoneyString } from "./money";

export function analyticsCents(value: string): bigint {
  if (!isMoneyString(value)) throw new Error("Nieprawidłowy format kwoty.");
  return BigInt(value.replace(".", ""));
}

/** Finite, relative chart coordinates; labels retain their original exact amounts. */
export function analyticsChartValues(amounts: string[]): number[] {
  const cents = amounts.map(analyticsCents);
  const maximum = cents.reduce(
    (max, value) => (value > max ? value : max),
    BigInt(0),
  );
  return cents.map((value) =>
    maximum === BigInt(0)
      ? 0
      : Number((value * BigInt(1_000_000)) / maximum) / 10_000,
  );
}
