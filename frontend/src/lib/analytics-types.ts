export type AnalyticsGranularity = "day" | "month";
export interface AnalyticsPeriod {
  from: string;
  to: string;
}
export interface AnalyticsQuery extends AnalyticsPeriod {
  granularity: AnalyticsGranularity;
}
export interface AnalyticsSummary extends AnalyticsPeriod {
  currency: "PLN";
  income: string;
  expenses: string;
  periodResult: string;
}
export interface AnalyticsCategory {
  categoryId: string;
  categoryName: string;
  amount: string;
  percentage: string;
}
export interface AnalyticsCategories extends AnalyticsPeriod {
  currency: "PLN";
  totalExpenses: string;
  items: AnalyticsCategory[];
}
export interface AnalyticsTrendPoint {
  period: string;
  income: string;
  expenses: string;
  periodResult: string;
}
export interface AnalyticsTrends extends AnalyticsQuery {
  currency: "PLN";
  items: AnalyticsTrendPoint[];
}
