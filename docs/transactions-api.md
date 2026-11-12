# Kontrakt transakcji i kategorii

Etap 3.1 (#13) dodaje modele, migrację i seed kategorii. Etap 3.2 (#14)
udostępnia `GET /categories` i `POST /transactions` z walidacją żądań.
Etap 3.3 (#15) wylicza saldo z historii w GET i PATCH portfela.
Etap 3.4 (#16) udostępnia listę i szczegóły własnych transakcji.
Formularze dodawania operacji są kolejnym zadaniem (#17).

## Endpointy

Wszystkie endpointy wymagają aktywnej sesji (`finance.sid`) i zwracają
`Cache-Control: no-store`. Przeglądarka wysyła cookie przez
`credentials: 'include'`. Globalna ochrona CSRF sprawdza zapisujące żądania
przed odczytem sesji; frontend musi mieć origin zgodny z `FRONTEND_ORIGIN`.
Bezpośredni klient bez nagłówków przeglądarki, np. curl, także może używać API.

| Endpoint | Wynik |
| --- | --- |
| `GET /categories` | `200` z tablicą wszystkich kategorii systemowych. |
| `GET /categories?type=EXPENSE` | `200` z kategoriami wydatków; `INCOME` wybiera przychody. |
| `POST /transactions` | `201` z utworzoną transakcją w portfelu użytkownika z sesji. |
| `GET /transactions` | `200` z własną historią, filtrami i paginacją. |
| `GET /transactions/:id` | `200` ze szczegółami własnej transakcji. |

Kategorie są sortowane rosnąco po stabilnym UUID. Każda pozycja zawiera
wyłącznie `id`, `name` i `type`. Brak pasujących kategorii daje pustą tablicę.
Filtr `type` jest opcjonalny; pusty, nieznany lub powtórzony typ oraz dodatkowe
parametry zapytania dają `400`.

`POST /transactions` przyjmuje pola opisane poniżej. Portfel jest odczytywany
po `userId` z sesji; parametry URL nie zmieniają właściciela. Nieistniejąca
kategoria albo kategoria innego typu daje `400`. Brak portfela daje `404`
i nie tworzy nowego portfela. Błędy bazy dają ogólny komunikat `500`,
bez treści transakcji i szczegółów zapytań w odpowiedzi lub logach.

| Status | Znaczenie |
| --- | --- |
| `200` | Kategorie, historia albo szczegóły transakcji zostały pobrane. |
| `201` | Transakcja została zapisana. |
| `400` | Błędne dane, filtry, zakres dat, paginacja lub UUID; dodatkowe pola; nieprawidłowa kategoria zapisu lub zmienione powiązanie. |
| `401` | Brak sesji, sesja wygasła albo użytkownik został wylogowany. |
| `403` | Ochrona CSRF odrzuciła zapis z niezaufanego pochodzenia. |
| `404` | Przy zapisie użytkownik nie ma portfela; przy odczycie szczegółów transakcja nie istnieje albo należy do innego konta. |
| `500` | Nie udało się odczytać kategorii lub transakcji albo zapisać transakcji. |

## Historia i szczegóły transakcji

`GET /transactions` zwraca obiekt z polami `items`, `page`, `pageSize` i `total`.
Każda pozycja `items` ma ten sam format co odpowiedź POST opisana poniżej:
kwota jest stringiem z dwoma miejscami po przecinku, a `occurredOn` datą
`YYYY-MM-DD`. Wyniki są sortowane po `occurredOn DESC`, następnie po `id DESC`.
Identyfikator zapewnia stałą kolejność operacji zapisanych na ten sam dzień.

| Parametr | Reguła |
| --- | --- |
| `type` | Opcjonalnie `INCOME` albo `EXPENSE`. |
| `categoryId` | Opcjonalny UUID kategorii. Poprawny UUID bez pasujących operacji daje pustą listę, także dla nieistniejącej kategorii. |
| `from` | Opcjonalna istniejąca data `YYYY-MM-DD`; operacje z tego dnia są wliczane. |
| `to` | Opcjonalna istniejąca data `YYYY-MM-DD`; operacje z tego dnia są wliczane. Przy obu datach `from` musi być wcześniejsze lub równe `to`. |
| `page` | Domyślnie `1`; dodatnia liczba całkowita, najwyżej `2147483647`. |
| `pageSize` | Domyślnie `20`; dodatnia liczba całkowita od `1` do `100`. |

Filtry można łączyć; pominięta granica dat pozostawia zakres otwarty z tej
strony. Przyszłe daty są obsługiwane tak samo jak przy zapisie operacji.
Paginacja akceptuje cyfry bez znaku, białych znaków, części dziesiętnej,
zapisu wykładniczego ani zer wiodących. Offset `(page - 1) * pageSize`
może wynosić najwyżej `2147483647`; większy daje `400`.

Puste wartości, powtórzone parametry, tablice, nieprawidłowe daty, odwrócony
zakres i nieznane parametry są odrzucane kodem `400`. Obejmuje to próbę
przekazania `userId` lub `walletId`. Właściciel historii wynika z sesji.

`total` jest liczbą wszystkich własnych rekordów pasujących do filtrów,
przed podziałem na strony. W ramach jednego żądania lista i licznik korzystają
z tych samych warunków oraz transakcji z izolacją `RepeatableRead`, aby
zachować spójność przy równoległych zapisach.

Pusta historia lub brak wyników daje `200`, np.:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0
}
```

Strona poza końcem zbioru także zwraca `200` z pustym `items` i właściwym
`total`. Usunięty portfel daje pustą kolekcję i nie jest odtwarzany przez GET.
Filtry i paginacja historii nie zmieniają globalnego salda portfela.

`GET /transactions/:id` przyjmuje UUID i zwraca pojedynczy obiekt w tym samym
formacie co POST. Właściciel jest sprawdzany w zapytaniu do bazy. Cudza
i nieistniejąca transakcja zwracają identyczne `404` z komunikatem
`Nie znaleziono transakcji.`. Nieprawidłowy format UUID daje `400`,
a brak lub wygaśnięcie sesji daje `401` dla obu endpointów.

## Transakcja

| Pole | Reguła |
| --- | --- |
| `id` | UUID generowany po stronie serwera, niemodyfikowalny przez klienta. |
| `walletId` | UUID portfela ustalany wyłącznie z sesji użytkownika. |
| `type` | `INCOME` (przychód) albo `EXPENSE` (wydatek). |
| `amount` | Dodatnia kwota w PLN jako string dziesiętny z kropką i dokładnie dwoma miejscami po przecinku. |
| `categoryId` | UUID istniejącej kategorii zgodnej z `type`. |
| `title` | Tekst od 1 do 100 znaków po przycięciu białych znaków na końcach. |
| `note` | Opcjonalny tekst do 1000 znaków, bez przycinania; pominięte pole jest zapisywane jako `null`. Pusty string jest dozwolony, jawne `null` w żądaniu jest odrzucane. |
| `occurredOn` | Rzeczywista data kalendarzowa `YYYY-MM-DD`, bez godziny i strefy czasowej. |
| `createdAt`, `updatedAt` | Znaczniki czasu generowane przez serwer i serializowane jako ISO 8601 w UTC. |

Przykładowe dane do `POST /transactions`:

```json
{
  "type": "EXPENSE",
  "amount": "12.34",
  "categoryId": "10000000-0000-4000-8000-000000000001",
  "title": "Zakupy spożywcze",
  "occurredOn": "2026-11-09",
  "note": "Obiad"
}
```

Klient nie wybiera `walletId` ani właściciela i nie ustawia identyfikatora
czy znaczników czasu. Dodatkowe pola żądania mają być odrzucane.

Odpowiedź `201` zawiera jawnie wybrane pola transakcji:

```json
{
  "id": "20000000-0000-4000-8000-000000000001",
  "walletId": "30000000-0000-4000-8000-000000000001",
  "type": "EXPENSE",
  "amount": "12.34",
  "categoryId": "10000000-0000-4000-8000-000000000001",
  "title": "Zakupy spożywcze",
  "note": "Obiad",
  "occurredOn": "2026-11-09",
  "createdAt": "2026-11-12T12:00:00.000Z",
  "updatedAt": "2026-11-12T12:00:00.000Z"
}
```

Identyfikatory i znaczniki czasu w tym przykładzie są ilustracyjne.

## Kwoty

- Zakres transakcji: od `"0.01"` do `"999999999999.99"` włącznie.
- Przykłady poprawne: `"0.10"`, `"123.45"`. Kwota jest zawsze dodatnia;
  kierunek określa `type`. Zero i kwoty ujemne są niedozwolone.
- API odrzuca liczby JSON, przecinek, znak `+`, separatory tysięcy, nadmiarowe
  zera na początku, zapis wykładniczy, `NaN`, nieskończoność, białe znaki
  i liczbę miejsc dziesiętnych inną niż dwa. Przykłady błędne: `12.34`,
  `"12,34"`, `"01.00"`, `"1e2"`, `"0.001"`.
- W bazie używamy `Decimal(14,2)`, a w obliczeniach `Prisma.Decimal`
  tworzonego ze stringów. Nie konwertujemy kwot przez `Number` ani `parseFloat`.
- Ograniczenie SQL `Transaction_amount_check` wymusza dodatnią, skończoną
  wartość. Sam `Decimal(14,2)` może zaokrąglić nadmiarowe miejsca dziesiętne;
  API waliduje format przed utworzeniem `Prisma.Decimal` i zapisem w bazie.

Saldo początkowe pozostaje w `Wallet.openingBalance`; migracja i seed nie
tworzą dla niego transakcji.

## Saldo portfela

`GET /wallet` oraz odpowiedź `PATCH /wallet` zawierają osobno `openingBalance`
i wyliczone `balance`. Oba pola są stringami z kropką i dwoma miejscami
po przecinku. Wzór to:

```text
balance = openingBalance + suma INCOME − suma EXPENSE
```

Sumowanie obejmuje całą zapisaną historię portfela użytkownika z sesji,
również operacje z przyszłą datą. Parametry listy, filtry kategorii i typu,
zakres dat oraz paginacja nie ograniczają salda. Brak operacji oznacza saldo
równe początkowemu, a ujemny wynik jest dozwolony. Panel wyjaśnia tę zasadę
przy bieżącym saldzie.

Przykładowo `openingBalance: "100.00"`, przychód `"50.20"` i wydatek
`"20.10"` dają `balance: "130.10"`. Po zmianie salda początkowego na
`"200.00"` odpowiedź PATCH zawiera `balance: "230.10"`.

Agregacja i obliczenie wyniku odbywają się na `numeric` w jednym zapytaniu
PostgreSQL, z jednego obrazu danych. Wynik jest odczytywany przez Prisma jako
`Decimal` i serializowany przez `toFixed(2)`, bez arytmetyki zmiennoprzecinkowej.
Saldo bieżące może przekroczyć zakres `Decimal(14,2)` pojedynczej operacji
i salda początkowego. Przykład: saldo początkowe `"999999999999.99"` i dwa
takie przychody dają dokładnie `"2999999999999.97"`. Frontend akceptuje taką
sumę i prezentuje ją przez `BigInt`, zachowując osobne limity pól wejściowych.

PATCH zapisuje ustawienia i odczytuje saldo wewnątrz jednej transakcji bazy.
Błąd obliczania salda wycofuje zapis ustawień. Kolejny odczyt korzysta zawsze
z bieżącej historii, więc zmiana lub usunięcie zapisanej operacji wpływa
na wynik. Endpointy edycji i usuwania transakcji należą do #19.

## Daty

- Format to dokładnie `YYYY-MM-DD`, lata od `0001` do `9999`.
- Data musi istnieć: `2024-02-29` jest poprawna, `2026-02-29` i `2026-04-31`
  są błędne. Format ISO ze znacznikiem czasu, np. `2026-11-09T12:00:00Z`,
  nie jest datą operacji w tym kontrakcie.
- PostgreSQL przechowuje `occurredOn` jako `DATE`; ograniczenie SQL odrzuca
  daty poza zakresem kontraktu oraz specjalne wartości nieskończone.
- Prisma reprezentuje to pole jako `Date`. Po zwalidowaniu wejścia API
  używa północy UTC (`YYYY-MM-DDT00:00:00.000Z`) i serializuje
  wyłącznie część daty. Nie wyznaczamy daty operacji przez lokalną godzinę
  ani konwersję między strefami.
- Przyszłe daty są dozwolone. Domyślne „dzisiaj” oraz bieżący miesiąc
  wyznaczamy według `Europe/Warsaw`. Zakresy `from`/`to` historii
  obejmują obie daty graniczne.

## Kategorie systemowe

Kategorie są wspólne dla wszystkich portfeli. Identyfikatory są stałymi UUID,
nie zależą od nazwy i nie są generowane ponownie przy seedowaniu.

| UUID | Typ | Nazwa |
| --- | --- | --- |
| `10000000-0000-4000-8000-000000000001` | `EXPENSE` | Jedzenie |
| `10000000-0000-4000-8000-000000000002` | `EXPENSE` | Transport |
| `10000000-0000-4000-8000-000000000003` | `EXPENSE` | Mieszkanie |
| `10000000-0000-4000-8000-000000000004` | `EXPENSE` | Inne wydatki |
| `10000000-0000-4000-8000-000000000005` | `INCOME` | Wynagrodzenie |
| `10000000-0000-4000-8000-000000000006` | `INCOME` | Inne przychody |

Złożony klucz obcy `(categoryId, type)` wskazuje `(Category.id, Category.type)`.
Dzięki temu baza odrzuca również częściową aktualizację, która pozostawiłaby
niezgodny typ i kategorię. Kategorii użytej przez transakcję nie można usunąć
ani zmienić jej typu. Usunięcie portfela lub konta kaskadowo usuwa transakcje,
a kategorie systemowe pozostają.

Indeks `(walletId, occurredOn, id)` obsługuje historię i filtrowanie dat
własnego portfela oraz stabilne sortowanie po dacie i identyfikatorze.
Indeks `(categoryId, type)` wspiera relację do kategorii.

## Migracja i seed

Przy działającym PostgreSQL, z głównego katalogu projektu:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:seed
```

Migracja `20261109120000_add_transactions_and_categories` tworzy tabele
i ograniczenia w jednej transakcji SQL. Zachowuje istniejących użytkowników,
portfele, salda początkowe i sesje. Nie dodaje kategorii ani przykładowych
transakcji.

`prisma:seed` uruchamia `prisma db seed`. Skonfigurowana komenda seeda buduje
backend i generuje klienta Prisma, a następnie wykonuje skrypt korzystający
ze skompilowanej funkcji `seedSystemCategories` i tego samego połączenia
co backend (`DATABASE_URL`). Działa również bez wcześniejszego ręcznego buildu.
Wszystkie kategorie są zapisywane w jednej transakcji przez `upsert` po UUID:
ponowne uruchomienie zachowuje identyfikatory, przywraca nazwy systemowe
i nie duplikuje rekordów ani nie usuwa transakcji.

W [Prisma 7 seed uruchamia się jawnie](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding),
więc po migracjach należy wykonać powyższe polecenie `prisma:seed`.

## Ręczne sprawdzenie API

Przy uruchomionym backendzie i istniejącym koncie z przykładu rejestracji
w README zaloguj się, pobierz kategorie i dodaj wydatek:

```bash
curl -i -c /tmp/finance-transaction-cookies.txt http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@example.com","password":"Moje testowe haslo 123!"}'

curl -i -b /tmp/finance-transaction-cookies.txt \
  'http://localhost:3001/categories?type=EXPENSE'

curl -i -b /tmp/finance-transaction-cookies.txt http://localhost:3001/transactions \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  -d '{"type":"EXPENSE","amount":"12.34","categoryId":"10000000-0000-4000-8000-000000000001","title":"Zakupy spożywcze","occurredOn":"2026-11-12","note":"Obiad"}'

curl -i -b /tmp/finance-transaction-cookies.txt http://localhost:3001/wallet

curl -i -b /tmp/finance-transaction-cookies.txt \
  'http://localhost:3001/transactions?type=EXPENSE&from=2026-11-01&to=2026-11-30&page=1&pageSize=20'
```

Żądanie POST zwraca `201` z identyfikatorem transakcji. Następujący po nim
GET portfela pokazuje nowe saldo; dla pustego portfela z saldem początkowym
`"0.00"` będzie to `"-12.34"`. Każde powtórzenie
poprawnego POST tworzy nową operację. Przychód dodasz przez `type: "INCOME"`
i kategorię przychodów, np. Wynagrodzenie
(`10000000-0000-4000-8000-000000000005`). Podanie `"0.00"` albo kategorii
przychodów dla `EXPENSE` powinno zwrócić `400` bez utworzenia transakcji.

Ostatni GET zwraca historię wydatków z listopada wraz z `total`. Aby pobrać
szczegóły, skopiuj `id` z odpowiedzi POST lub z `items` i wyślij z tym samym
cookie `GET /transactions/:id`, zastępując `:id` skopiowaną wartością.

## Weryfikacja

```bash
npm --prefix backend run typecheck
npm --prefix backend run test:integration -- test/transaction.integration-spec.ts test/transaction-migration.integration-spec.ts
npm --prefix backend run test:integration -- test/transaction-api.integration-spec.ts
npm --prefix backend run test:integration -- test/transaction-read.integration-spec.ts
npm --prefix backend run test:integration -- test/wallet-api.integration-spec.ts
npm --prefix frontend test
npm --prefix backend run test:browser -- wallet.pw.ts auth-session.pw.ts
```

Testy korzystają wyłącznie z osobnej bazy `DATABASE_URL_TEST`. Sprawdzają
obie strony relacji, zgodność typów także po edycji, granice kwot i dat,
zapis groszy, powtarzalność seeda z istniejącą transakcją, usuwanie kaskadowe
oraz migrację pustej bazy i bazy ze starszym kontem, portfelem i sesją.

Testy API obejmują oba typy operacji, filtry kategorii, brakujące i dodatkowe
pola, granice długości tekstu, niedozwolone kwoty i daty, dokładny zapis groszy,
lata graniczne i dni zmiany czasu. Sprawdzają również izolację dwóch kont,
wygasłe i wylogowane sesje, ochronę CSRF, brak portfela oraz bezpieczną obsługę
błędów bazy i zmiany powiązań między odczytem a zapisem.

Testy salda obejmują dokładne grosze, puste i jednostronne historie, przyszłe
daty, ujemne wyniki, duże sumy, izolację kont i niezależność od filtrów.
Sprawdzają spójność odpowiedzi PATCH przy równoległych aktualizacjach,
odczyt zatwierdzonych zmian oraz wycofanie ustawień po błędzie agregacji.
Chromium sprawdza też zmianę salda początkowego przy istniejącej historii
i prezentację sumy przekraczającej limit wejściowy na małym ekranie.

Testy odczytu sprawdzają filtry łączone z paginacją, obie granice dat,
jednodniowe zakresy, stabilne sortowanie po identyfikatorze, komplet stron
bez duplikacji oraz zgodność `total`. Obejmują też puste wyniki, duże numery
stron, błędne parametry, zgodność formatu POST/GET, izolację dwóch kont,
wygasłe i wylogowane sesje, odpowiedzi `404` oraz bezpieczne błędy bazy.
