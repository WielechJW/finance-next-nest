"use client";

import { useCallback, useState, type FormEvent } from "react";
import {
  researchApi,
  type InvestmentNote as SavedNote,
  type NoteInput,
} from "@/lib/investment-research-api";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

const fields: Record<keyof NoteInput, string> = {
  thesis: "Teza inwestycyjna",
  risks: "Ryzyka",
  reviewConditions: "Warunki ponownej analizy",
};
const fieldNames = Object.keys(fields) as (keyof NoteInput)[];

function NoteForm({
  instrumentId,
  initialNote,
}: {
  instrumentId: string;
  initialNote: SavedNote | null;
}) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);

  async function change(save?: NoteInput) {
    setBusy(true);
    setMessage(null);
    try {
      if (save) setNote(await researchApi.saveNote(instrumentId, save));
      else {
        await researchApi.deleteNote(instrumentId);
        setNote(null);
      }
      setMessage({
        error: false,
        text: save ? "Zapisano notatkę." : "Usunięto notatkę.",
      });
    } catch (error) {
      setMessage({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "Nie udało się zmienić notatki.",
      });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void change({
      thesis: String(data.get("thesis") ?? ""),
      risks: String(data.get("risks") ?? ""),
      reviewConditions: String(data.get("reviewConditions") ?? ""),
    });
  }

  return (
    <form
      aria-label="Prywatna notatka"
      key={note?.updatedAt ?? "new"}
      onSubmit={submit}
    >
      <fieldset disabled={busy} className={styles.fields}>
        {fieldNames.map((field) => (
          <label className={styles.full} key={field}>
            {fields[field]}
            <textarea
              name={field}
              rows={3}
              maxLength={4000}
              defaultValue={note?.[field] ?? ""}
            />
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          Zapisz notatkę
        </button>
        {note && (
          <button type="button" disabled={busy} onClick={() => void change()}>
            Usuń notatkę
          </button>
        )}
      </div>
      {message && (
        <p role={message.error ? "alert" : "status"}>{message.text}</p>
      )}
    </form>
  );
}

export function InvestmentNote({ instrumentId }: { instrumentId: string }) {
  const load = useCallback(
    (signal: AbortSignal) => researchApi.note(instrumentId, signal),
    [instrumentId],
  );
  const { state, refresh } = useInvestmentResource(load);
  return (
    <section className={styles.card} aria-labelledby="investment-note-title">
      <h2 id="investment-note-title">Prywatna notatka</h2>
      {state.status === "loading" && <p role="status">Wczytywanie notatki…</p>}
      {state.status === "error" && (
        <p role="alert">
          {state.message}{" "}
          <button type="button" onClick={refresh}>
            Ponów odczyt notatki
          </button>
        </p>
      )}
      {state.status === "ready" && (
        <NoteForm instrumentId={instrumentId} initialNote={state.value} />
      )}
    </section>
  );
}
