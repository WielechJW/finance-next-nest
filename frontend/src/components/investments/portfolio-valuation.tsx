'use client';
import { useCallback, useState } from 'react';
import { investmentMarketApi } from '@/lib/investment-market-api';
import { formatInvestment } from '@/lib/investment-format';
import { warsawToday } from '@/lib/transaction-input';
import { useInvestmentResource } from './use-investment-resource';
import styles from './investments.module.css';

const display = (value: string | null, suffix = ' PLN') => value === null ? 'Brak pełnych danych' : `${formatInvestment(value, 2)}${suffix}`;
export function PortfolioValuation({ portfolioId }: { portfolioId: string }) {
  const load = useCallback((signal: AbortSignal) => investmentMarketApi.valuation(portfolioId, signal), [portfolioId]);
  const resource = useInvestmentResource(load);
  const [showHistory, setShowHistory] = useState(false);
  return <section className={styles.card} aria-label="Wycena rynkowa portfela">
    <h2>Wycena rynkowa</h2>
    {resource.state.status === 'loading' ? <p role="status">Ładowanie wyceny…</p> : resource.state.status === 'error' ? <p role="alert">{resource.state.message}</p> : <>
      {!resource.state.value.complete && <p role="status">Wycena jest niepełna. {resource.state.value.pendingSplits.length ? `Uzgodnij split na rachunku: ${resource.state.value.pendingSplits.map(s => s.ticker + ' (' + s.exDate + ')').join(', ')}.` : 'Brakuje aktualnej ceny lub kursu walut.'}</p>}
      <dl className={styles.balances}>
        <div><dt>Wartość portfela</dt><dd>{display(resource.state.value.valuePln)}</dd></div>
        <div><dt>Wynik po uwzględnieniu wkładów</dt><dd>{display(resource.state.value.resultPln)}</dd></div>
        <div><dt>Wpłaty minus wypłaty i koszt pozycji otwarcia</dt><dd>{display(resource.state.value.netContributionsPln)}</dd></div>
      </dl>
      <ul className={styles.list}>{resource.state.value.positions.map(p => <li key={p.id}>
        <h3>{p.ticker} · {p.mic}</h3>
        <p>Wartość: {display(p.value, ` ${p.currency}`)} · Wynik niezrealizowany: {display(p.unrealized, ` ${p.currency}`)}</p>
        <p>Udział portfela: {p.allocationPercent === null ? 'Brak pełnych danych' : `${formatInvestment(p.allocationPercent, 2)}%`}</p>
        <p>{p.quote ? `Cena z ${p.quote.sessionOn}, źródło ${p.quote.source}` : 'Brak ceny'}{p.status !== 'fresh' ? ' · Wymaga aktualizacji' : ''}</p>
      </li>)}</ul>
      <h3>Wyniki według walut</h3>
      <p>Alokacja rynków: {resource.state.value.allocation.markets.map(row => `${row.label}: ${display(row.percent, '%')}`).join(' · ')}</p>
      <p>Alokacja walut: {resource.state.value.allocation.currencies.map(row => `${row.label}: ${display(row.percent, '%')}`).join(' · ')}</p>
      {(['PLN', 'USD'] as const).map(currency => <p key={currency}>Sprzedaż: {display(resource.state.status === 'ready' ? resource.state.value.realized[currency] : null, ` ${currency}`)} · Dywidendy brutto: {display(resource.state.status === 'ready' ? resource.state.value.dividendsGross[currency] : null, ` ${currency}`)} · Opłaty i podatki: {display(resource.state.status === 'ready' ? resource.state.value.feesAndTaxes[currency] : null, ` ${currency}`)}</p>)}
    </>}
    <button type="button" onClick={resource.refresh}>Odśwież wycenę</button>{' '}
    <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>Historia wyceny</button>
    {showHistory && <ValuationHistory portfolioId={portfolioId} />}
  </section>;
}
function ValuationHistory({ portfolioId }: { portfolioId: string }) {
  const today = warsawToday();
  const [range, setRange] = useState({ from: new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10), to: today });
  const load = useCallback((signal: AbortSignal) => investmentMarketApi.history(portfolioId, range.from, range.to, signal), [portfolioId, range]);
  const resource = useInvestmentResource(load);
  return <section aria-label="Historia wyceny"><h3>Historia wartości i wyniku</h3>
    <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); setRange({ from: String(data.get('from')), to: String(data.get('to')) }); }}>
      <label>Wycena od<input type="date" name="from" required defaultValue={range.from} max={today} /></label>
      <label>Wycena do<input type="date" name="to" required defaultValue={range.to} max={today} /></label>
      <button type="submit">Pokaż historię</button>
    </form>
    {resource.state.status === 'loading' ? <p role="status">Ładowanie historii…</p> : resource.state.status === 'error' ? <p role="alert">{resource.state.message}</p> : <>
      <p>TWR: {display(resource.state.value.twrPercent, '%')}. Przepływy przyjmujemy na początek dnia; brak danych pozostaje luką.</p>
      <ul className={styles.list}>{resource.state.value.items.map(row => <li key={row.asOf}><time dateTime={row.asOf}>{row.asOf}</time> · Wartość: {display(row.valuePln)} · Wynik: {display(row.resultPln)}{row.pendingSplits.length > 0 && ` · Split do uzgodnienia: ${row.pendingSplits.map(split => split.ticker).join(', ')}`}</li>)}</ul>
    </>}
  </section>;
}
