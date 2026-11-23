"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { issuerReportPage } from "@/lib/fundamental-analysis-api";
import { formatInvestment } from "@/lib/investment-format";
import {
  researchApi,
  type ResearchFilters,
  type ResearchRow,
} from "@/lib/investment-research-api";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

const defaults: ResearchFilters = {
  scope: "CONSOLIDATED",
  missing: "include",
  minOperatingMargin: "",
  minNetMargin: "",
};
const amounts = [
  { key: "REVENUE", label: "Przychody" },
  { key: "EBIT", label: "EBIT" },
  { key: "NET_INCOME", label: "Zysk netto" },
];
const margins = [
  { key: "operatingMargin", label: "Marża EBIT" },
  { key: "netMargin", label: "Marża netto" },
] as const;

function percent(value: string | null) {
  return value === null ? "Brak danych" : `${formatInvestment(value, 2)}%`;
}

function Comparison({ rows }: { rows: ResearchRow[] }) {
  return (
    <div className={styles.comparison}>
      <table aria-label="Porównanie wybranych spółek">
        <thead>
          <tr>
            <th scope="col">Pozycja</th>
            {rows.map((row) => (
              <th scope="col" key={row.id}>
                {row.ticker} · {row.mic}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Okres i waluta</th>
            {rows.map(({ id, report }) => (
              <td key={id}>
                {report
                  ? `${report.periodStart} – ${report.periodEnd} · ${report.currency}`
                  : "Brak raportu"}
              </td>
            ))}
          </tr>
          {amounts.map(({ key, label }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {rows.map(({ id, report }) => {
                const fact = report?.facts.find((item) => item.metric === key);
                return (
                  <td key={id}>
                    {fact && report ? (
                      <>
                        {formatInvestment(fact.amount)} {fact.unit}
                        <small>
                          <a
                            href={issuerReportPage(report.id, fact.page)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Strona {fact.page} PDF
                          </a>
                        </small>
                      </>
                    ) : (
                      "Brak danych"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {margins.map(({ key, label }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {rows.map((row) => (
                <td key={row.id}>{percent(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({ filters }: { filters: ResearchFilters }) {
  const [selected, setSelected] = useState<string[]>([]);
  const load = useCallback(
    (signal: AbortSignal) => researchApi.screen(filters, signal),
    [filters],
  );
  const { state, refresh } = useInvestmentResource(load);
  if (state.status === "loading")
    return <p role="status">Wczytywanie spółek…</p>;
  if (state.status === "error")
    return (
      <p role="alert">
        {state.message} <button onClick={refresh}>Ponów odczyt</button>
      </p>
    );
  if (!state.value.length)
    return (
      <p>
        Brak wyników dla tych filtrów. Sprawdź zakres i raporty zapisane na
        koncie.
      </p>
    );

  const comparison = state.value.filter((row) => selected.includes(row.id));
  return (
    <>
      <section className={styles.card} aria-labelledby="research-results">
        <h2 id="research-results">Wyniki</h2>
        <ul className={styles.list}>
          {state.value.map((row) => (
            <li key={row.id}>
              <label className={styles.researchSelection}>
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((current) =>
                      checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    );
                  }}
                />
                <strong>
                  {row.ticker} · {row.mic}
                </strong>{" "}
                {row.name}
              </label>
              <p>
                Marża EBIT {percent(row.operatingMargin)} · Marża netto{" "}
                {percent(row.netMargin)}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.card} aria-labelledby="comparison-title">
        <h2 id="comparison-title">Porównanie spółek</h2>
        {comparison.length >= 2 ? (
          <Comparison rows={comparison} />
        ) : (
          <p>Wybierz co najmniej dwie spółki.</p>
        )}
      </section>
    </>
  );
}

export function InvestmentResearch() {
  const [filters, setFilters] = useState(defaults);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const margin = (name: string) =>
      String(data.get(name) ?? "")
        .trim()
        .replace(",", ".");
    setFilters({
      scope: data.get("scope") as ResearchFilters["scope"],
      missing: data.get("missing") as ResearchFilters["missing"],
      minOperatingMargin: margin("minOperatingMargin"),
      minNetMargin: margin("minNetMargin"),
    });
  }

  return (
    <section className={styles.panel} aria-labelledby="research-title">
      <Link href="/dashboard/fundamental-analysis">Analiza fundamentalna</Link>
      <h1 id="research-title">Screener i porównanie spółek</h1>
      <section className={styles.card} aria-labelledby="research-filters">
        <h2 id="research-filters">Filtry najnowszych raportów rocznych</h2>
        <form onSubmit={filter}>
          <div className={styles.companyFilters}>
            <label>
              Zakres raportów
              <select name="scope" defaultValue={defaults.scope}>
                <option value="CONSOLIDATED">Skonsolidowane</option>
                <option value="STANDALONE">Jednostkowe</option>
              </select>
            </label>
            <label>
              Minimalna marża EBIT (%)
              <input
                name="minOperatingMargin"
                inputMode="decimal"
                pattern="-?[0-9]{1,12}([.,][0-9]{1,2})?"
              />
            </label>
            <label>
              Minimalna marża netto (%)
              <input
                name="minNetMargin"
                inputMode="decimal"
                pattern="-?[0-9]{1,12}([.,][0-9]{1,2})?"
              />
            </label>
            <label>
              Braki danych
              <select name="missing" defaultValue={defaults.missing}>
                <option value="include">Uwzględnij braki</option>
                <option value="exclude">Pomiń braki</option>
                <option value="only">Pokaż tylko braki</option>
              </select>
            </label>
          </div>
          <div>
            <button type="submit">Filtruj spółki</button>
          </div>
        </form>
      </section>
      <Results key={JSON.stringify(filters)} filters={filters} />
    </section>
  );
}
