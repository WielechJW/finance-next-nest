# API inwestycji — ręczne portfele, rachunki i operacje (INV 3.1–3.2, #56–57)

Wszystkie poniższe endpointy wymagają sesji HttpOnly. Brak sesji daje `401`.
Zapisy korzystają z istniejącej ochrony CSRF. Odpowiedzi mają `Cache-Control: no-store`.
Portfele inwestycyjne są osobną domeną od osobistego portfela `/wallet`.

Prefiks `P` poniżej oznacza `/investments/portfolios`, a `A` oznacza
`P/:portfolioId/accounts`. Identyfikatory ścieżki muszą być UUID (`400` przy błędzie).

| Metoda i ścieżka | DTO żądania | Odpowiedź |
| --- | --- | --- |
| `POST P` | `{ "name": "Akcje" }` | `201`, portfel |
| `GET P` | — | `200`, tablica własnych portfeli, również pusta |
| `GET P/:portfolioId` | — | `200`, portfel |
| `PATCH P/:portfolioId` | `{ "name": "Nowa nazwa" }` | `200`, portfel |
| `POST A` | `{ "name": "Rachunek ręczny" }` | `201`, rachunek |
| `GET A` | — | `200`, tablica rachunków, również zarchiwizowanych |
| `GET A/:accountId` | — | `200`, rachunek |
| `PATCH A/:accountId` | `{ "name": "Nowa nazwa", "archived": true }` | `200`, rachunek |

Nazwy są tekstami, przycinamy otaczające spacje; długość po przycięciu 1–100 znaków.
PATCH rachunku wymaga przynajmniej jednego pola `name` lub `archived` (boolean).
Pominięte pole pozostaje bez zmian, `null`, błędne typy i dodatkowe pola dają `400`.
Nie przyjmujemy właściciela, identyfikatora portfela ani daty archiwizacji w DTO.
Lista ma stabilny porządek rosnący `(createdAt, id)`.

Portfel zawiera `id`, `name`, `createdAt`, `updatedAt`. Rachunek dodatkowo
`portfolioId` i `archivedAt` (ISO UTC lub `null`). Właściciel pochodzi z sesji;
pełna relacja właściciel → portfel → rachunek jest sprawdzana w każdym odczycie
i zapisie. Cudzy zasób, nieistniejący UUID lub rachunek pod błędnym portfelem
daje `404`, również jeśli obydwa portfele należą do tego samego użytkownika.

Archiwizacja nie usuwa rejestru, pozycji ani sald. Odczyt pozostaje dostępny.
Ponowne `archived: true` zachowuje pierwotną datę. `archived: false` przywraca
rachunek. Zarchiwizowany rachunek odrzuca nowe operacje i korekty (`409`),
ale ponowienie wcześniej zapisanego żądania z tym samym kluczem i treścią
zwraca ten sam identyfikator. Archiwizacja i księgowanie używają tej samej
blokady rachunku w PostgreSQL. Nie udostępniamy endpointu kasowania historii.

