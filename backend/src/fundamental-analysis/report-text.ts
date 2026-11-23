import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { AnalysisError } from './analysis-error.js';
import {
  extractReportMetrics,
  summarizeMetrics,
  summarizeValuationInputs,
  type ReportMetric,
} from './report-summary.js';

const require = createRequire(import.meta.url);
const MAX_PAGES = 250;
const PAGE_LIMIT = 16_000;
const CONTEXT_LIMIT = 24_000;

type PageText = { number: number; text: string; partial: boolean };
export type ParsedReport = {
  pages: PageText[];
  totalPages: number;
  summary: ReportMetric[];
  valuationInputs?: ReportMetric[];
};

export async function readReportText(
  bytes: Buffer,
  question: string,
  signal: AbortSignal,
) {
  return buildReportContext(await parseReport(bytes, signal), question);
}

export async function parseReport(
  bytes: Buffer,
  signal: AbortSignal,
): Promise<ParsedReport> {
  const signature = bytes.subarray(0, 1024).indexOf('%PDF-');
  if (signature === -1)
    throw new AnalysisError('PDF_INVALID', 400, 'Dołącz poprawny plik PDF.');

  const { getDocument, PasswordException, VerbosityLevel } =
    await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfAssets = dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: join(pdfAssets, 'cmaps') + sep,
    cMapPacked: true,
    standardFontDataUrl: join(pdfAssets, 'standard_fonts') + sep,
    disableFontFace: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) {
      throw new AnalysisError(
        'PDF_PAGE_LIMIT',
        400,
        `PDF może mieć maksymalnie ${MAX_PAGES} stron. Wybierz istotne strony raportu.`,
      );
    }

    const pages: PageText[] = [];
    const metrics: ReturnType<typeof extractReportMetrics> = [];
    for (let number = 1; number <= document.numPages; number++) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      const text = items
        .map((item) =>
          'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
        )
        .join('')
        .replace(/[^\S\r\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (
        /rachunek (?:zysków i strat|przepływów\s+pieniężnych)|sprawozdanie z (?:wyniku|całkowitych dochodów|przepływów\s+pieniężnych|sytuacji finansowej)|bilans|statements? of (?:operations|income|profit or loss|cash flows|financial position)|(?:income|cash flow) statements?|balance sheets?/iu.test(
          text.slice(0, 1800),
        )
      ) {
        metrics.push(
          ...extractReportMetrics(
            items.filter((item) => 'str' in item),
            number,
          ),
        );
      }
      page.cleanup();
      if (text)
        pages.push({
          number,
          text: text.slice(0, PAGE_LIMIT),
          partial: text.length > PAGE_LIMIT,
        });
    }

    if (!pages.length) {
      throw new AnalysisError(
        'PDF_NO_TEXT',
        400,
        'PDF nie zawiera tekstu do odczytania. Użyj raportu z warstwą tekstową lub wersji po OCR.',
      );
    }

    return {
      pages,
      totalPages: document.numPages,
      summary: summarizeMetrics(metrics),
      valuationInputs: summarizeValuationInputs(metrics),
    };
  } catch (error) {
    if (signal.aborted || error instanceof AnalysisError) throw error;
    if (error instanceof PasswordException) {
      throw new AnalysisError(
        'PDF_PASSWORD',
        400,
        'PDF jest zabezpieczony hasłem. Dołącz odblokowany plik.',
      );
    }
    throw new AnalysisError(
      'PDF_UNREADABLE',
      400,
      'Nie udało się odczytać PDF. Sprawdź, czy plik nie jest uszkodzony.',
    );
  } finally {
    await task.destroy();
  }
}

export function buildReportContext(report: ParsedReport, question: string) {
  const { pages, summary, totalPages } = report;
  const sourcePages = new Set(
    summary.filter((item) => item.state === 'verified').map(({ page }) => page),
  );
  const context = selectPages(pages, question, sourcePages);
  return {
    summary,
    text: context
      .map(({ number, text }) => `[str. ${number}]\n${text}`)
      .join('\n\n'),
    coverage: {
      totalPages,
      pagesWithText: pages.length,
      pagesInContext: context.length,
      contextPages: context.map(({ number, partial }) => ({ number, partial })),
      partial:
        context.length < totalPages || context.some((page) => page.partial),
    },
  };
}

const financialTerms = [
  /przychod|sprzedaż|revenue|net sales/iu,
  /zysk|profit|ebit|marż|margin/iu,
  /przepływ|cash flow|capex/iu,
  /bilans|balance sheet|zadłuż|liabilities|debt/iu,
  /ryzyk|risk|perspektyw|outlook/iu,
  /zestawienie|wybrane dane|financial highlights|financial statements/iu,
];

function selectPages(
  pages: PageText[],
  question: string,
  sourcePages: Set<number>,
): PageText[] {
  if (
    pages.reduce((length, page) => length + page.text.length + 20, 0) <=
    CONTEXT_LIMIT
  )
    return pages;

  const words = [
    ...new Set(question.toLowerCase().match(/\p{L}{4,}/gu) ?? []),
  ].slice(0, 20);
  const referencedPages = new Set(
    Array.from(
      question.matchAll(/\b(?:str\.|stron\p{L}*)\s*(\d+)/giu),
      (match) => Number(match[1]),
    ),
  );
  const ranked = pages
    .map((page) => {
      const text = page.text.toLowerCase();
      const score =
        100 * Number(referencedPages.has(page.number)) +
        30 * Number(sourcePages.has(page.number)) +
        3 * words.filter((word) => text.includes(word)).length +
        financialTerms.filter((term) => term.test(text)).length;
      return { page, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.page.number - right.page.number,
    );

  const selected: PageText[] = [];
  let remaining = CONTEXT_LIMIT;
  for (const { page } of ranked) {
    const limit = remaining - 20;
    if (limit < 160) break;
    selected.push({
      ...page,
      text: page.text.slice(0, limit),
      partial: page.partial || page.text.length > limit,
    });
    remaining -= 20 + Math.min(page.text.length, limit);
  }
  return selected.sort((left, right) => left.number - right.number);
}
