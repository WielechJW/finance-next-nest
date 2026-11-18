'use client';
import { useCallback, useRef, useState } from 'react';
import { investmentMarketApi, type CorporateActionProposal } from '@/lib/investment-market-api';
import { warsawToday } from '@/lib/transaction-input';
import { useInvestmentResource } from './use-investment-resource';
import styles from './investments.module.css';

export function CorporateActions({ portfolioId, accountId, onSaved }: { portfolioId: string; accountId: string; onSaved(): void }) {
  const load = useCallback((signal: AbortSignal) => investmentMarketApi.actions(portfolioId, accountId, signal), [portfolioId, accountId]);
  const resource = useInvestmentResource(load);
  return <section className={styles.card} aria-label="Zdarzenia korporacyjne"><h2>Dywidendy i splity</h2>
    <p>Dane rynkowe są propozycją. Zapisz operację po potwierdzeniu jej na swoim rachunku.</p>
    {resource.state.status === 'loading' ? <p role="status">Ładowanie zdarzeń…</p> : resource.state.status === 'error' ? <p role="alert">{resource.state.message}</p> : resource.state.value.length === 0 ? <p>Brak propozycji dla Twoich pozycji.</p> : resource.state.value.map(action => <ActionForm key={action.id} action={action} save={input => investmentMarketApi.confirmAction(portfolioId, accountId, action.id, input)} onSaved={() => { resource.refresh(); onSaved(); }} />)}
    <button type="button" onClick={resource.refresh}>Odśwież zdarzenia</button>
  </section>;
}
function ActionForm({ action, save, onSaved }: { action: CorporateActionProposal; save(input: unknown): Promise<unknown>; onSaved(): void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const payload = useRef<unknown>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  if (action.recordedEventId) return <p>{action.ticker} · {action.kind === 'SPLIT' ? 'Split' : 'Dywidenda'} · {action.exDate} · Zapisano{action.recordedRevisionDiffers ? '. Dostawca zmienił dane — sprawdź korektę w historii rachunku.' : '.'}</p>;
  return <form aria-label={`Potwierdzenie ${action.ticker} ${action.kind}`} onSubmit={event => {
    event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
    key.current ??= crypto.randomUUID();
    if (!unconfirmed) payload.current = { expectedRevision: action.revision, idempotencyKey: key.current, occurredOn: String(form.get('date')), daySequence: Number(form.get('sequence')), acknowledged: form.get('acknowledged') === 'on',
      ...(action.kind === 'DIVIDEND' ? { grossAmount: String(form.get('gross')).replace(',', '.'), withholdingTax: String(form.get('tax') || '0.00').replace(',', '.') } : {}) };
    setBusy(true); setError(''); void save(payload.current).then(onSaved, (error: unknown) => { setError(error instanceof Error ? error.message : 'Nie potwierdzono zapisu.'); setUnconfirmed(true); }).finally(() => setBusy(false));
  }}>
    <h3>{action.ticker} · {action.kind === 'SPLIT' ? `Split ${action.numerator}/${action.denominator}` : 'Dywidenda'}</h3>
    <fieldset disabled={busy || unconfirmed}>
      <label>Data rzeczywistej operacji<input type="date" name="date" required defaultValue={action.kind === 'SPLIT' ? action.exDate : action.paymentOn ?? warsawToday()} min={action.exDate} max={warsawToday()} /></label>
      <label>Kolejność operacji w dniu<input type="number" name="sequence" min="1" max="2147483647" defaultValue="1" required /></label>
      {action.kind === 'DIVIDEND' && <><label>Rzeczywista kwota brutto<input name="gross" inputMode="decimal" defaultValue={action.suggestedGrossAmount ?? ''} required /></label><label>Potrącony podatek<input name="tax" inputMode="decimal" defaultValue="0.00" /></label></>}
      <label><input type="checkbox" name="acknowledged" required />Potwierdzam zdarzenie na rachunku</label>
    </fieldset>
    <p role="alert">{error}</p>
    <button type="submit" disabled={busy}>{unconfirmed ? 'Ponów ten sam zapis' : 'Zapisz potwierdzone zdarzenie'}</button>
    {unconfirmed && <button type="button" onClick={() => { setUnconfirmed(false); key.current = null; payload.current = null; }}>Popraw dane</button>}
  </form>;
}
