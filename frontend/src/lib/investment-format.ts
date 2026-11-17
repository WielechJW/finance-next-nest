export function investmentInput(
  value: string,
  scale: number,
  allowZero = false,
): string {
  const normalized = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized))
    throw new Error(
      "Podaj liczbę z kropką lub przecinkiem, bez spacji i wykładnika.",
    );
  const [whole, fraction = ""] = normalized.split(".");
  const integerLimit = scale === 10 ? 18 : 20;
  if (
    whole.length > integerLimit ||
    fraction.length > scale ||
    (!allowZero && BigInt(whole + fraction) === BigInt(0))
  ) {
    throw new Error(
      `Podaj ${allowZero ? "nieujemną" : "dodatnią"} wartość z maksymalnie ${scale} miejscami po przecinku.`,
    );
  }
  return normalized;
}

export function formatInvestment(value: string, minimum = 0): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value))
    throw new Error("Niepoprawna wartość inwestycji.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(minimum, "0");
  return `${negative ? "−" : ""}${new Intl.NumberFormat("pl-PL").format(BigInt(whole))}${decimals ? "," + decimals : ""}`;
}

export function investmentSourceInstant(
  value: string,
  timeZone: string,
): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  const offset = part("timeZoneName").replace("GMT", "") || "Z";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${String(date.getUTCMilliseconds()).padStart(3, "0")}${offset}`;
}