Przed uruchomieniem nowej wersji zastosuj migrację:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:generate
```

Testy HTTP na PostgreSQL: `investment-accounts-api.integration-spec.ts`.
Pokrywają sesję, CSRF, DTO, izolację dwóch kont, błędnego rodzica, archiwizację
z historią, blokadę nowych operacji, idempotencję i przywrócenie rachunku.

## Operacje i stan rachunku — INV 3.2 (#57)

Prefiks `R` oznacza `/investments/portfolios/:portfolioId/accounts/:accountId`.
Sesja, CSRF, `no-store`, ścisłe DTO i sprawdzenie całej ścieżki właściciela
obowiązują również poniższe endpointy.

| Metoda i ścieżka | Działanie |
| --- | --- |
| `POST R/events` | Zapis operacji; `201 { eventId, revision: 0 }`. |
| `GET R/events` | Historia; `200 { items, total, page, pageSize }`. |
| `GET R/events/:eventId` | Szczegóły dowolnej własnej wersji; `200`. |
| `POST R/events/:eventId/corrections` | Nowa wersja lub anulowanie; `201 { eventId, revision }`. |
| `GET R/summary` | Gotówka PLN/USD, pozycje i partie FIFO, wyniki sprzedaży, metadane instrumentów. |
| `GET /investments/instruments` | Katalog do wyboru instrumentu: `id, ticker, mic, currency, isin`; do 1000 pozycji. |

Katalog jest wspólną referencją, bez prywatnych danych użytkowników. Import
dostawcy należy do #60. Pusty katalog daje `[]`; API nie tworzy instrumentu
na podstawie dowolnego identyfikatora przesłanego przez użytkownika.

### DTO zapisu

Wspólne wymagane pola: `type`, `idempotencyKey` (1–128 znaków bez otaczających
spacji), `occurredOn` (`YYYY-MM-DD`, istniejąca data, nie później niż dziś w
Europe/Warsaw), `timePrecision` (`DATE`/`INSTANT`) i dodatni całkowity
`daySequence` do 2147483647. Opcjonalne: `executedAt`, `sourceTimeZone`,
`marketSessionOn`, `settledOn`, według reguł z investment-decisions.md.
`INSTANT` wymaga chwili z offsetem i zgodnej strefy IANA; `DATE` nie przyjmuje
`executedAt`. Kolejność w dniu musi odpowiadać czasom wykonania.

| Typ | Wymagane pola ekonomiczne | Opcjonalne |
| --- | --- | --- |
| `DEPOSIT`, `WITHDRAWAL`, `FEE` | `currency`, `amount` | — |
| `BUY`, `SELL` | `instrumentId`, `quantity`, `unitPrice` | `commission` |
| `DIVIDEND` | `currency`, `grossAmount` | `withholdingTax`, `fee` |
| `FX` | `soldCurrency`, `boughtCurrency`, `soldAmount`, `boughtAmount` | `commission` w walucie sprzedawanej |
| `OPENING_POSITION` | `instrumentId`, `quantity`, `totalCost`, `acquiredOn` | — |

Pola innego typu operacji są odrzucane. Własność i rachunek wynikają ze
ścieżki i sesji; `source` zawsze oznacza `MANUAL`. Nie można podszyć się pod
brokera lub import. Instrument musi istnieć; jego waluta określa walutę
transakcji. Rachunek ręczny obsługuje oba rynki i osobne stany PLN/USD.

Wszystkie kwoty, ceny i ilości są zwykłymi stringami dziesiętnymi z kropką,
bez wykładnika, przecinka, zbędnych zer wiodących lub konwersji przez Number.
Gotówka i opłaty mają najwyżej 2 miejsca, ilość/cena 10, koszt otwarcia 8.
Wartości główne są dodatnie; opłaty/podatek/koszt otwarcia mogą być zerowe.
Obowiązują zakresy z `precision.ts`; prowizja zakupu wchodzi do kosztu FIFO.

Przykład wpłaty:

```json
{"type":"DEPOSIT","currency":"PLN","amount":"1000.00","occurredOn":"2026-11-10","timePrecision":"DATE","daySequence":1,"idempotencyKey":"request-uuid"}
```

### Korekty i ponowienia

DTO korekty zawiera `expectedRevision`, `reason` (1–500 znaków po przycięciu),
`idempotencyKey` i `replacement`. `replacement: null` anuluje operację;
obiekt jest kompletnym nowym DTO zapisu i musi mieć ten sam `idempotencyKey`
co korekta. Stara wersja zostaje w audycie. Korekta odtwarza całą późniejszą
historię, więc nie może pozbawić gotówki lub akcji późniejszej operacji.

Ponowienie identycznego żądania zwraca ten sam status i potwierdzenie, także
po archiwizacji. Klucz użyty do innej treści, zajęta kolejność w dniu,
nieaktualna wersja, zarchiwizowany rachunek przy nowym zapisie albo
niewystarczający stan daje `409`, bez częściowego zapisu.
Niepoprawne DTO/kwoty/daty dają `400`; cudzy lub nieistniejący zasób `404`.
Wysyłając ponownie po błędzie sieci, klient zachowuje klucz i całą treść.

### Historia i odczyty

Filtry `type`, `instrumentId`, `from`, `to` można łączyć; daty są włączne.
`page=1`, `pageSize=20` domyślnie, maksymalnie 100 pozycji; odwrócony zakres
i offset przekraczający 2147483647 dają `400`. Pusta poprawna strona daje `200`.
Porządek malejący: data, kolejność dnia, czas zapisu, ID. Lista i licznik
pochodzą z jednego obrazu danych PostgreSQL.

`view=effective` (domyślnie) pokazuje bieżące wersje, również anulowania;
`view=audit` pokazuje wszystkie. Szczegóły zawierają `effective`, `revision`,
`correctionOfId` i `correctionReason`, wpisy gotówkowe/ilościowe, dane transakcji
lub partii otwarcia. Nie ujawniają klucza idempotencji ani hashy żądań.
Kwoty gotówki są formatowane do 2 miejsc, ilości/ceny do 10, koszty FIFO i
kurs FX do 8. Daty kalendarzowe pozostają datami, chwile są ISO UTC.

`summary` korzysta ze wszystkich bieżących zdarzeń rachunku, niezależnie
od filtrów historii, w jednym obrazie danych. Wpłaty nie stają się zyskiem.
Nie dodajemy wyceny rynkowej ani sumowania PLN i USD bez kursu.

Testy: `investment-events-api.integration-spec.ts` (HTTP/PostgreSQL), wspólny
scenariusz i mapa obliczeń: [investment-verification.md](investment-verification.md).
