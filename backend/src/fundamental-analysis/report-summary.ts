type Metric = 'revenue' | 'ebit' | 'netIncome';
type VerifiedMetric = {
  metric: Metric;
  state: 'verified';
  amount: string;
  unit: string;
  period: string;
  page: number;
};
export type ReportMetric =
  | VerifiedMetric
  | {
      metric: Metric;
      state: 'missing' | 'needs_review';
    };

type PdfItem = { str: string; transform: number[]; width: number };
type Cell = { text: string; x: number; right: number };
type Row = { y: number; cells: Cell[] };

const METRICS: Record<Metric, RegExp> = {
  revenue:
    /^(?:(?:total )?(?:net sales|revenues?)|przychody (?:netto )?(?:ze sprzedaży|z umów z klientami))$/iu,
  ebit: /^(?:ebit|operating (?:income(?: \(loss\))?|loss|profit)|(?:zysk(?: netto| \(strata\))?|strata|wynik) (?:z działalności operacyjnej|operacyjny)(?: \(ebit\))?)$/iu,
  netIncome:
    /^(?:net (?:income(?: \(loss\))?|loss|profit)|zysk za rok obrotowy|(?:zysk(?: \(strata\))?|strata|wynik) netto)$/iu,
};
const INCOME_STATEMENT =
  /^(?:consolidated (?:statements? of (?:operations|income|profit or loss)|income statements?)|skonsolidowan\s*[ye] (?:rachunek zysków i strat|sprawozdanie z (?:wyniku|całkowitych dochodów)))$/iu;
const YEAR_CELL = /^(?:(od|do) )?(?:(\d{2}\.\d{2}\.)?((?:19|20)\d{2}))\*?$/iu;

function cellsByRow(items: PdfItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items.sort((a, b) => b.transform[5]! - a.transform[5]!)) {
    const text = item.str.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const x = item.transform[4]!;
    const y = item.transform[5]!;
    const cell = { text, x, right: x + item.width };
    const row = rows.at(-1);
    if (row && Math.abs(row.y - y) <= 2) row.cells.push(cell);
    else rows.push({ y, cells: [cell] });
  }
  // Some PDF producers split one word or number into adjacent text items.
  for (const row of rows) {
    const cells: Cell[] = [];
    for (const cell of row.cells.sort((a, b) => a.x - b.x)) {
      const before = cells.at(-1);
      if (
        before &&
        Math.abs(cell.x - before.right) <= 1 &&
        !/[.,:]$/.test(before.text)
      ) {
        before.text += cell.text;
        before.right = cell.right;
      } else {
        cells.push(cell);
      }
    }
    row.cells = cells;
  }
  return rows;
}

function rowText(row: Row) {
  return row.cells.map(({ text }) => text).join(' ');
}

function getYearColumns(row: Row) {
  const cells = row.cells.filter(
    ({ text }) => !/^(?:nota|notes?)$/iu.test(text),
  );
  const columns = cells.flatMap(({ text, x }) => {
    const date = YEAR_CELL.exec(text);
    return date
      ? [
          {
            x,
            year: date[3]!,
            date: (date[2] ?? '') + date[3],
            edge: date[1]?.toLowerCase(),
          },
        ]
      : [];
  });
  return columns.length >= 2 &&
    columns.length === cells.length &&
    new Set(columns.map(({ year }) => year)).size === columns.length
    ? columns
    : [];
}

function readUnit(headers: string, rows: Row[]) {
  const scale =
    /\b(?:w )?(mln|milionach|tys\.?|tysiącach)\b|\bin (millions|thousands)\b/iu.exec(
      headers,
    );
  if (!scale) return null;
  const currencies = new Set(
    headers.toUpperCase().match(/\b(?:PLN|USD|EUR)\b/g),
  );
  if (currencies.size > 1) return null;
  const currency =
    [...currencies][0] ??
    (/\bzł(?:\s|[),.]|$)/iu.test(headers) ? 'PLN' : null) ??
    (rows.some((row) =>
      row.cells.some(({ text }) => /^\$(?:\s|\d|$)/.test(text)),
    )
      ? '$'
      : null);
  if (!currency) return null;
  const magnitude = /^(?:mln|milionach|millions)$/i.test(
    scale[1] ?? scale[2] ?? '',
  )
    ? 'mln'
    : 'tys.';
  return { label: magnitude + ' ' + currency, polish: !!scale[1] };
}

