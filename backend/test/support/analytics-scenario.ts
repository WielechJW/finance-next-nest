import { SYSTEM_CATEGORIES } from '../../src/categories/system-categories.js';
import type {
  AnalyticsCategoryResponse,
  AnalyticsTrendPoint,
} from '../../src/analytics/analytics-response.js';

const [food, transport, housing, , salary, otherIncome] = SYSTEM_CATEGORIES;
export const SCENARIO_PERIODS = {
  full: { from: '2023-12-31', to: '2024-03-01' },
  january: { from: '2024-01-01', to: '2024-01-31' },
  february: { from: '2024-02-01', to: '2024-02-29' },
  leap: { from: '2024-02-29', to: '2024-02-29' },
  boundary: { from: '2023-12-31', to: '2024-01-01' },
  empty: { from: '2024-04-01', to: '2024-04-03' },
} as const;
export type ScenarioPeriod = keyof typeof SCENARIO_PERIODS;
export interface ScenarioEntry {
  key: string;
  type: 'INCOME' | 'EXPENSE';
  categoryId: string;
  amount: string;
  occurredOn: string;
  title: string;
}
export interface ScenarioFlow {
  income: string;
  expenses: string;
  periodResult: string;
}
interface ExpectedPeriod extends ScenarioFlow {
  categories: AnalyticsCategoryResponse[];
}
export interface ScenarioExpectation {
  openingBalance: string;
  balance: string;
  periods: Record<ScenarioPeriod, ExpectedPeriod>;
  daily: Record<string, ScenarioFlow>;
}
export interface ScenarioAccount {
  openingBalance: string;
  entries: ScenarioEntry[];
  expected: ScenarioExpectation;
}
const flow = (
  income: string,
  expenses: string,
  periodResult: string,
): ScenarioFlow => ({ income, expenses, periodResult });
const ZERO = flow('0.00', '0.00', '0.00');
const category = (
  reference: (typeof SYSTEM_CATEGORIES)[number],
  amount: string,
  percentage: string,
): AnalyticsCategoryResponse => ({
  categoryId: reference.id,
  categoryName: reference.name,
  amount,
  percentage,
});
const report = (
  income: string,
  expenses: string,
  periodResult: string,
  categories: AnalyticsCategoryResponse[] = [],
): ExpectedPeriod => ({ ...flow(income, expenses, periodResult), categories });
function entry(
  key: string,
  reference: (typeof SYSTEM_CATEGORIES)[number],
  amount: string,
  occurredOn: string,
): ScenarioEntry {
  return {
    key,
    type: reference.type,
    categoryId: reference.id,
    amount,
    occurredOn,
    title: `Weryfikacja ${key}`,
  };
}

