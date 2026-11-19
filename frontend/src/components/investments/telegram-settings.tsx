'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notificationsApi } from '@/lib/notifications-api';
import { useInvestmentResource } from './use-investment-resource';
import styles from './investments.module.css';
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minutes = (value: FormDataEntryValue | null) => { const [hour, minute] = String(value).split(':').map(Number); return hour * 60 + minute; };
const states: Record<string, string> = { PENDING: 'Oczekuje', PROCESSING: 'Wysyłanie', SENT: 'Wysłano', UNKNOWN: 'Nieznany wynik', FAILED: 'Błąd', CANCELLED: 'Anulowano' };
export function TelegramSettings() {
  const [page, setPage] = useState(1), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ack, setAck] = useState(false);
  const [pairing, setPairing] = useState<Awaited<ReturnType<typeof notificationsApi.pair>> | null>(null);
  const lock = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => { const [status, history] = await Promise.all([notificationsApi.status(signal), notificationsApi.history(page, signal)]); return { status, history }; }, [page]);
  const resource = useInvestmentResource(load), refresh = resource.refresh;
  const connected = resource.state.status === 'ready' && resource.state.value.status.connected;
  useEffect(() => {
    if (!pairing || connected || Date.parse(pairing.expiresAt) <= Date.now()) return;
    const timer = setInterval(refresh, 5000); const expiry = setTimeout(() => setPairing(null), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => { clearInterval(timer); clearTimeout(expiry); };
  }, [pairing, connected, refresh]);
  async function perform(action: () => Promise<unknown>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await action(); refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać ustawień.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={styles.card} aria-label="Powiadomienia Telegram"><h2 id="telegram">Powiadomienia Telegram</h2><p role="alert">{error}</p>
    {resource.state.status === 'loading' ? <p role="status">Ładowanie powiadomień…</p> : resource.state.status === 'error' ? <p role="alert">{resource.state.message}</p> : <>
      {!resource.state.value.status.configured ? <p>Telegram czeka na konfigurację serwera. Alerty zapisują się w historii aplikacji.</p> : !connected ? <>
        <p>Połącz prywatną rozmowę z botem, aby otrzymywać alerty po zamknięciu strony.</p>
        <button type="button" disabled={busy} onClick={() => { void perform(async () => setPairing(await notificationsApi.pair())); }}>Połącz Telegram</button>
        {pairing && <p>W prywatnej rozmowie wyślij <code>/start {pairing.code}</code>. Kod wygasa {new Date(pairing.expiresAt).toLocaleTimeString('pl-PL')}.{pairing.url && /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]+$/.test(pairing.url) && <> <a href={pairing.url} target="_blank" rel="noreferrer">Otwórz bota w Telegramie</a></>}</p>}
      </> : <>
        <p>Telegram połączony.</p>
        <form key={JSON.stringify(resource.state.value.status)} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void perform(() => notificationsApi.settings({ quietStart: minutes(data.get('start')), quietEnd: minutes(data.get('end')), timeZone: String(data.get('zone')), dailySummaryEnabled: data.get('summary') === 'on' })); }}>
          <label>Cisza od<input type="time" name="start" defaultValue={time(resource.state.value.status.quietStart)} required /></label>
          <label>Cisza do<input type="time" name="end" defaultValue={time(resource.state.value.status.quietEnd)} required /></label>
          <label>Strefa czasowa<select name="zone" defaultValue={resource.state.value.status.timeZone}><option>Europe/Warsaw</option><option>America/New_York</option><option>UTC</option></select></label>
          <label><input type="checkbox" name="summary" defaultChecked={resource.state.value.status.dailySummaryEnabled} /> Podsumowanie po sesjach GPW i USA</label>
          <p>Równe godziny wyłączają ciszę. Alert czeka do jej końca, maksymalnie 24 godziny od zdarzenia.</p>
          <button type="submit" disabled={busy}>Zapisz powiadomienia</button>
        </form>
        <button type="button" disabled={busy} onClick={() => { void perform(async () => { await notificationsApi.disconnect(); setPairing(null); }); }}>Odłącz Telegram</button>
      </>}
      <h3>Historia dostarczenia</h3><p>Nieznany wynik może oznaczać doręczenie. Ponowienie wymaga świadomej zgody na możliwy duplikat.</p>
      <label><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /> Akceptuję ryzyko ponownego doręczenia</label>
      <ul className={styles.list}>{resource.state.value.history.items.map(n => <li key={n.id}><p>{n.body}</p><p>{states[n.state] ?? n.state} · próby {n.attempts}</p>
        {['FAILED', 'UNKNOWN'].includes(n.state) && n.attempts < 5 && <button type="button" disabled={busy || (n.state === 'UNKNOWN' && !ack)} onClick={() => { void perform(() => notificationsApi.retry(n.id, ack)); }}>Ponów powiadomienie</button>}
      </li>)}</ul>
      <div className={styles.actions}><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Poprzednie powiadomienia</button><span>Strona {page}</span><button type="button" disabled={page * 25 >= resource.state.value.history.total} onClick={() => setPage(page + 1)}>Następne powiadomienia</button></div>
    </>}
    <button type="button" onClick={refresh}>Odśwież powiadomienia</button>
  </section>;
}
