import { isCalendarDate, warsawToday } from "./transaction-input";
import type {
  AnalyticsGranularity,
  AnalyticsPeriod,
  AnalyticsQuery,
} from "./analytics-types";

export function analyticsMonth(
  previous = false,
  now = new Date(),
): AnalyticsPeriod {
  const today = warsawToday(now);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7)) - (previous ? 1 : 0);
  if (month === 0) {
    month = 12;
    year--;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${days[month - 1]}` };
}

export function analyticsQuery(
  from: string,
  to: string,
  granularity: AnalyticsGranularity,
): AnalyticsQuery {
  if (!isCalendarDate(from) || !isCalendarDate(to))
    throw new Error("Podaj obie istniejące daty od 0001-01-01 do 9999-12-31.");
  if (from > to)
    throw new Error("Data od nie może być późniejsza niż data do.");
  if (granularity !== "day" && granularity !== "month")
    throw new Error("Wybierz podział dzienny lub miesięczny.");
  // UTC midnight is a fixed counting anchor for unchanged calendar labels.
  // No local time or DST arithmetic is used.
  const days =
    (Date.parse(to + "T00:00:00.000Z") - Date.parse(from + "T00:00:00.000Z")) /
      86_400_000 +
    1;
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(5, 7)) +
    1;
  if (granularity === "day" && days > 366)
    throw new Error(
      "Podział dzienny obejmuje najwyżej 366 dni. Skróć zakres lub wybierz Miesięcznie.",
    );
  if (granularity === "month" && months > 120)
    throw new Error(
      "Podział miesięczny obejmuje najwyżej 120 miesięcy. Skróć zakres.",
    );
  return { from, to, granularity };
}

export function analyticsLabels(query: AnalyticsQuery): string[] {
  const { from, to, granularity } = analyticsQuery(
    query.from,
    query.to,
    query.granularity,
  );
  const labels: string[] = [];
  if (granularity === "day") {
    const last = Date.parse(to + "T00:00:00.000Z");
    for (
      let date = Date.parse(from + "T00:00:00.000Z");
      date <= last;
      date += 86_400_000
    )
      labels.push(new Date(date).toISOString().slice(0, 10));
  } else {
    const first = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
    const last = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1;
    for (let month = first; month <= last; month++)
      labels.push(
        `${String(Math.floor(month / 12)).padStart(4, "0")}-${String((month % 12) + 1).padStart(2, "0")}`,
      );
  }
  return labels;
}

export function analyticsDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return day ? `${day}.${month}.${year}` : `${month}.${year}`;
}
