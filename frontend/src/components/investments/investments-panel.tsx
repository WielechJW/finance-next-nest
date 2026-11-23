"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { formatInvestment } from "@/lib/investment-format";
import {
  investmentsApi,
  type InvestmentEvent,
  type InvestmentInstrument,
  type InvestmentQuery,
} from "@/lib/investments-api";
import { warsawToday } from "@/lib/transaction-input";
import { useSession } from "../session-provider";
import { InvestmentForm, investmentLabels } from "./investment-form";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";
import { PortfolioValuation } from './portfolio-valuation';
import { CorporateActions } from './corporate-actions';

const root = "/dashboard/investments";
export function InvestmentsPanel({
  portfolioId,
  accountId,
}: {
  portfolioId?: string;
  accountId?: string;
}) {
  const { state } = useSession();
  if (state.status !== "authenticated") return null;
  return (
    <div
      className={styles.panel}
      key={`${state.user.id}:${portfolioId}:${accountId}`}
    >
      {portfolioId && accountId ? (
        <AccountContent portfolioId={portfolioId} accountId={accountId} />
      ) : portfolioId ? (
        <PortfolioContent portfolioId={portfolioId} />
      ) : (
        <PortfolioList />
      )}
    </div>
  );
}

function ResourceStatus({
  state,
  retry,
}: {
  state: { status: string; message?: string };
  retry(): void;
}) {
  return state.status === "error" ? (
    <div>
      <p role="alert" className={styles.error}>
        {state.message}
      </p>
      <button type="button" onClick={retry}>
        Spróbuj ponownie
      </button>
    </div>
  ) : (
    <p role="status">Ładowanie inwestycji…</p>
  );
}

function NameForm({
  label,
  button,
  save,
}: {
  label: string;
  button: string;
  save(name: string): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await save(name.trim());
      setName("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Nie udało się zapisać nazwy.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      aria-label={button}
      className={styles.card}
      onSubmit={(event) => void submit(event)}
    >
      <div className={styles.nameForm}>
        <label>
          {label}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            pattern=".*\S.*"
            disabled={busy}
          />
        </label>
        <button disabled={busy} type="submit">
          {busy ? "Zapisywanie…" : button}
        </button>
      </div>
      <p role="alert" className={styles.error}>
        {error}
      </p>
    </form>
  );
}

function PortfolioList() {
  const load = useCallback(
    (signal: AbortSignal) => investmentsApi.portfolios(signal),
    [],
  );
  const resource = useInvestmentResource(load);
  return (
    <section aria-labelledby="investments-heading">
      <h1 id="investments-heading">Inwestycje</h1>
      <p>
        Prowadź ręcznie portfele akcji GPW i USA. Gotówka i koszt zakupu są
        rozdzielone według walut.
      </p>
      {resource.state.status !== "ready" ? (
        <ResourceStatus state={resource.state} retry={resource.refresh} />
      ) : (
        <section className={styles.card} aria-label="Twoje portfele"><h2>Twoje portfele</h2>
          {resource.state.value.length === 0 ? (
            <p>
              Nie masz jeszcze portfela inwestycyjnego. Utwórz pierwszy portfel.
            </p>
          ) : (
            <ul className={styles.list}>
              {resource.state.value.map((item) => (
                <li key={item.id}>
                  <Link href={`${root}/${item.id}`}>{item.name}</Link>
                </li>
              ))}
            </ul>
          )}
          <NameForm
            label="Nazwa portfela inwestycyjnego"
            button="Utwórz portfel"
            save={async (name) => {
              await investmentsApi.createPortfolio(name);
              resource.refresh();
            }}
          />
        </section>
      )}
    </section>
  );
}

function PortfolioContent({ portfolioId }: { portfolioId: string }) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [portfolio, accounts] = await Promise.all([
        investmentsApi.portfolio(portfolioId, signal),
        investmentsApi.accounts(portfolioId, signal),
      ]);
      return { portfolio, accounts };
    },
    [portfolioId],
  );
  const resource = useInvestmentResource(load);
  return (
    <section aria-labelledby="portfolio-heading">
      <Link href={root}>Wszystkie portfele</Link>
      <h1 id="portfolio-heading">
        {resource.state.status === "ready"
          ? resource.state.value.portfolio.name
          : "Portfel inwestycyjny"}
      </h1>
      {resource.state.status !== "ready" ? (
        <ResourceStatus state={resource.state} retry={resource.refresh} />
      ) : (
        <>
          <section className={styles.card} aria-label="Rachunki inwestycyjne"><h2>Rachunki inwestycyjne</h2>
          {resource.state.value.accounts.length === 0 ? (
            <p>
              Ten portfel nie ma jeszcze rachunków. Utwórz rachunek, aby zapisać
              pierwszą wpłatę.
            </p>
          ) : (
            <ul className={styles.list}>
              {resource.state.value.accounts.map((item) => (
                <li key={item.id}>
                  <Link href={`${root}/${portfolioId}/accounts/${item.id}`}>
                    {item.name}
                  </Link>
                  {item.archivedAt && <span> · Zarchiwizowany</span>}
                </li>
              ))}
            </ul>
          )}
          <NameForm
            label="Nazwa rachunku"
            button="Utwórz rachunek"
            save={async (name) => {
              await investmentsApi.createAccount(portfolioId, name);
              resource.refresh();
            }}
          />
          </section>
          <PortfolioValuation portfolioId={portfolioId} />
        </>
      )}
    </section>
  );
}

