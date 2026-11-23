"use client";

import { useEffect, useState } from "react";
import { investmentsApi, type InvestmentInstrument } from "@/lib/investments-api";
import styles from "./investments.module.css";

export function InstrumentPicker({ selected, onChange, required = true }: {
  selected: InvestmentInstrument | null;
  onChange(instrument: InvestmentInstrument | null): void;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    query: string; page: number; items: InvestmentInstrument[]; total: number; pageSize: number; error?: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await investmentsApi.searchInstruments(query.trim(), page, controller.signal);
        if (!controller.signal.aborted) setResult({ query, page, ...data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ query, page, items: [], total: 0, pageSize: 25, error: error instanceof Error ? error.message : "Nie udało się pobrać katalogu." });
      }
    }, query ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, retry]);

  const current = result?.query === query && result.page === page ? result : null;
  const items = current?.items ?? [];
  const options = selected && !items.some(item => item.id === selected.id) ? [selected, ...items] : items;
  return <div className={styles.full}>
    <label>Szukaj instrumentu
      <input type="search" maxLength={80} placeholder="Ticker, nazwa lub ISIN" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
    </label>
    <label>Instrument
      <select value={selected?.id ?? ""} onChange={event => onChange(options.find(item => item.id === event.target.value) ?? null)} required={required}>
        <option value="">Wybierz instrument</option>
        {options.map(item => <option key={item.id} value={item.id}>{item.ticker} · {item.mic} · {item.currency}</option>)}
      </select>
    </label>
    <div aria-live="polite">
      {!current ? "Wyszukiwanie…" : current.error ? <>{current.error} <button type="button" onClick={() => setRetry(retry + 1)}>Ponów wyszukiwanie</button></> :
        current.total === 0 ? "Brak instrumentów spełniających kryteria." : current.total > current.pageSize && <>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Poprzednie instrumenty</button>
          <span> Strona {page} z {Math.ceil(current.total / current.pageSize)} </span>
          <button type="button" disabled={page * current.pageSize >= current.total} onClick={() => setPage(page + 1)}>Następne instrumenty</button>
        </>}
    </div>
  </div>;
}