function readAmount(raw: string, polish: boolean): string | null {
  const token = raw.replace(/[$€]/g, '').replaceAll('−', '-').trim();
  const parenthesized = /^\(\s*.+\s*\)$/.test(token);
  const value = parenthesized ? token.slice(1, -1).trim() : token;
  const pattern = polish
    ? /^-?(?:\d+|\d{1,3}(?: \d{3})+)(?:,\d+)?$/
    : /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(value) || (parenthesized && value.startsWith('-')))
    return null;
  const normalized = (
    polish
      ? value.replaceAll(' ', '').replace(',', '.')
      : value.replaceAll(',', '')
  )
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');
  return parenthesized && normalized !== '0' ? '-' + normalized : normalized;
}

export function extractReportMetrics(
  items: PdfItem[],
  page: number,
): ReportMetric[] {
  const rows = cellsByRow(items);
  const heading = rows
    .slice(0, 12)
    .findIndex((row) => INCOME_STATEMENT.test(rowText(row)));
  if (heading < 0) return [];
  // A quarterly appendix may repeat the main statement with a different column layout.
  if (
    rows
      .slice(0, heading)
      .some((row) =>
        /kwartalna informacja finansowa|quarterly financial information/iu.test(
          rowText(row),
        ),
      )
  )
    return [];

  const headerRows = rows.slice(heading + 1, heading + 16);
  const columnRow = headerRows.findIndex((row) => {
    const columns = getYearColumns(row);
    return columns.length && columns.every(({ edge }) => edge !== 'od');
  });
  const columns = columnRow < 0 ? [] : getYearColumns(headerRows[columnRow]!);
  const headerEnd = columnRow < 0 ? heading + 1 : heading + 2 + columnRow;
  const first = columns[0]?.x ?? Infinity;
  const gap = columns.length >= 2 ? columns[1]!.x - first : 0;
  const numberStart = first - gap / 2;
  const latest = columns.reduce(
    (best, current, index) =>
      current.year > (columns[best]?.year ?? '') ? index : best,
    -1,
  );
  const column = columns[latest];
  const last = columns.at(-1);
  const penultimate = columns.at(-2);
  const numberEnd =
    last && penultimate ? last.x + (last.x - penultimate.x) * 0.85 : Infinity;
  const boundaries = [
    numberStart,
    ...columns
      .slice(1)
      .map((current, index) => (columns[index]!.x + current.x) / 2),
    numberEnd,
  ];
  const headers = rows.slice(0, headerEnd).map(rowText).join('\n');
  const unit = readUnit(headers, rows.slice(headerEnd, headerEnd + 35));
  const starts =
    columnRow > 0 ? getYearColumns(headerRows[columnRow - 1]!) : [];
  const start = starts[latest];
  let period: string | undefined;
  if (
    column?.edge === 'do' &&
    start?.edge === 'od' &&
    column.year === start.year
  ) {
    period = start.date + ' – ' + column.date;
  } else if (
    !column?.edge &&
    !/quarter|(?:three|six|nine) months ended|kwartał|półrocze/iu.test(headers)
  ) {
    period = column?.year;
  }

  const facts: ReportMetric[] = [];
  for (const row of rows.slice(headerEnd)) {
    const label = row.cells
      .filter(
        ({ x, text }) =>
          x < numberStart &&
          /\p{L}/u.test(text) &&
          !/^(?:nota|note)\b/iu.test(text),
      )
      .map(({ text }) => text)
      .join(' ')
      .replace(/[:*]+$/, '')
      .trim();
    const metric = (Object.keys(METRICS) as Metric[]).find((key) =>
      METRICS[key].test(label),
    );
    if (!metric) continue;
    const amounts = columns.map((_, index) =>
      row.cells
        .filter(
          ({ x }) => x >= boundaries[index]! && x < boundaries[index + 1]!,
        )
        .map(({ text }) => text)
        .join(' '),
    );
    const extraColumn = row.cells.some(
      ({ x, text }) => x >= numberEnd && /\d/.test(text),
    );
    const parsed =
      unit && !extraColumn
        ? amounts.map((raw) => readAmount(raw, unit.polish))
        : [];
    const hasUnreadableColumn = parsed.some(
      (value, index) =>
        value === null && !/^[–—-]$/.test(amounts[index]!.trim()),
    );
    const amount = !hasUnreadableColumn && parsed[latest];
    facts.push(
      amount && unit && period
        ? { metric, state: 'verified', amount, unit: unit.label, period, page }
        : { metric, state: 'needs_review' },
    );
  }
  return facts;
}

export function summarizeMetrics(candidates: ReportMetric[]): ReportMetric[] {
  return (Object.keys(METRICS) as Metric[]).map((metric) => {
    const matches = candidates.filter((item) => item.metric === metric);
    const verified = matches.filter((item) => item.state === 'verified');
    const first = verified[0];
    if (
      first &&
      verified.every(
        ({ amount, unit, period }) =>
          amount === first.amount &&
          unit === first.unit &&
          period === first.period,
      )
    )
      return first;
    return { metric, state: matches.length ? 'needs_review' : 'missing' };
  });
}
