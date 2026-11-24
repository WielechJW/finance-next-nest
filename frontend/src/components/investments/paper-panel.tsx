"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type FormEvent } from "react";
import {
  formatInvestment as format,
  investmentInput,
} from "@/lib/investment-format";
import type { InvestmentInstrument } from "@/lib/investments-api";
import {
  paperApi,
  type PaperAction,
  type PaperFault,
  type PaperOrder,
  type PaperSignal,
} from "@/lib/paper-api";
import { warsawToday } from "@/lib/transaction-input";
import { useSession } from "../session-provider";
import { InstrumentPicker } from "./instrument-picker";
import styles from "./investments.module.css";
import { useInvestmentResource } from "./use-investment-resource";

const path = "/dashboard/investments/paper";
const list = (signal: AbortSignal) => paperApi.list(signal);
const labels: Record<string, string> = {
  INTENT: "Intencja",
  SENT: "Wysłane",
  ACCEPTED: "Przyjęte",
  PARTIALLY_FILLED: "Częściowo wykonane",
  FILLED: "Wykonane",
  REJECTED: "Odrzucone",
  CANCELLED: "Anulowane",
  UNKNOWN: "Nieznany wynik",
  FILL: "Wykonanie",
};
const differences: Record<string, string> = {
  cash: "Saldo",
  available: "Dostępna gotówka",
  positions: "Pozycja",
};
const sideName = (side: string) => (side === "BUY" ? "Kupno" : "Sprzedaż");
const clock = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});
const dateTime = (value: string) => clock.format(new Date(value));

function useOperation() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function run(operation: () => Promise<string | void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage((await operation()) ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Nie udało się wykonać akcji.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, message, error, run };
}

function Notice({ message, error }: { message: string; error: string }) {
  return (
    <>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  );
}

function LoadStatus({
  state,
  retry,
}: {
  state: { status: "loading" } | { status: "error"; message: string };
  retry(): void;
}) {
  return state.status === "loading" ? (
    <p role="status">Wczytywanie…</p>
  ) : (
    <div>
      <p role="alert">{state.message}</p>
      <button type="button" onClick={retry}>
        Ponów odczyt
      </button>
    </div>
  );
}

function OpeningForm({ created }: { created(id: string): void }) {
  const [name, setName] = useState("");
  const [pln, setPln] = useState("10000");
  const [usd, setUsd] = useState("2500");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const operation = useOperation();
  function submit(event: FormEvent) {
    event.preventDefault();
    void operation.run(async () => {
      const body = {
        name: name.trim(),
        openingOn: warsawToday(),
        cash: {
          PLN: investmentInput(pln, 2, true),
          USD: investmentInput(usd, 2, true),
        },
      };
      const payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      const connection = await paperApi.create({
        ...body,
        idempotencyKey: attempt.current.key,
      });
      attempt.current = null;
      setName("");
      created(connection.id);
      return "Utworzono rachunek symulowany.";
    });
  }
  return (
    <section className={styles.card} aria-labelledby="paper-new-account">
      <h2 id="paper-new-account">Nowy rachunek symulowany</h2>
      <form aria-label="Nowy rachunek symulowany" onSubmit={submit}>
        <fieldset className={styles.fields} disabled={operation.busy}>
          <label>
            Nazwa rachunku
            <input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Kapitał PLN
            <input
              required
              inputMode="decimal"
              value={pln}
              onChange={(event) => setPln(event.target.value)}
            />
          </label>
          <label>
            Kapitał USD
            <input
              required
              inputMode="decimal"
              value={usd}
              onChange={(event) => setUsd(event.target.value)}
            />
          </label>
        </fieldset>
        <button type="submit" disabled={operation.busy}>
          Utwórz rachunek symulowany
        </button>
      </form>
      <Notice {...operation} />
    </section>
  );
}