// Amounts and expected results are independent literal business examples.
// Helpers below only assemble calendar labels and copy expected values.
const baselineA: ScenarioExpectation = {
  openingBalance: '100.00',
  balance: '141.10',
  periods: {
    full: report('61.50', '20.40', '41.10', [
      category(food, '20.20', '99.02'),
      category(transport, '0.20', '0.98'),
    ]),
    january: report('50.20', '20.30', '29.90', [
      category(food, '20.10', '99.01'),
      category(transport, '0.20', '0.99'),
    ]),
    february: report('0.30', '0.10', '0.20', [
      category(food, '0.10', '100.00'),
    ]),
    leap: report('0.00', '0.10', '-0.10', [category(food, '0.10', '100.00')]),
    boundary: report('60.20', '0.00', '60.20'),
    empty: report('0.00', '0.00', '0.00'),
  },
  daily: {
    '2023-12-31': flow('10.00', '0.00', '10.00'),
    '2024-01-01': flow('50.20', '0.00', '50.20'),
    '2024-01-15': flow('0.00', '20.10', '-20.10'),
    '2024-01-31': flow('0.00', '0.20', '-0.20'),
    '2024-02-01': flow('0.30', '0.00', '0.30'),
    '2024-02-29': flow('0.00', '0.10', '-0.10'),
    '2024-03-01': flow('1.00', '0.00', '1.00'),
  },
};
export const ANALYTICS_ACCOUNT_A: ScenarioAccount = {
  openingBalance: '100.00',
  expected: baselineA,
  entries: [
    entry('A-grudzien', salary, '10.00', '2023-12-31'),
    entry('A-przychod', salary, '50.20', '2024-01-01'),
    entry('A-zmienna', food, '20.10', '2024-01-15'),
    entry('A-transport', transport, '0.20', '2024-01-31'),
    entry('A-luty', otherIncome, '0.30', '2024-02-01'),
    entry('A-przestepny', food, '0.10', '2024-02-29'),
    entry('A-marzec', otherIncome, '1.00', '2024-03-01'),
  ],
};
export const ANALYTICS_ACCOUNT_B: ScenarioAccount = {
  openingBalance: '-50.00',
  entries: [
    entry('B-grudzien', housing, '1.01', '2023-12-31'),
    entry('B-przychod', salary, '7.07', '2024-01-01'),
    entry('B-jedzenie', food, '3.03', '2024-01-15'),
    entry('B-transport', transport, '2.02', '2024-01-31'),
    entry('B-luty', otherIncome, '0.40', '2024-02-01'),
    entry('B-przestepny', housing, '0.04', '2024-02-29'),
    entry('B-marzec', otherIncome, '5.05', '2024-03-01'),
  ],
  expected: {
    openingBalance: '-50.00',
    balance: '-43.58',
    periods: {
      full: report('12.52', '6.10', '6.42', [
        category(food, '3.03', '49.67'),
        category(transport, '2.02', '33.11'),
        category(housing, '1.05', '17.21'),
      ]),
      january: report('7.07', '5.05', '2.02', [
        category(food, '3.03', '60.00'),
        category(transport, '2.02', '40.00'),
      ]),
      february: report('0.40', '0.04', '0.36', [
        category(housing, '0.04', '100.00'),
      ]),
      leap: report('0.00', '0.04', '-0.04', [
        category(housing, '0.04', '100.00'),
      ]),
      boundary: report('7.07', '1.01', '6.06', [
        category(housing, '1.01', '100.00'),
      ]),
      empty: report('0.00', '0.00', '0.00'),
    },
    daily: {
      '2023-12-31': flow('0.00', '1.01', '-1.01'),
      '2024-01-01': flow('7.07', '0.00', '7.07'),
      '2024-01-15': flow('0.00', '3.03', '-3.03'),
      '2024-01-31': flow('0.00', '2.02', '-2.02'),
      '2024-02-01': flow('0.40', '0.00', '0.40'),
      '2024-02-29': flow('0.00', '0.04', '-0.04'),
      '2024-03-01': flow('5.05', '0.00', '5.05'),
    },
  },
};

function phase(
  previous: ScenarioExpectation,
  balance: string,
  periods: Partial<ScenarioExpectation['periods']>,
  daily: ScenarioExpectation['daily'] = {},
): ScenarioExpectation {
  return {
    ...previous,
    balance,
    periods: { ...previous.periods, ...periods },
    daily: { ...previous.daily, ...daily },
  };
}
const amountChanged = phase(
  baselineA,
  '131.10',
  {
    full: report('61.50', '30.40', '31.10', [
      category(food, '30.20', '99.34'),
      category(transport, '0.20', '0.66'),
    ]),
    january: report('50.20', '30.30', '19.90', [
      category(food, '30.10', '99.34'),
      category(transport, '0.20', '0.66'),
    ]),
  },
  { '2024-01-15': flow('0.00', '30.10', '-30.10') },
);
const categoryChanged = phase(amountChanged, '131.10', {
  full: report('61.50', '30.40', '31.10', [
    category(transport, '30.30', '99.67'),
    category(food, '0.10', '0.33'),
  ]),
  january: report('50.20', '30.30', '19.90', [
    category(transport, '30.30', '100.00'),
  ]),
});
const dateChanged = phase(
  categoryChanged,
  '131.10',
  {
    january: report('50.20', '0.20', '50.00', [
      category(transport, '0.20', '100.00'),
    ]),
    february: report('0.30', '30.20', '-29.90', [
      category(transport, '30.10', '99.67'),
      category(food, '0.10', '0.33'),
    ]),
    leap: report('0.00', '30.20', '-30.20', [
      category(transport, '30.10', '99.67'),
      category(food, '0.10', '0.33'),
    ]),
  },
  { '2024-01-15': ZERO, '2024-02-29': flow('0.00', '30.20', '-30.20') },
);
const typeChanged = phase(
  dateChanged,
  '191.30',
  {
    full: report('91.60', '0.30', '91.30', [
      category(transport, '0.20', '66.67'),
      category(food, '0.10', '33.33'),
    ]),
    february: report('30.40', '0.10', '30.30', [
      category(food, '0.10', '100.00'),
    ]),
    leap: report('30.10', '0.10', '30.00', [category(food, '0.10', '100.00')]),
  },
  { '2024-02-29': flow('30.10', '0.10', '30.00') },
);
const incomeDeleted = phase(
  typeChanged,
  '161.20',
  {
    full: report('61.50', '0.30', '61.20', [
      category(transport, '0.20', '66.67'),
      category(food, '0.10', '33.33'),
    ]),
    february: baselineA.periods.february,
    leap: baselineA.periods.leap,
  },
  { '2024-02-29': baselineA.daily['2024-02-29'] },
);
const expenseDeleted = phase(
  incomeDeleted,
  '161.40',
  {
    full: report('61.50', '0.10', '61.40', [category(food, '0.10', '100.00')]),
    january: report('50.20', '0.00', '50.20'),
  },
  { '2024-01-31': ZERO },
);

