"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  companyCard,
  issuerReportPage,
  type CompanyIndicators,
  type IssuerReport,
} from "@/lib/fundamental-analysis-api";
import { formatInvestment } from "@/lib/investment-format";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";
import { InvestmentNote } from "./investment-note";

const metrics = {
  REVENUE: "Przychody",
  EBIT: "EBIT",
  NET_INCOME: "Zysk netto",
  OPERATING_CASH_FLOW: "Przepływy operacyjne",
  LONG_TERM_DEBT: "Dług długoterminowy",
};
const periods = {
  annual: "Roczne",
  quarterly: "Kwartalne",
  trailingYear: "Ostatnie 12 miesięcy (TTM)",
};
const indicatorLabels: Record<keyof CompanyIndicators, string> = {
  priceEarnings: "C/Z z raportu rocznego",
  priceBook: "C/WK",
  roe: "ROE",
  operatingMargin: "Marża EBIT",
  netMargin: "Marża netto",
  revenueGrowth: "Zmiana przychodów r/r",
};

function Indicators({ values }: { values: CompanyIndicators }) {
  return (
    <>
      <h3>Wskaźniki</h3>
      <dl className={styles.companyFacts}>
        {(Object.keys(indicatorLabels) as (keyof CompanyIndicators)[]).map(
          (key) => {
            const { value, reason, sources } = values[key];
            const unit =
              key === "priceEarnings" || key === "priceBook" ? "×" : "%";
            return (
              <div key={key}>
                <dt>{indicatorLabels[key]}</dt>
                <dd>
                  {value === null ? (
                    reason
                  ) : (
                    <strong>
                      {formatInvestment(value, 2)}
                      {unit}
                    </strong>
                  )}
                  {sources.map(({ reportId, page }, index) => (
                    <a
                      key={reportId + ":" + page}
                      href={issuerReportPage(reportId, page)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {sources.length > 1 && `Źródło ${index + 1}, `}strona{" "}
                      {page} PDF
                    </a>
                  ))}
                </dd>
              </div>
            );
          },
        )}
      </dl>
    </>
  );
}

export function CompanyFundamentals({
  instrumentId,
}: {
  instrumentId: string;
}) {
  const load = useCallback(
    (signal: AbortSignal) => companyCard(instrumentId, signal),
    [instrumentId],
  );
  const { state, refresh } = useInvestmentResource(load);
  const [scope, setScope] = useState<IssuerReport["scope"]>("CONSOLIDATED");
  const [period, setPeriod] = useState<keyof typeof periods>("annual");
  if (state.status === "loading")
    return <p role="status">Wczytywanie danych spółki…</p>;
  if (state.status === "error")
    return (
      <p role="alert">
        {state.message}{" "}
        <button type="button" onClick={refresh}>
          Ponów odczyt danych spółki
        </button>
      </p>
    );

  const { sections, activity, dividends } = state.value;
  const selected = sections.find((item) => item.scope === scope);
  const report = period === "trailingYear" ? null : selected?.[period];
  const trailing = period === "trailingYear" ? selected?.trailingYear : null;
  const indicators =
    period === "trailingYear" ? null : selected?.indicators?.[period];
  const result = report ?? trailing;

  return (
    <>
      <section className={styles.card} aria-label="Działalność">
        <h2>Działalność</h2>
        {activity ? (
          <>
            <p>{activity.text}</p>
            <a href={activity.sourceUrl} target="_blank" rel="noreferrer">
              Źródło opisu
            </a>
          </>
        ) : (
          <p>Brak zapisanego opisu działalności.</p>
        )}
      </section>
      <section className={styles.card} aria-label="Fundamenty spółki">
        <h2>Fundamenty spółki</h2>
        <div className={styles.companyFilters}>
          <label>
            Okres{" "}
            <select
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as keyof typeof periods)
              }
            >
              {Object.entries(periods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zakres{" "}
            <select
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as IssuerReport["scope"])
              }
            >
              <option value="CONSOLIDATED">Skonsolidowane</option>
              <option value="STANDALONE">Jednostkowe</option>
            </select>
          </label>
        </div>
        {result ? (
          <>
            <p>
              {result.periodStart} – {result.periodEnd} · {result.currency}
              {report && (
                <>
                  {" "}
                  · wersja {report.version} ·{" "}
                  <a href={report.sourceUrl} target="_blank" rel="noreferrer">
                    Źródło raportu
                  </a>
                </>
              )}
            </p>
            <dl className={styles.companyFacts}>
              {Object.entries(metrics).map(([metric, label]) => {
                const reported = report?.facts.find(
                  (fact) => fact.metric === metric,
                );
                const summed = trailing?.facts.find(
                  (fact) => fact.metric === metric,
                );
                const fact = reported ?? summed;
                const sources =
                  reported && report
                    ? [{ reportId: report.id, page: reported.page }]
                    : (summed?.sources ?? []);
                return (
                  <div key={metric}>
                    <dt>{label}</dt>
                    <dd>
                      {fact ? (
                        <strong>
                          {formatInvestment(fact.amount)} {fact.unit}
                        </strong>
                      ) : (
                        "Brak danych"
                      )}
                      {reported && <span>{reported.period}</span>}
                      {sources.map((source, index) => (
                        <a
                          key={source.reportId}
                          href={issuerReportPage(source.reportId, source.page)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {sources.length > 1 && `Raport ${index + 1}, `}strona{" "}
                          {source.page} PDF
                        </a>
                      ))}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        ) : (
          <p>
            {period === "trailingYear"
              ? "Do TTM potrzeba czterech kolejnych kwartałów w tej samej walucie."
              : "Brak zapisanego raportu dla wybranego okresu i zakresu."}
          </p>
        )}
        {indicators && <Indicators values={indicators} />}
        <Link href="/dashboard/fundamental-analysis">
          Przejdź do raportów i analizy
        </Link>
      </section>
      <InvestmentNote key={instrumentId} instrumentId={instrumentId} />
      <section className={styles.card} aria-label="Dywidendy">
        <h2>Dywidendy</h2>
        {dividends.length ? (
          <ul className={styles.list}>
            {dividends.map((row) => (
              <li key={row.id}>
                <strong>
                  {row.amount !== null && row.currency
                    ? `${formatInvestment(row.amount)} ${row.currency} na akcję`
                    : "Brak kwoty"}
                </strong>
                <span>
                  {" "}
                  · dzień bez prawa {row.exDate} · wypłata{" "}
                  {row.paymentOn ?? "brak daty"} · {row.source}
                </span>
                {row.amountBasis === "provider_value" && (
                  <p>Kwota udostępniona przez dostawcę.</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>Brak zapisanych dywidend.</p>
        )}
      </section>
    </>
  );
}
