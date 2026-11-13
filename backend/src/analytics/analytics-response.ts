import type { Currency } from '../generated/prisma/client.js';
import type { AnalyticsPeriod } from './analytics-period.js';

export interface AnalyticsSummaryResponse extends AnalyticsPeriod {
  currency: Currency;
  income: string;
  expenses: string;
  periodResult: string;
}

export interface AnalyticsCategoryResponse {
  categoryId: string;
  categoryName: string;
  amount: string;
  percentage: string;
}

export interface AnalyticsCategoriesResponse extends AnalyticsPeriod {
  currency: Currency;
  totalExpenses: string;
  items: AnalyticsCategoryResponse[];
}