export const ANALYTICS_STEPS: {
  name: string;
  key: string;
  patch?: Record<string, string>;
  expected: ScenarioExpectation;
}[] = [
  {
    name: 'zmiana kwoty',
    key: 'A-zmienna',
    patch: { amount: '30.10' },
    expected: amountChanged,
  },
  {
    name: 'zmiana kategorii',
    key: 'A-zmienna',
    patch: { categoryId: transport.id },
    expected: categoryChanged,
  },
  {
    name: 'przeniesienie na dzień przestępny',
    key: 'A-zmienna',
    patch: { occurredOn: '2024-02-29' },
    expected: dateChanged,
  },
  {
    name: 'zmiana wydatku na przychód',
    key: 'A-zmienna',
    patch: { type: 'INCOME', categoryId: otherIncome.id },
    expected: typeChanged,
  },
  { name: 'usunięcie przychodu', key: 'A-zmienna', expected: incomeDeleted },
  { name: 'usunięcie wydatku', key: 'A-transport', expected: expenseDeleted },
];

export function scenarioDaily(
  expected: ScenarioExpectation,
  period: ScenarioPeriod,
): AnalyticsTrendPoint[] {
  const range = SCENARIO_PERIODS[period];
  const points: AnalyticsTrendPoint[] = [];
  const last = Date.parse(range.to + 'T00:00:00.000Z');
  for (
    let stamp = Date.parse(range.from + 'T00:00:00.000Z');
    stamp <= last;
    stamp += 86_400_000
  ) {
    const day = new Date(stamp).toISOString().slice(0, 10);
    points.push({ period: day, ...(expected.daily[day] ?? ZERO) });
  }
  return points;
}
function point(
  period: string,
  { income, expenses, periodResult }: ScenarioFlow,
): AnalyticsTrendPoint {
  return { period, income, expenses, periodResult };
}
export function scenarioMonthly(
  expected: ScenarioExpectation,
  period: ScenarioPeriod,
): AnalyticsTrendPoint[] {
  switch (period) {
    case 'full':
      return [
        point('2023-12', expected.daily['2023-12-31']),
        point('2024-01', expected.periods.january),
        point('2024-02', expected.periods.february),
        point('2024-03', expected.daily['2024-03-01']),
      ];
    case 'january':
      return [point('2024-01', expected.periods.january)];
    case 'february':
      return [point('2024-02', expected.periods.february)];
    case 'leap':
      return [point('2024-02', expected.periods.leap)];
    case 'boundary':
      return [
        point('2023-12', expected.daily['2023-12-31']),
        point('2024-01', expected.daily['2024-01-01']),
      ];
    case 'empty':
      return [point('2024-04', ZERO)];
  }
}

export function scenarioInput(input: ScenarioEntry) {
  // Copy explicitly so the fixture's local lookup key never enters the API.
  return {
    type: input.type,
    categoryId: input.categoryId,
    amount: input.amount,
    occurredOn: input.occurredOn,
    title: input.title,
  };
}