function NewOrder({
  connectionId,
  signal,
  existing,
  onChange,
}: {
  connectionId: string;
  signal: PaperSignal | null;
  existing: PaperOrder | undefined;
  onChange(): void;
}) {
  const [instrument, setInstrument] = useState<InvestmentInstrument | null>(
    null,
  );
  const [side, setSide] = useState("BUY");
  const [type, setType] = useState("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const operation = useOperation();
  const expired = signal && new Date(signal.validUntil) <= new Date();

  function submit(event: FormEvent) {
    event.preventDefault();
    void operation.run(async () => {
      const chosen = signal?.instrument ?? instrument;
      if (!chosen) throw new Error("Wybierz instrument.");
      const body = {
        instrumentId: chosen.id,
        side: signal?.side ?? side,
        type,
        quantity: investmentInput(quantity, 10),
        ...(type === "LIMIT"
          ? { limitPrice: investmentInput(limitPrice, 10) }
          : {}),
        ...(signal ? { signalId: signal.id } : {}),
      };
      const payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      await paperApi.order(connectionId, {
        ...body,
        idempotencyKey: attempt.current.key,
      });
      attempt.current = null;
      onChange();
      return "Zapisano intencję zlecenia.";
    });
  }

  return (
    <section className={styles.card} aria-labelledby="paper-new-order">
      <h2 id="paper-new-order">Nowa intencja</h2>
      {signal && (
        <>
          <p>
            Ze strategii: {sideName(signal.side)} {signal.instrument.ticker} ·{" "}
            {signal.instrument.mic}. Ważność do {dateTime(signal.validUntil)}.
          </p>
          <Link href={path}>Utwórz intencję bez powiązania z sygnałem</Link>
        </>
      )}
      {existing ? (
        <p>Ten sygnał ma już zlecenie na tym rachunku.</p>
      ) : expired ? (
        <p role="alert">Wygasła ważność sygnału.</p>
      ) : (
        <form aria-label="Nowa intencja" onSubmit={submit}>
          <fieldset className={styles.fields} disabled={operation.busy}>
            {!signal && (
              <>
                <InstrumentPicker
                  selected={instrument}
                  onChange={setInstrument}
                />
                <label>
                  Strona
                  <select
                    value={side}
                    onChange={(event) => setSide(event.target.value)}
                  >
                    <option value="BUY">Kupno</option>
                    <option value="SELL">Sprzedaż</option>
                  </select>
                </label>
              </>
            )}
            <label>
              Typ zlecenia
              <select
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="MARKET">Rynkowe</option>
                <option value="LIMIT">Z limitem</option>
              </select>
            </label>
            <label>
              Ilość zlecenia
              <input
                required
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            {type === "LIMIT" && (
              <label>
                Cena limitu
                <input
                  required
                  inputMode="decimal"
                  value={limitPrice}
                  onChange={(event) => setLimitPrice(event.target.value)}
                />
              </label>
            )}
          </fieldset>
          <button type="submit" disabled={operation.busy}>
            Zapisz intencję
          </button>
        </form>
      )}
      <Notice {...operation} />
    </section>
  );
}

function OrderControls({
  connectionId,
  order,
  requiresReconciliation,
  updated,
}: {
  connectionId: string;
  order: PaperOrder;
  requiresReconciliation: boolean;
  updated(): void;
}) {
  const [fault, setFault] = useState<PaperFault>("NONE");
  const [action, setAction] = useState<PaperAction>("FILL");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const operation = useOperation();

  function submit() {
    void operation.run(async () => {
      const result = await paperApi.submit(connectionId, order.id, fault);
      if (result.sessionExpired) {
        throw new Error(
          "Sesja symulatora wygasła przed wysyłką. Wybierz zwykłą wysyłkę, aby ponowić.",
        );
      }
      updated();
    });
  }

  function simulate(event: FormEvent) {
    event.preventDefault();
    void operation.run(async () => {
      const fill =
        action === "FILL"
          ? {
              quantity: investmentInput(quantity, 10),
              price: investmentInput(price, 10),
              fee: investmentInput(fee, 2, true),
            }
          : undefined;
      const payload = JSON.stringify([action, fill]);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      await paperApi.simulate(connectionId, order.id, {
        kind: action,
        fill,
        idempotencyKey: attempt.current.key,
      });
      attempt.current = null;
      updated();
    });
  }

  const locked = operation.busy || requiresReconciliation;
  return (
    <>
      {order.state === "INTENT" && (
        <div className={styles.nameForm}>
          <label>
            Scenariusz wysyłki
            <select
              value={fault}
              disabled={locked}
              onChange={(event) => setFault(event.target.value as PaperFault)}
            >
              <option value="NONE">Zwykła wysyłka</option>
              <option value="SESSION_EXPIRED">Wygasła sesja</option>
              <option value="BEFORE_RECEIPT">
                Utrata połączenia przed przyjęciem
              </option>
              <option value="AFTER_RECEIPT">
                Brak odpowiedzi po przyjęciu
              </option>
            </select>
          </label>
          <button type="button" disabled={locked} onClick={submit}>
            Wyślij do symulatora
          </button>
        </div>
      )}
      {(order.state === "ACCEPTED" || order.state === "PARTIALLY_FILLED") && (
        <form aria-label="Zdarzenie symulatora" onSubmit={simulate}>
          <fieldset className={styles.fields} disabled={locked}>
            <label>
              Zdarzenie
              <select
                value={action}
                onChange={(event) =>
                  setAction(event.target.value as PaperAction)
                }
              >
                <option value="FILL">Wykonanie</option>
                <option value="CANCELLED">Anulowanie</option>
                {order.state === "ACCEPTED" && (
                  <option value="REJECTED">Odrzucenie</option>
                )}
              </select>
            </label>
            {action === "FILL" && (
              <>
                <label>
                  Ilość wykonania
                  <input
                    required
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
                <label>
                  Cena wykonania w {order.instrument.currency}
                  <input
                    required
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </label>
                <label>
                  Prowizja w {order.instrument.currency}
                  <input
                    required
                    inputMode="decimal"
                    value={fee}
                    onChange={(event) => setFee(event.target.value)}
                  />
                </label>
              </>
            )}
          </fieldset>
          <button type="submit" disabled={locked}>
            Zapisz zdarzenie symulatora
          </button>
        </form>
      )}
      <Notice {...operation} />
    </>
  );
}

function Orders({
  account,
  updated,
}: {
  account: Awaited<ReturnType<typeof paperApi.account>>;
  updated(): void;
}) {
  return (
    <section className={styles.card} aria-labelledby="paper-orders">
      <h2 id="paper-orders">Zlecenia symulowane</h2>
      {account.orders.length === 0 ? (
        <p>Brak zleceń na rachunku.</p>
      ) : (
        <ul className={styles.list}>
          {account.orders.map((order) => (
            <li key={order.id}>
              <article
                aria-label={`Zlecenie ${order.instrument.ticker} ${order.clientOrderId}`}
              >
                <h3>
                  {order.instrument.ticker} · {order.instrument.mic} ·{" "}
                  {sideName(order.side)}
                </h3>
                <dl>
                  <div>
                    <dt>Stan</dt>
                    <dd>{labels[order.state] ?? order.state}</dd>
                  </div>
                  <div>
                    <dt>Wykonano</dt>
                    <dd>
                      {format(order.filledQuantity)} z {format(order.quantity)}
                    </dd>
                  </div>
                  <div>
                    <dt>Typ</dt>
                    <dd>
                      {order.limitPrice
                        ? `Limit ${format(order.limitPrice)} ${order.instrument.currency}`
                        : "Rynkowe"}
                    </dd>
                  </div>
                  {order.signalId && (
                    <div>
                      <dt>Źródło</dt>
                      <dd>Sygnał strategii</dd>
                    </div>
                  )}
                </dl>
                <OrderControls
                  connectionId={account.id}
                  order={order}
                  requiresReconciliation={account.reconciliationRequired}
                  updated={updated}
                />
                <details>
                  <summary>Historia i identyfikatory</summary>
                  <p>Identyfikator zlecenia {order.clientOrderId}</p>
                  {order.signalId && (
                    <p>Identyfikator sygnału {order.signalId}</p>
                  )}
                  {order.events.map((event) => (
                    <p key={event.id}>
                      {dateTime(event.happenedAt)} ·{" "}
                      {labels[event.kind] ?? event.kind}
                    </p>
                  ))}
                  {order.fills.map((fill) => (
                    <p key={fill.id}>
                      {format(fill.quantity)} × {format(fill.price)}{" "}
                      {order.instrument.currency} · prowizja{" "}
                      {format(fill.fee, 2)} · {fill.id}
                    </p>
                  ))}
                </details>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reconciliation({
  account,
  updated,
}: {
  account: Awaited<ReturnType<typeof paperApi.account>>;
  updated(): void;
}) {
  const operation = useOperation();
  const report = account.reconciliation;
  return (
    <section className={styles.card} aria-labelledby="paper-reconciliation">
      <h2 id="paper-reconciliation">Uzgodnienie rachunku</h2>
      {account.reconciliationRequired && (
        <p role="status">
          Rachunek wymaga uzgodnienia. Wysyłka kolejnych zleceń jest wstrzymana.
        </p>
      )}
      <button
        type="button"
        disabled={operation.busy}
        onClick={() =>
          void operation.run(async () => {
            await paperApi.reconcile(account.id);
            updated();
          })
        }
      >
        Uzgodnij rachunek
      </button>
      <Notice {...operation} />
      {report && (
        <>
          <p>
            {report.matched ? "Rachunek uzgodniony" : "Wykryto rozbieżności"} ·{" "}
            {dateTime(report.createdAt)}
          </p>
          {report.error && <p role="alert">{report.error}</p>}
          {report.differences && !report.matched && (
            <ul>
              {report.differences.openOrders.map((id) => (
                <li key={id}>Rozbieżne zlecenie {id}</li>
              ))}
              {report.differences.fills.map((id) => (
                <li key={id}>Rozbieżne wykonanie {id}</li>
              ))}
              {report.differences.amounts.map((item) => (
                <li key={`${item.type}-${item.key}`}>
                  {differences[item.type]} {item.key} · rejestr{" "}
                  {format(item.recorded)} · symulator {format(item.observed)}
                </li>
              ))}
            </ul>
          )}
          {report.available && !account.reconciliationRequired && (
            <p>
              Dostępna gotówka po rezerwacjach {format(report.available.PLN, 2)}{" "}
              PLN · {format(report.available.USD, 2)} USD
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Account({ id, signalId }: { id: string; signalId?: string }) {
  const load = useCallback(
    (abort: AbortSignal) => paperApi.account(id, abort),
    [id],
  );
  const loadSignal = useCallback(
    (abort: AbortSignal) =>
      signalId ? paperApi.signal(signalId, abort) : Promise.resolve(null),
    [signalId],
  );
  const account = useInvestmentResource(load);
  const signal = useInvestmentResource(loadSignal);
  if (account.state.status !== "ready")
    return <LoadStatus state={account.state} retry={account.refresh} />;
  const value = account.state.value;
  const positions = value.positions.filter(({ quantity }) =>
    /[1-9]/.test(quantity),
  );
  return (
    <>
      <section className={styles.card} aria-labelledby="paper-balances">
        <h2 id="paper-balances">Gotówka i pozycje</h2>
        <dl className={styles.balances}>
          <div>
            <dt>Gotówka PLN</dt>
            <dd>{format(value.cash.PLN, 2)} PLN</dd>
          </div>
          <div>
            <dt>Gotówka USD</dt>
            <dd>{format(value.cash.USD, 2)} USD</dd>
          </div>
        </dl>
        {positions.length ? (
          <ul className={styles.list} aria-label="Otwarte pozycje">
            {positions.map((position) => (
              <li key={position.id}>
                {position.ticker} · {position.mic} · {format(position.quantity)}{" "}
                szt.
              </li>
            ))}
          </ul>
        ) : (
          <p>Brak otwartych pozycji.</p>
        )}
      </section>
      {signal.state.status === "ready" ? (
        <NewOrder
          connectionId={id}
          signal={signal.state.value}
          existing={
            signalId
              ? value.orders.find((order) => order.signalId === signalId)
              : undefined
          }
          onChange={account.refresh}
        />
      ) : (
        <section className={styles.card}>
          <LoadStatus state={signal.state} retry={signal.refresh} />
          {signalId && <Link href={path}>Otwórz symulator bez sygnału</Link>}
        </section>
      )}
      <Orders account={value} updated={account.refresh} />
      <Reconciliation account={value} updated={account.refresh} />
    </>
  );
}

function Accounts({ signalId }: { signalId?: string }) {
  const [selected, setSelected] = useState("");
  const { state, refresh } = useInvestmentResource(list);
  const accounts = state.status === "ready" ? state.value : [];
  const account = accounts.find(({ id }) => id === selected) ?? accounts[0];
  return (
    <>
      <OpeningForm
        created={(id) => {
          setSelected(id);
          refresh();
        }}
      />
      {state.status === "ready" ? (
        account && (
          <section className={styles.card} aria-label="Wybór rachunku">
            <label>
              Rachunek symulowany
              <select
                value={account.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {accounts.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )
      ) : (
        <LoadStatus state={state} retry={refresh} />
      )}
      {account && (
        <Account
          key={`${account.id}:${signalId ?? ""}`}
          id={account.id}
          signalId={signalId}
        />
      )}
    </>
  );
}

export function PaperPanel({ signalId }: { signalId?: string }) {
  const { state } = useSession();
  return (
    <div className={styles.panel}>
      <Link href="/dashboard/investments">Wróć do inwestycji</Link>
      <h1>Lokalny symulator zleceń</h1>
      <p>
        Rachunek testowy GPW i USA. Ceny wykonania i prowizje wpisujesz ręcznie.
      </p>
      {state.status === "authenticated" && (
        <Accounts key={state.user.id} signalId={signalId} />
      )}
    </div>
  );
}
