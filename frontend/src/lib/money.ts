const moneyPattern = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/;
const inputPattern = /^(-?)(0|[1-9]\d{0,11})(?:[.,](\d{1,2}))?$/;
const integers = new Intl.NumberFormat("pl-PL", {
  useGrouping: "always",
  maximumFractionDigits: 0,
});

export function isMoneyString(value: unknown): value is string {
  return typeof value === "string" && moneyPattern.test(value);
}

export function normalizeMoneyInput(value: string): string {
  const match = inputPattern.exec(value.trim());
  if (!match) {
    throw new Error(
      "Podaj kwotę od -999999999999,99 do 999999999999,99, z maksymalnie dwoma miejscami po przecinku.",
    );
  }
  const [, sign, whole, fraction = ""] = match;
  const cents = fraction.padEnd(2, "0");
  return whole === "0" && cents === "00" ? "0.00" : `${sign}${whole}.${cents}`;
}

export function formatPLN(value: string): string {
  if (!isMoneyString(value)) throw new Error("Nieprawidłowy format kwoty.");
  const negative = value.startsWith("-");
  const [whole, cents] = (negative ? value.slice(1) : value).split(".");
  const sign = negative && (whole !== "0" || cents !== "00") ? "-" : "";
  return `${sign}${integers.format(BigInt(whole))},${cents}\u00a0zł`;
}
