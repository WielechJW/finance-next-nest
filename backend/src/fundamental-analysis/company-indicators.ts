import type { FundamentalMetric } from '../generated/prisma/client.js';
import { InvestmentCalculation as D } from '../investments/precision.js';

type Fact = {
  metric: FundamentalMetric;
  amount: string;
  unit: string;
  page: number;
};
type Report = {
  id: string;
  periodStart: string;
  periodEnd: string;
  publishedOn: string;
  periodKind: 'ANNUAL' | 'QUARTERLY';
  currency: string;
  facts: Fact[];
};
type Quote = {
  status: string;
  price: { close: string; currency: string; sessionOn: string | null } | null;
};
const DAY = 86_400_000;

type Evidence = {
  amount: InstanceType<typeof D>;
  source: { reportId: string; page: number };
};

function value(
  report: Report | undefined,
  metric: FundamentalMetric,
  perShare = false,
): Evidence | undefined {
  const fact = report?.facts.find((item) => item.metric === metric);
  if (!report || !fact) return undefined;
  const pattern = perShare
    ? /^(PLN|USD|EUR|\$) \/ akcję$/
    : /^(mln|tys\.) (PLN|USD|EUR|\$)$/;
  const unit = pattern.exec(fact.unit);
  if (!unit) return undefined;
  const currency = unit[perShare ? 1 : 2];
  if ((currency === '$' ? 'USD' : currency) !== report.currency)
    return undefined;
  const scale = perShare ? 1 : unit[1] === 'mln' ? 1_000_000 : 1_000;
  return {
    amount: new D(fact.amount).times(scale),
    source: { reportId: report.id, page: fact.page },
  };
}

function missing(reason: string) {
  return { value: null, reason, sources: [] };
}

function computed(result: InstanceType<typeof D>, facts: Evidence[]) {
  const sources = new Map(
    facts.map(({ source }) => [source.reportId + ':' + source.page, source]),
  );
  return {
    value: result.toFixed(2),
    reason: null,
    sources: [...sources.values()],
  };
}

function length(report: Report) {
  return (
    (Date.parse(report.periodEnd) - Date.parse(report.periodStart)) / DAY + 1
  );
}

function percentage(
  numerator: Evidence | undefined,
  denominator: Evidence | undefined,
  missingReason: string,
  offset = 0,
) {
  if (!numerator || !denominator) return missing(missingReason);
  if (denominator.amount.lte(0)) return missing('Mianownik musi być dodatni.');
  return computed(
    numerator.amount.div(denominator.amount).minus(offset).times(100),
    [numerator, denominator],
  );
}

function returnOnEquity(
  annual: boolean,
  contiguous: boolean,
  profit?: Evidence,
  opening?: Evidence,
  closing?: Evidence,
) {
  if (!annual || !contiguous || !profit || !opening || !closing)
    return missing(
      'Potrzebny jest roczny zysk netto oraz kapitał na początku i końcu okresu.',
    );
  if (opening.amount.lte(0) || closing.amount.lte(0))
    return missing(
      'Kapitał własny musi być dodatni na początku i końcu okresu.',
    );
  return computed(
    profit.amount.div(opening.amount.plus(closing.amount).div(2)).times(100),
    [profit, opening, closing],
  );
}

export function calculateCompanyIndicators(
  report: Report,
  reports: Report[],
  quote: Quote,
  splitDates: string[],
) {
  const previous = reports.find((candidate) => {
    if (
      candidate.periodKind !== report.periodKind ||
      candidate.currency !== report.currency
    )
      return false;
    const endGap =
      (Date.parse(report.periodEnd) - Date.parse(candidate.periodEnd)) / DAY;
    return (
      Math.abs(endGap - 365) <= 7 &&
      Math.abs(length(candidate) - length(report)) <= 1
    );
  });
  const revenue = value(report, 'REVENUE');
  const netIncome = value(report, 'NET_INCOME');
  const annual =
    report.periodKind === 'ANNUAL' &&
    [364, 365, 366, 371].includes(length(report));
  const endOfPreviousDay = new Date(Date.parse(report.periodStart) - DAY)
    .toISOString()
    .slice(0, 10);

  function priceRatio(metric: 'DILUTED_EPS' | 'BOOK_VALUE_PER_SHARE') {
    if (metric === 'DILUTED_EPS' && !annual)
      return missing('Potrzebny jest raport obejmujący 12 miesięcy.');
    const input = value(report, metric, true);
    if (!input)
      return missing(
        metric === 'DILUTED_EPS'
          ? 'Brak rozwodnionego EPS.'
          : 'Brak wartości księgowej na akcję.',
      );
    if (input.amount.lte(0)) return missing('Mianownik musi być dodatni.');
    const price = quote.price;
    if (
      !price?.sessionOn ||
      quote.status !== 'fresh' ||
      new D(price.close).lte(0)
    )
      return missing('Brak aktualnego kursu zamknięcia.');
    if (price.currency !== report.currency)
      return missing('Kurs i raport mają różne waluty.');
    const sessionOn = price.sessionOn;
    if (sessionOn < report.publishedOn)
      return missing('Raport opublikowano po sesji użytego kursu.');
    if (
      splitDates.some(
        (date) => date > report.periodEnd && date <= sessionOn,
      )
    )
      return missing(
        'Po okresie raportu zapisano split. Dane na akcję wymagają uzgodnienia.',
      );
    return computed(new D(price.close).div(input.amount), [input]);
  }

  return {
    priceEarnings: priceRatio('DILUTED_EPS'),
    priceBook: priceRatio('BOOK_VALUE_PER_SHARE'),
    roe: returnOnEquity(
      annual,
      previous?.periodEnd === endOfPreviousDay,
      netIncome,
      value(previous, 'TOTAL_EQUITY'),
      value(report, 'TOTAL_EQUITY'),
    ),
    operatingMargin: percentage(
      value(report, 'EBIT'),
      revenue,
      'Brak EBIT-u lub przychodów.',
    ),
    netMargin: percentage(
      netIncome,
      revenue,
      'Brak zysku netto lub przychodów.',
    ),
    revenueGrowth: percentage(
      revenue,
      value(previous, 'REVENUE'),
      'Brak przychodów z porównywalnego okresu rok wcześniej.',
      1,
    ),
  };
}
