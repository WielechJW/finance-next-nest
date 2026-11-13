import { analyticsLabels } from "../src/lib/analytics-period";
import type { AnalyticsQuery } from "../src/lib/analytics-types";

export const analyticsQueryFixture: AnalyticsQuery = {
  from: "2026-11-01",
  to: "2026-11-03",
  granularity: "day",
};
export function analyticsFixture(
  query = analyticsQueryFixture,
  amounts = { income: "50.20", expenses: "20.10", periodResult: "30.10" },
) {
  const range = { from: query.from, to: query.to, currency: "PLN" as const };
  const labels = analyticsLabels(query);
  return {
    summary: { ...range, ...amounts },
    categories: {
      ...range,
      totalExpenses: amounts.expenses,
      items:
        amounts.expenses === "0.00"
          ? []
          : [
              {
                categoryId: "10000000-0000-4000-8000-000000000001",
                categoryName: "Jedzenie",
                amount: amounts.expenses,
                percentage: "100.00",
              },
            ],
    },
    trends: {
      ...range,
      granularity: query.granularity,
      items: labels.map((period, index) => ({
        period,
        ...(labels.length === 1
          ? amounts
          : {
              income: index === 0 ? amounts.income : "0.00",
              expenses: index === labels.length - 1 ? amounts.expenses : "0.00",
              periodResult:
                index === 0
                  ? amounts.income
                  : index === labels.length - 1 && amounts.expenses !== "0.00"
                    ? "-" + amounts.expenses
                    : "0.00",
            }),
      })),
    },
  };
}