function AccountContent({
  portfolioId,
  accountId,
}: {
  portfolioId: string;
  accountId: string;
}) {
  const [query, setQuery] = useState<InvestmentQuery>({ page: 1 });
  const [selection, setSelection] = useState<InvestmentEvent | null>(null);
  const correctionTrigger = useRef<HTMLButtonElement | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [account, summary, history, latest] =
        await Promise.all([
          investmentsApi.account(portfolioId, accountId, signal),
          investmentsApi.summary(portfolioId, accountId, signal),
          investmentsApi.history(portfolioId, accountId, query, signal),
          investmentsApi.history(portfolioId, accountId, { page: 1 }, signal),
        ]);
      return { account, summary, history, latest };
    },
    [portfolioId, accountId, query],
  );
  const resource = useInvestmentResource(load);
  function saved() {
    setNotice(selection ? "Korekta zapisana." : "Operacja zapisana.");
    setSelection(null);
    setQuery({ ...query, page: 1 });
    resource.refresh();
  }
  function navigate(next: InvestmentQuery) {
    setQuery(next);
    resource.refresh();
  }
  const ready = resource.state.status === "ready" ? resource.state.value : null;
  return (
    <section aria-labelledby="account-heading">
      <Link href={`${root}/${portfolioId}`}>Rachunki portfela</Link>
      <h1 id="account-heading">
        {ready?.account.name ?? "Rachunek inwestycyjny"}
      </h1>
      <p role="status" className={styles.notice}>
        {notice}
      </p>
      {!ready ? (
        <ResourceStatus state={resource.state} retry={resource.refresh} />
      ) : (
        <>
          {ready.account.archivedAt && (
            <p>Rachunek zarchiwizowany. Historia i stan pozostają dostępne.</p>
          )}
          <Link href={`${root}/${portfolioId}/accounts/${accountId}/imports`}>Import historii CSV</Link>
          <section className={styles.card} aria-label="Gotówka inwestycyjna">
            <h2>Gotówka</h2>
            <dl className={styles.balances}>
              {(["PLN", "USD"] as const).map((currency) => (
                <div key={currency}>
                  <dt>Gotówka {currency}</dt>
                  <dd>
                    {formatInvestment(ready.summary.cash[currency], 2)}{" "}
                    {currency}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={styles.card} aria-label="Posiadane akcje">
            <h2>Posiadane akcje</h2>
            {ready.summary.positions.length === 0 ? (
              <p>Nie masz otwartych pozycji na tym rachunku.</p>
            ) : (
              <ul className={styles.list}>
                {ready.summary.positions.map((position) => {
                  const instrument = ready.summary.instruments.find(
                    (item) => item.id === position.instrumentId,
                  );
                  return (
                    <li key={position.instrumentId}>
                      <h3>
                        {instrument?.ticker ?? position.instrumentId} ·{" "}
                        {instrument?.mic}
                      </h3>
                      <dl>
                        <div>
                          <dt>Ilość akcji</dt>
                          <dd>{formatInvestment(position.quantity)}</dd>
                        </div>
                        <div>
                          <dt>Koszt pozostałych akcji</dt>
                          <dd>
                            {formatInvestment(position.cost, 2)}{" "}
                            {position.currency}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className={styles.hint}>
              Koszt obejmuje prowizje zakupu. Bieżącą wycenę znajdziesz w podsumowaniu portfela.
            </p>
          </section>
          {!ready.account.archivedAt && (
            <InvestmentForm
              key={selection?.id ?? "new"}
              portfolioId={portfolioId}
              accountId={accountId}
              sequence={
                Math.max(
                  0,
                  ...ready.latest.items
                    .filter((item) => item.occurredOn === warsawToday())
                    .map((item) => item.daySequence),
                ) + 1
              }
              selection={selection ?? undefined}
              onSaved={saved}
              onCancel={
                selection
                  ? () => {
                      setSelection(null);
                      requestAnimationFrame(() =>
                        correctionTrigger.current?.focus(),
                      );
                    }
                  : undefined
              }
            />
          )}
          {!ready.account.archivedAt && <CorporateActions portfolioId={portfolioId} accountId={accountId} onSaved={saved} />}
          <section
            aria-label="Historia operacji inwestycyjnych"
            className={styles.card}
          >
            <h2>Historia operacji</h2>
            <HistoryFilters query={query} instruments={ready.summary.instruments} apply={navigate} />
            {ready.history.items.length === 0 ? (
              <p>Brak operacji spełniających wybrane filtry.</p>
            ) : (
              <ol className={styles.list}>
                {ready.history.items.map((event) => (
                  <li key={event.id}>
                    <h3>
                      {investmentLabels[event.type] ?? event.type}
                      {event.trade && ` · ${event.trade.instrument.ticker}`}
                      {event.split && ` · ${event.split.instrument.ticker} · ${formatInvestment(event.split.numerator)}:${formatInvestment(event.split.denominator)}`}
                    </h3>
                    <p>
                      <time dateTime={event.occurredOn}>
                        {event.occurredOn.split("-").reverse().join(".")}
                      </time>{" "}
                      · Kolejność {event.daySequence}
                      {event.revision > 0 && ` · Wersja ${event.revision}`}
                    </p>
                    {event.trade && (
                      <p>
                        {formatInvestment(event.trade.quantity)} akcji ×{" "}
                        {formatInvestment(event.trade.unitPrice, 2)}{" "}
                        {event.trade.instrument.currency}
                      </p>
                    )}
                    {event.cashEntries.map((entry, index) => (
                      <p key={index}>
                        {entry.kind === "COMMISSION" ? "Prowizja: " : ""}
                        {formatInvestment(entry.amount, 2)} {entry.currency}
                      </p>
                    ))}
                    {event.correctionReason && (
                      <p>Powód korekty: {event.correctionReason}</p>
                    )}
                    {ready.summary.sales
                      .filter((sale) => sale.eventId === event.id)
                      .map((sale) => (
                        <p key={sale.eventId}>
                          Wynik sprzedaży: {formatInvestment(sale.result, 2)}{" "}
                          {sale.currency}
                        </p>
                      ))}
                    {!ready.account.archivedAt &&
                      ["DEPOSIT", "BUY", "SELL"].includes(event.type) && (
                        <button
                          type="button"
                          onClick={(click) => {
                            correctionTrigger.current = click.currentTarget;
                            setSelection(event);
                            setNotice("");
                          }}
                          aria-label={`Koryguj: ${investmentLabels[event.type]}${event.trade ? ` ${event.trade.instrument.ticker}` : ""}`}
                        >
                          Koryguj
                        </button>
                      )}
                  </li>
                ))}
              </ol>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={query.page <= 1}
                onClick={() => navigate({ ...query, page: query.page - 1 })}
              >
                Poprzednia strona
              </button>
              <span>
                Strona {query.page} · Operacje: {ready.history.total}
              </span>
              <button
                type="button"
                disabled={
                  query.page * ready.history.pageSize >= ready.history.total
                }
                onClick={() => navigate({ ...query, page: query.page + 1 })}
              >
                Następna strona
              </button>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function HistoryFilters({
  query,
  instruments,
  apply,
}: {
  query: InvestmentQuery;
  instruments: InvestmentInstrument[];
  apply(query: InvestmentQuery): void;
}) {
  return (
    <form
      aria-label="Filtry operacji"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        apply({
          page: 1,
          instrumentId: String(data.get("instrumentId") ?? "") || undefined,
          type: String(data.get("type") ?? "") || undefined,
          from: String(data.get("from") ?? "") || undefined,
          to: String(data.get("to") ?? "") || undefined,
        });
      }}
    >
      <div className={styles.fields}>
        <label>
          Instrument w historii
          <select name="instrumentId" defaultValue={query.instrumentId ?? ""}>
            <option value="">Wszystkie instrumenty</option>
            {instruments.map(item => <option key={item.id} value={item.id}>{item.ticker} · {item.mic}</option>)}
          </select>
        </label>
        <label>
          Filtr typu
          <select name="type" defaultValue={query.type ?? ""}>
            <option value="">Wszystkie</option>
            {Object.entries(investmentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Data od
          <input type="date" name="from" defaultValue={query.from} />
        </label>
        <label>
          Data do
          <input type="date" name="to" defaultValue={query.to} />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit">Filtruj</button>
        <button type="button" onClick={() => apply({ page: 1 })}>
          Wyczyść filtry
        </button>
      </div>
    </form>
  );
}
