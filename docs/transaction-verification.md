# Weryfikacja transakcji i salda — etap 3.9 (#21)

Etap zamyka prowadzenie portfela: saldo początkowe, dodawanie, filtrowanie,
edycję i usuwanie operacji. Poniższa mapa łączy kryteria ukończenia z testami
kontraktu API oraz ciągłym scenariuszem w rzeczywistej przeglądarce.

## Pokrycie kryteriów

| Kryterium                                                                       | Testy                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `100.00 + 50.20 − 20.10 = 130.10`                                               | [Integracja mutacji](../backend/test/transaction-mutations.integration-spec.ts): `updates and deletes an expense while keeping the wallet and history exact`; [pełny scenariusz UI](../backend/test/browser/transaction-lifecycle.pw.ts).                                                                     |
| Zmiana wydatku na `30.10` daje `120.10`, a usunięcie `150.20`                   | Te same dwa scenariusze sprawdzają kolejne stany tego samego portfela, odrębność salda początkowego i trwałość zmian.                                                                                                                                                                                         |
| Odczyt, edycja i usuwanie cudzych rekordów nie zmieniają historii ani agregatów | [Integracja mutacji](../backend/test/transaction-mutations.integration-spec.ts): `preserves both complete ledgers and aggregates after foreign reads, edits and deletions`; [odczyt historii](../backend/test/transaction-read.integration-spec.ts) sprawdza też odpowiedzi identyczne z brakującym rekordem. |
| Granice dat, komplet stron i brak duplikacji                                    | [Odczyt historii](../backend/test/transaction-read.integration-spec.ts) oraz [integracja mutacji](../backend/test/transaction-mutations.integration-spec.ts): `keeps a mixed ledger exact across paged filters, type/date/category changes and both deletion directions`.                                     |
| Lint, build, testy i instrukcja pełnego przebiegu                               | Komendy poniżej i scenariusz ręczny; [README](../README.md) opisuje konfigurację lokalnej bazy i testów.                                                                                                                                                                                                      |

Istniejące testy [portfela](../backend/test/wallet-api.integration-spec.ts)
sprawdzają też `0.10 + 0.20 = 0.30`, puste i jednostronne historie, ujemne
saldo, przyszłe daty i sumy większe niż limit pojedynczej kwoty.
[Testy UI mutacji](../backend/test/browser/transaction-mutations.pw.ts)
obejmują błędy, anulowanie, klawiaturę, wygaśnięcie sesji, usunięcie
ostatniej pozycji strony i ekran 375 px.

## Dane i niezmienniki testów integracyjnych

Zestaw mieszany zawiera 28 operacji zapisanych przez API:

- 11 par przychód/wydatek po `0.10` z tą samą datą `2024-02-15`.
  Pary znoszą się w saldzie, a wspólna data przechodzi przez granicę
  domyślnej strony 20 rekordów i sprawdza kolejność według ID.
- Wydatek `0.01` z `2024-01-31`, wydatek `0.10` z `2024-02-01`,
  wydatek `0.20` z `2024-02-29` i przychód `0.30` z `2024-03-01`.
  Sprawdzają obie wliczane granice lutego oraz operacje tuż poza okresem.
- Wydatek `0.10` z `0001-01-01` i przychód `0.20` z `9999-12-31`.
  Pozostają w globalnym saldzie mimo wykluczenia ich filtrem dat.

Oczekiwane rekordy pochodzą z danych wejściowych testu. Test zbiera wszystkie
strony, sprawdza ich zawartość, `total`, brak powtórzeń i pierwszą stronę
poza zbiorem. Oczekiwane salda są zapisane jako dokładne stringi kwot;
test nie wylicza ich z odpowiedzi agregacji ani przy użyciu `number`.

| Zmiana historii przy saldzie początkowym `100.00`                                     | Saldo    |
| ------------------------------------------------------------------------------------- | -------- |
| Początkowe 28 operacji                                                                | `100.09` |
| Wydatek `0.10` z pierwszego dnia staje się przychodem `0.20` z dnia przestępnego      | `100.39` |
| Wydatek `0.20` zmienia kwotę na `0.10`, kategorię na Transport i datę na `2024-03-01` | `100.49` |
| Usunięcie zmienionego przychodu `0.20`                                                | `100.29` |
| Usunięcie zmienionego wydatku `0.10`                                                  | `100.39` |

Po każdej zmianie test porównuje pełną historię, filtrowaną historię oraz
globalne saldo. Osobny scenariusz tworzy taki zestaw na dwóch kontach
z saldami początkowymi `100.00` i `-100.00`. Każda próba cudzego GET,
PATCH i DELETE w obu kierunkach musi dać `404`; komplet stron obu kont,
szczegóły atakowanej operacji i salda `100.09` / `-99.91` pozostają bez zmian.

## Pełny przebieg w panelu

[Scenariusz Chromium](../backend/test/browser/transaction-lifecycle.pw.ts)
wykonuje wszystkie zmiany portfela przez interfejs Next.js, z prawdziwym
API i PostgreSQL. Rejestracja kont i sprzątanie należą do fixtures testowych.
Ten sam przebieg można sprawdzić ręcznie:

1. Zaloguj się na konto A i ustaw saldo początkowe `100,00`.
2. W Transakcjach dodaj przychód `50,20`, kategorię Wynagrodzenie
   i datę `2024-02-01`. Saldo wynosi `150,20 zł`.
3. Dodaj wydatek `20,10`, kategorię Jedzenie i datę `2024-02-29`.
   Saldo wynosi `130,10 zł`, a historia ma dwie operacje.
4. Zastosuj filtr Wydatki od `2024-02-01` do `2024-02-29`.
   Widać wydatek z ostatniego dnia; saldo nadal wynosi `130,10 zł`.
5. Edytuj jego kwotę na `30,10`. Sprawdź wpis `−30,10 zł`, zachowane
   filtry i saldo `120,10 zł`.
6. Przejdź do Portfela i odśwież stronę. Saldo początkowe nadal wynosi
   `100,00`, a bieżące `120,10 zł`.
7. Wróć do Transakcji, odfiltruj wydatek i usuń go po potwierdzeniu tytułu
   oraz kwoty. Saldo wynosi `150,20 zł`; filtr wydatków nie ma wyników.
8. Wyczyść filtry. Pozostaje tylko przychód `50,20`. Odśwież stronę
   i sprawdź również Portfel: saldo `150,20 zł`, początkowe `100,00`.
9. Wyloguj A i zaloguj nowe konto B. Jego saldo wynosi `0,00 zł`,
   a historia jest pusta. Po ponownym zalogowaniu A nadal ma swój przychód
   i saldo `150,20 zł`.

## Uruchomienie

Konfiguracja jest opisana w [README](../README.md): integracja używa lokalnej
`DATABASE_URL_TEST`, a Chromium osobnej `DATABASE_URL_BROWSER_TEST`.
Testy zakładają unikalne konta i sprzątają własne rekordy oraz sesje.
Zestawy mają niezależne bazy; nie wymagają resetowania danych deweloperskich.

Szybkie sprawdzenie scenariuszy dodanych w #21:

```bash
npm --prefix backend run test:integration -- test/transaction-mutations.integration-spec.ts
npm --prefix backend run test:browser -- transaction-lifecycle.pw.ts
```

Pełna regresja etapu:

```bash
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run test:browser:typecheck
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run test:integration
npm --prefix backend run build
npm --prefix frontend run lint
npm --prefix frontend test -- --maxWorkers=2
npm --prefix frontend run build
npm --prefix backend run test:browser
```
