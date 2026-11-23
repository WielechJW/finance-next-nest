import type { FundamentalMetric } from '../generated/prisma/client.js';
import { InvestmentCalculation as D } from '../investments/precision.js';

type SourceFact = {
  metric: FundamentalMetric;
  amount: string;
  unit: string;
  period: string;
  page: number;
};
type Quarter = {
  id: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  facts: SourceFact[];
};
const DAY = 86_400_000;
const ADDITIVE = [
  'REVENUE',
  'EBIT',
  'NET_INCOME',
  'OPERATING_CASH_FLOW',
] as const;

function dotted(day: string) {
  return day.split('-').reverse().join('.');
}

export function trailingYear(descending: Quarter[]) {
  if (descending.length !== 4) return null;
  const quarters = [...descending].reverse();
  const first = quarters[0]!;
  const last = quarters.at(-1)!;
  const days =
    (Date.parse(last.periodEnd) - Date.parse(first.periodStart)) / DAY + 1;
  if (![364, 365, 366, 371].includes(days)) return null;
  for (const [index, current] of quarters.entries()) {
    if (current.currency !== first.currency) return null;
    const previous = quarters[index - 1];
    if (
      previous &&
      Date.parse(current.periodStart) - Date.parse(previous.periodEnd) !== DAY
    )
      return null;
  }
  const facts = ADDITIVE.flatMap((metric) => {
    const values = quarters.map((quarter) =>
      quarter.facts.find(
        (fact) =>
          fact.metric === metric &&
          fact.period ===
            dotted(quarter.periodStart) + ' – ' + dotted(quarter.periodEnd),
      ),
    );
    const unit = values[0]?.unit;
    if (!unit || !values.every((fact) => fact?.unit === unit)) return [];
    const amount = values
      .reduce((sum, fact) => sum.plus(fact!.amount), new D(0))
      .toFixed();
    return [
      {
        metric,
        amount,
        unit,
        sources: values.map((fact, index) => ({
          reportId: quarters[index]!.id,
          page: fact!.page,
        })),
      },
    ];
  });
  const debt = last.facts.find(
    (fact) =>
      fact.metric === 'LONG_TERM_DEBT' &&
      (fact.period === dotted(last.periodEnd) ||
        (/^[A-Za-z]+ \d{1,2}, \d{4}$/.test(fact.period) &&
          Date.parse(fact.period + ' UTC') === Date.parse(last.periodEnd))),
  );
  return {
    periodStart: first.periodStart,
    periodEnd: last.periodEnd,
    currency: last.currency,
    facts: debt
      ? [
          ...facts,
          {
            metric: debt.metric,
            amount: debt.amount,
            unit: debt.unit,
            sources: [{ reportId: last.id, page: debt.page }],
          },
        ]
      : facts,
  };
}
