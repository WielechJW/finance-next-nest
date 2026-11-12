# Kontrakt transakcji i kategorii

Etap 3.1 (#13) dodaje modele, migrację i seed kategorii. Etap 3.2 (#14)
udostępnia `GET /categories` i `POST /transactions` z walidacją żądań.
Formularze i wyliczanie salda z historii są kolejnymi zadaniami.

## Endpointy

Oba endpointy wymagają aktywnej sesji (`finance.sid`) i zwracają
`Cache-Control: no-store`. Przeglądarka wysyła cookie przez
`credentials: 'include'`. Globalna ochrona CSRF sprawdza zapisujące żądania
przed odczytem sesji; frontend musi mieć origin zgodny z `FRONTEND_ORIGIN`.
Bezpośredni klient bez nagłówków przeglądarki, np. curl, także może używać API.

| Endpoint | Wynik |
| --- | --- |
| `GET /categories` | `200` z tablicą wszystkich kategorii systemowych. |
| `GET /categories?type=EXPENSE` | `200` z kategoriami wydatków; `INCOME` wybiera przychody. |
| `POST /transactions` | `201` z utworzoną transakcją w portfelu użytkownika z sesji. |

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
| `200` | Kategorie zostały pobrane. |
| `201` | Transakcja została zapisana. |
| `400` | Błędne dane, dodatkowe pola, nieprawidłowa kategoria lub zmienione w trakcie zapisu powiązanie. |
| `401` | Brak sesji, sesja wygasła albo użytkownik został wylogowany. |
| `403` | Ochrona CSRF odrzuciła zapis z niezaufanego pochodzenia. |
| `404` | Użytkownik nie ma portfela. |
| `500` | Nie udało się odczytać kategorii albo zapisać transakcji. |

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
tworzą dla niego transakcji. Wyliczanie salda z całej historii należy do #15:
saldo początkowe + przychody − wydatki, również dla zapisanych przyszłych dat.

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
  wyznaczamy według `Europe/Warsaw`. Zakresy `from`/`to` w kolejnych zadaniach
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
```

Ostatnie żądanie zwraca `201` z identyfikatorem transakcji. Każde powtórzenie
poprawnego POST tworzy nową operację. Przychód dodasz przez `type: "INCOME"`
i kategorię przychodów, np. Wynagrodzenie
(`10000000-0000-4000-8000-000000000005`). Podanie `"0.00"` albo kategorii
przychodów dla `EXPENSE` powinno zwrócić `400` bez utworzenia transakcji.

## Weryfikacja

```bash
npm --prefix backend run typecheck
npm --prefix backend run test:integration -- test/transaction.integration-spec.ts test/transaction-migration.integration-spec.ts
npm --prefix backend run test:integration -- test/transaction-api.integration-spec.ts
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
