import { InvestmentCalculation as D } from '../investments/precision.js';
import type { ReportMetric } from './report-summary.js';

export function calculateOperatingMargin(facts: ReportMetric[]) {
  const revenue = facts.find(
    (fact) => fact.state === 'verified' && fact.metric === 'revenue',
  );
  const ebit = facts.find(
    (fact) => fact.state === 'verified' && fact.metric === 'ebit',
  );
  if (
    revenue?.state !== 'verified' ||
    ebit?.state !== 'verified' ||
    revenue.unit !== ebit.unit ||
    revenue.period !== ebit.period ||
    revenue.scope !== ebit.scope ||
    new D(revenue.amount).lte(0)
  )
    return null;

  return {
    percent: new D(ebit.amount).div(revenue.amount).times(100).toFixed(2),
    period: revenue.period,
    pages: [...new Set([revenue.page, ebit.page])].sort((a, b) => a - b),
  };
}
