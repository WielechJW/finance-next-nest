'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { marketCenterApi } from '@/lib/market-center-api';
import { formatInvestment } from '@/lib/investment-format';
import { warsawToday } from '@/lib/transaction-input';
import { useSession } from '../session-provider';
import { useInvestmentResource } from './use-investment-resource';
import styles from './investments.module.css';

export function MarketCenter() {
  const { state } = useSession();
  return state.status === 'authenticated' ? <MarketContent key={state.user.id} /> : null;
}
function MarketContent() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; ticker: string; currency: string } | null>(null);
  const [listId, setListId] = useState('');
  const [eventPage, setEventPage] = useState(1);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => { const [lists, alerts, events] = await Promise.all([marketCenterApi.lists(signal), marketCenterApi.alerts(signal), marketCenterApi.events(eventPage, signal)]); return { lists, alerts, events }; }, [eventPage]);
  const resource = useInvestmentResource(load);
  const search = useCallback((signal: AbortSignal) => marketCenterApi.search(query, signal), [query]);
  const results = useInvestmentResource(search);
  async function perform(operation: () => Promise<unknown>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await operation(); resource.refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać zmiany.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const lists = resource.state.status === 'ready' ? resource.state.value.lists : [];
  const targetList = lists.find(list => list.id === listId)?.id ?? lists[0]?.id;
  return <section className={styles.panel} aria-labelledby="market-heading"><h1 id="market-heading">Rynek i alerty</h1>
    <p>Ceny dzienne po sesji. Status przy cenie wskazuje jej aktualność.</p>
    <p role="alert">{error}</p>
    {resource.state.status === 'error' && <p role="alert">{resource.state.message}</p>}
    <section className={styles.card} aria-label="Wyszukiwarka instrumentów"><h2>Wyszukaj spółkę</h2>
      <form onSubmit={event => { event.preventDefault(); setQuery(String(new FormData(event.currentTarget).get('query') ?? '')); }}>
        <label>Symbol, nazwa lub ISIN<input name="query" maxLength={80} /></label><button type="submit">Szukaj</button>
      </form>
      {lists.length > 0 && <label>Docelowa watchlista<select value={targetList} onChange={event => setListId(event.target.value)}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>}
      {results.state.status === 'loading' ? <p role="status">Wyszukiwanie…</p> : results.state.status === 'error' ? <p role="alert">{results.state.message}</p> : <ul className={styles.list}>{results.state.value.map(instrument => <li key={instrument.id}>
        <Link href={`/dashboard/market/${instrument.id}`}>{instrument.ticker} · {instrument.mic}</Link>{instrument.name && <p>{instrument.name}</p>}
        <button type="button" disabled={busy || !targetList} onClick={() => { void perform(() => marketCenterApi.addItem(targetList!, instrument.id)); }}>Obserwuj {instrument.ticker}</button>{' '}
        <button type="button" onClick={() => setSelected(instrument)}>Ustaw alert {instrument.ticker}</button>
      </li>)}</ul>}
    </section>
    <section className={styles.card} aria-label="Watchlisty"><h2>Watchlisty</h2>
      <form onSubmit={event => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get('name') ?? ''); void perform(() => marketCenterApi.createList(name)); }}>
        <label>Nazwa watchlisty<input name="name" required maxLength={100} /></label><button type="submit" disabled={busy}>Utwórz watchlistę</button>
      </form>
      {lists.length === 0 && <p>Utwórz watchlistę, aby dodawać obserwowane spółki.</p>}
      {lists.map(list => <section key={list.id} aria-label={`Watchlista ${list.name}`}><h3>{list.name}</h3>
        <ul className={styles.list}>{list.items.map(item => <li key={item.instrument.id}><Link href={`/dashboard/market/${item.instrument.id}`}>{item.instrument.ticker}</Link>{' '}
          {item.quote ? `${formatInvestment(item.quote.close, 2)} ${item.instrument.currency} · ${item.quote.sessionOn}` : 'Brak ceny'} · {item.status === 'fresh' ? 'Aktualne' : 'Wymaga aktualizacji'}{' '}
          <button type="button" disabled={busy} onClick={() => { void perform(() => marketCenterApi.removeItem(list.id, item.instrument.id)); }}>Usuń {item.instrument.ticker} z watchlisty</button>
        </li>)}</ul>
        <button type="button" disabled={busy} onClick={() => { void perform(() => marketCenterApi.removeList(list.id)); }}>Usuń watchlistę {list.name}</button>
      </section>)}
    </section>
    <section className={styles.card} aria-label="Reguły alertów"><h2>Alerty cenowe</h2>
      <p>Alert reaguje na przejście przez próg. Pierwsza obserwacja ustala punkt odniesienia.</p>
      {selected && <form key={selected.id} aria-label={`Nowy alert ${selected.ticker}`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(() => marketCenterApi.createAlert({ instrumentId: selected.id, threshold: String(form.get('threshold')).replace(',', '.'), direction: String(form.get('direction')), mode: String(form.get('mode')), cooldownMinutes: Number(form.get('cooldown')) })); }}>
        <h3>Nowy alert: {selected.ticker} ({selected.currency})</h3>
        <label>Próg ceny<input name="threshold" inputMode="decimal" required /></label>
        <label>Kierunek<select name="direction"><option value="ABOVE">W górę do progu lub wyżej</option><option value="BELOW">W dół do progu lub niżej</option></select></label>
        <label>Tryb<select name="mode"><option value="ONCE">Jednorazowy</option><option value="REARM">Ponownie po powrocie na drugą stronę</option></select></label>
        <label>Przerwa między alertami (minuty)<input type="number" name="cooldown" min="0" max="525600" defaultValue="1440" required /></label>
        <button type="submit" disabled={busy}>Zapisz alert</button>
      </form>}
      {resource.state.status === 'ready' && <ul className={styles.list}>{resource.state.value.alerts.map(alert => <li key={alert.id}>
        {alert.ticker} · Próg {formatInvestment(alert.threshold, 2)} {alert.currency} · {alert.direction === 'ABOVE' ? 'W górę' : 'W dół'} · {alert.active ? 'Włączony' : 'Wyłączony'}{' '}
        <button type="button" disabled={busy} onClick={() => { void perform(() => marketCenterApi.active(alert.id, !alert.active)); }}>{alert.active ? 'Wyłącz alert' : 'Włącz alert'}</button>{' '}
        <button type="button" disabled={busy} onClick={() => { void perform(() => marketCenterApi.removeAlert(alert.id)); }}>Usuń alert</button>
      </li>)}</ul>}
      <h3>Historia alertów</h3>
      {resource.state.status === 'ready' && <ul className={styles.list}>{resource.state.value.events.items.map(event => <li key={event.id}>{event.ticker} · {event.sessionOn} · {formatInvestment(event.price, 2)} {event.currency} · próg {formatInvestment(event.threshold, 2)}</li>)}</ul>}
      <div className={styles.actions}><button type="button" disabled={eventPage <= 1} onClick={() => setEventPage(eventPage - 1)}>Poprzednie alerty</button><span>Strona alertów {eventPage}</span><button type="button" disabled={resource.state.status !== 'ready' || eventPage * 25 >= resource.state.value.events.total} onClick={() => setEventPage(eventPage + 1)}>Następne alerty</button></div>
    </section>
    <button type="button" onClick={resource.refresh}>Odśwież rynek i alerty</button>
  </section>;
}
export function MarketInstrument({ instrumentId }: { instrumentId: string }) {
  const { state } = useSession();
  return state.status === 'authenticated' ? <InstrumentContent key={`${state.user.id}:${instrumentId}`} instrumentId={instrumentId} /> : null;
}
function InstrumentContent({ instrumentId }: { instrumentId: string }) {
  const today = warsawToday();
  const load = useCallback((signal: AbortSignal) => marketCenterApi.detail(instrumentId, new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10), today, signal), [instrumentId, today]);
  const resource = useInvestmentResource(load);
  return <section className={styles.panel}><Link href="/dashboard/market">Rynek i alerty</Link>
    {resource.state.status === 'loading' ? <p role="status">Ładowanie instrumentu…</p> : resource.state.status === 'error' ? <p role="alert">{resource.state.message}</p> : <>
      <h1>{resource.state.value.instrument.ticker} · {resource.state.value.instrument.mic}</h1>
      <p>{resource.state.value.quote ? `${formatInvestment(resource.state.value.quote.close, 2)} ${resource.state.value.instrument.currency} · ${resource.state.value.quote.sessionOn}` : 'Brak ceny'} · {resource.state.value.status === 'fresh' ? 'Aktualne' : 'Wymaga aktualizacji'}</p>
      <h2>Historia cen dziennych</h2><ul className={styles.list}>{resource.state.value.prices.map(price => <li key={price.sessionOn}>{price.sessionOn} · {formatInvestment(price.close, 2)} {resource.state.status === 'ready' ? resource.state.value.instrument.currency : ''}</li>)}</ul>
    </>}
    <button type="button" onClick={resource.refresh}>Odśwież instrument</button>
  </section>;
}
