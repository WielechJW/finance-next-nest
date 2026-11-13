import type { Currency } from '../generated/prisma/client.js';
import type { AnalyticsPeriod } from './analytics-period.js';

export interface AnalyticsSummaryResponse extends AnalyticsPeriod {
  currency: Currency;
  income: string;
  expenses: string;
  periodResult: string;
}
