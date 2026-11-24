import type {
  StrategyFundamentalReport,
  StrategyUniverseMember,
} from '../strategies/strategy.js';

export type HistoricalContext = {
  source: string;
  universe: readonly StrategyUniverseMember[];
  reports: readonly StrategyFundamentalReport[];
};

export function instrumentKey(
  item: Pick<StrategyUniverseMember, 'mic' | 'ticker'>,
) {
  return `${item.mic.toUpperCase()}:${item.ticker.toUpperCase()}`;
}

export function listedAt(
  universe: readonly StrategyUniverseMember[],
  sessionOn: string,
) {
  return universe
    .filter(
      (item) =>
        item.listedOn <= sessionOn &&
        (!item.delistedOn || sessionOn < item.delistedOn),
    )
    .sort((a, b) => instrumentKey(a).localeCompare(instrumentKey(b)));
}

export function reportsKnownAt(
  reports: readonly StrategyFundamentalReport[],
  universe: readonly StrategyUniverseMember[],
  decidedAt: Date,
) {
  const listed = new Set(universe.map(instrumentKey));
  const known = new Map<string, StrategyFundamentalReport>();
  for (const report of reports) {
    if (
      !listed.has(instrumentKey(report)) ||
      Date.parse(report.publishedAt) > decidedAt.getTime() ||
      Date.parse(report.availableAt) > decidedAt.getTime()
    )
      continue;
    const key = `${instrumentKey(report)}:${report.periodEnd}:${report.scope}`;
    const existing = known.get(key);
    if (
      !existing ||
      report.revision > existing.revision ||
      (report.revision === existing.revision && report.id > existing.id)
    )
      known.set(key, report);
  }
  return [...known.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, report]) => report);
}

export function validateHistoricalContext(history: HistoricalContext) {
  const keys = new Set<string>();
  for (const item of history.universe) {
    const key = instrumentKey(item);
    if (keys.has(key) || (item.delistedOn && item.delistedOn <= item.listedOn))
      throw new Error(
        'Nieprawidłowe daty lub powtórzony instrument w historycznym uniwersum.',
      );
    keys.add(key);
  }
  const ids = new Set<string>();
  for (const report of history.reports) {
    if (
      ids.has(report.id) ||
      !keys.has(instrumentKey(report)) ||
      report.periodEnd > report.publishedAt.slice(0, 10) ||
      Date.parse(report.publishedAt) > Date.parse(report.availableAt) ||
      !Number.isFinite(Date.parse(report.publishedAt)) ||
      !Number.isFinite(Date.parse(report.availableAt)) ||
      new Set(report.facts.map((fact) => fact.metric)).size !==
        report.facts.length
    )
      throw new Error(
        'Raport fundamentalny wymaga prawidłowych dat, wersji i przynależności do uniwersum.',
      );
    ids.add(report.id);
  }
}
