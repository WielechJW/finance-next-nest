# Kontrakt analityki portfela

Etap 4.1 (#22) dodaje podsumowanie przychodów, wydatków i wyniku okresu.
Etap 4.2 (#23) dodaje podział wydatków na kategorie i ich udział procentowy.
Etap 4.3 (#24) dodaje dzienne i miesięczne serie przychodów oraz wydatków.
Wspólne DTO `AnalyticsPeriodDto` i funkcja `resolveAnalyticsPeriod` ustalają
zakres dat dla raportów analitycznych.

## Podsumowanie okresu

```http
GET /analytics/summary?from=2024-02-01&to=2024-02-29
```

Endpoint wymaga aktywnej sesji `finance.sid`. Portfel wynika wyłącznie
z użytkownika z sesji. Przeglądarka wysyła cookie przez
`credentials: 'include'`, a odpowiedź zawiera `Cache-Control: no-store`.

| Parametr | Reguła                                                                         |
| -------- | ------------------------------------------------------------------------------ |
| `from`   | Pierwsza wliczana data kalendarzowa `YYYY-MM-DD`.                              |
| `to`     | Ostatnia wliczana data kalendarzowa `YYYY-MM-DD`, nie wcześniejsza niż `from`. |

Bez obu parametrów raport obejmuje cały bieżący miesiąc według
`Europe/Warsaw`, od pierwszego do ostatniego dnia, również z zapisanymi
przyszłymi operacjami w tym miesiącu. Bieżący miesiąc ustala serwer przy
każdym żądaniu, niezależnie od jego systemowej strefy czasowej.

Własny zakres wymaga obu parametrów. Daty muszą istnieć i należeć do zakresu
`0001-01-01`–`9999-12-31`. `from = to` wybiera jeden dzień. Filtrowanie
dotyczy `occurredOn`, a nie momentu utworzenia lub zmiany rekordu.
Dat kalendarzowych nie przesuwamy między strefami czasowymi.

Jedna granica, puste wartości, nieistniejące daty, daty z godziną,
odwrócony zakres, powtórzone parametry, tablice i nieznane parametry
dają `400`. Dotyczy to również `userId`, `walletId`, `type` i paginacji.

Przykładowa odpowiedź `200`:

```json
{
  "from": "2024-02-01",
  "to": "2024-02-29",
  "currency": "PLN",
  "income": "50.20",
  "expenses": "20.10",
  "periodResult": "30.10"
}
```

| Pole           | Znaczenie                                                                           |
| -------------- | ----------------------------------------------------------------------------------- |
| `from`, `to`   | Faktycznie zastosowane, wliczane granice raportu, także przy domyślnym miesiącu.    |
| `currency`     | Waluta portfela: `PLN`.                                                             |
| `income`       | Suma kwot operacji `INCOME` z okresu.                                               |
| `expenses`     | Suma kwot operacji `EXPENSE` z okresu, prezentowana jako wartość dodatnia lub zero. |
| `periodResult` | `income − expenses`; wynik może być ujemny.                                         |

Wszystkie kwoty są stringami dziesiętnymi z kropką i dokładnie dwoma
miejscami po przecinku. Pusty okres daje `"0.00"` we wszystkich trzech
polach, również gdy portfel ma operacje poza zakresem. Sumy mogą przekraczać
limit pojedynczej transakcji. Jedno parametryzowane zapytanie SQL liczy
przychody, wydatki i ich różnicę na tym samym stanie danych, używając
dokładnego typu PostgreSQL `numeric`. Serializacja Decimal nie przechodzi
przez JavaScript `number`.

## Wydatki według kategorii

```http
GET /analytics/categories?from=2024-02-01&to=2024-02-29
```

Endpoint korzysta z tych samych reguł dat co podsumowanie: obie granice są
wliczane, własny zakres wymaga obu parametrów, a brak parametrów wybiera
cały bieżący miesiąc według `Europe/Warsaw`. Obowiązują ta sama sesja,
izolacja portfela, walidacja i `Cache-Control: no-store`. `categoryId`,
`type`, parametry właściciela oraz paginacja nie są dozwolonymi filtrami.

Przykładowa odpowiedź `200`:

```json
{
  "from": "2024-02-01",
  "to": "2024-02-29",
  "currency": "PLN",
  "totalExpenses": "100.00",
  "items": [
    {
      "categoryId": "10000000-0000-4000-8000-000000000001",
      "categoryName": "Jedzenie",
      "amount": "75.00",
      "percentage": "75.00"
    },
    {
      "categoryId": "10000000-0000-4000-8000-000000000002",
      "categoryName": "Transport",
      "amount": "25.00",
      "percentage": "25.00"
    }
  ]
}
```

`items` zawiera wyłącznie kategorie z wydatkami (`EXPENSE`) w wybranym
okresie i portfelu. Każda pozycja ma identyfikator i nazwę kategorii,
sumę `amount` oraz `percentage` — udział w całkowitych wydatkach okresu.
Kategorie bez wydatków są pominięte. Grupowanie odbywa się po identyfikatorze;
różne kategorie o tej samej nazwie pozostają osobnymi pozycjami.
Wyniki są sortowane według kwoty malejąco, a przy remisie według UUID
kategorii rosnąco.

`totalExpenses` to dokładna suma `amount` ze wszystkich pozycji. Dla tego
samego okresu i stanu historii odpowiada polu `expenses` z
`/analytics/summary`. Przychody i saldo początkowe nie wchodzą do zestawienia.
Oba endpointy wykonują niezależne odczyty; zmiana historii między żądaniami
może zmienić ich wyniki.

Jedno parametryzowane zapytanie SQL grupuje wydatki i oblicza sumę oraz
procenty na tym samym stanie danych. Obliczenia korzystają z PostgreSQL
`numeric`, a kwoty i procenty są stringami z dwoma miejscami po przecinku,
bez konwersji na JavaScript `number`.

Udział to `amount / totalExpenses × 100`, zaokrąglony do dwóch miejsc
po przecinku, z połówkami w górę. Procenty są wartościami prezentacyjnymi:

- Trzy równe kategorie mogą mieć po `"33.33"`, łącznie `99.99%`.
- Kwoty `1.00` i `31.00` dają `"3.13"` oraz `"96.88"`, łącznie `100.01%`.
- Bardzo mała dodatnia kategoria może mieć `"0.00"` procent, zachowując
  swoją dokładną kwotę i miejsce w zestawieniu.

Nie korygujemy procentów, aby wymusić sumę `100.00%`. Suma kwot pozostaje
dokładna niezależnie od zaokrągleń udziałów.

Brak wydatków daje `200`, `totalExpenses: "0.00"` i `items: []`, również
przy samych przychodach lub operacjach spoza okresu. Nie występuje dzielenie
przez zero. Usunięty portfel daje `404` i nie jest odtwarzany przez odczyt.
Edycja kwoty, kategorii, typu i daty oraz usunięcie transakcji są uwzględniane
w następnym odczycie, bez zapisanego wcześniej raportu.

## Trendy przychodów i wydatków

```http
GET /analytics/trends?from=2026-11-01&to=2026-11-02&granularity=day
```

Endpoint korzysta ze wspólnych reguł `from` i `to`, sesji użytkownika,
izolacji portfela i `Cache-Control: no-store`. Bez dat obejmuje cały bieżący
miesiąc według `Europe/Warsaw`, również zapisane przyszłe operacje w tym
miesiącu. Własny zakres wymaga obu granic i wlicza obie daty.

| Parametr      | Reguła                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| `granularity` | `day` (domyślnie) albo `month`. Pusty, nieznany lub powtórzony parametr daje `400`. |
| `from`, `to`  | Wspólne istniejące daty kalendarzowe `YYYY-MM-DD`, z `from <= to`.                  |

Przykładowa odpowiedź `200`:

```json
{
  "from": "2026-11-01",
  "to": "2026-11-02",
  "currency": "PLN",
  "granularity": "day",
  "items": [
    {
      "period": "2026-11-01",
      "income": "50.20",
      "expenses": "20.10",
      "periodResult": "30.10"
    },
    {
      "period": "2026-11-02",
      "income": "0.00",
      "expenses": "0.00",
      "periodResult": "0.00"
    }
  ]
}
```

Każdy punkt zawiera `income`, `expenses` i `periodResult = income − expenses`
jako dokładne stringi z dwoma miejscami po przecinku. Wynik może być ujemny.
Saldo początkowe nie wchodzi do serii. `period` ma format `YYYY-MM-DD`
dla dni i `YYYY-MM` dla miesięcy. Punkty są uporządkowane chronologicznie,
bez duplikacji. Seria zawiera każdy dzień lub miesiąc zakresu, również
z trzema kwotami `"0.00"`, gdy w danym okresie nie ma transakcji.
Istniejący pusty portfel daje pełną serię zer; brak portfela daje `404`.

Dla `granularity=month&from=2026-11-15&to=2027-02-10` odpowiedź ma cztery
punkty: `2026-11`, `2026-12`, `2027-01` i `2027-02`. Pierwszy uwzględnia
wyłącznie 15–30 listopada, ostatni wyłącznie 1–10 lutego. Pusty styczeń
otrzymuje zera. Przesunięcie początku filtra na 31. dzień miesiąca nie
powoduje pominięcia kolejnego miesiąca.

Limity dotyczą liczby punktów, z wliczonymi granicami:

- `day`: najwyżej 366 dni. Pełny rok 2024 mieści się w limicie;
  zakres `2024-01-01`–`2025-01-01` ma 367 dni i daje `400`.
- `month`: najwyżej 120 miesięcy kalendarzowych. Zakres
  `2020-01-31`–`2029-12-01` ma 120 punktów; przedłużenie do `2030-01-01`
  daje 121 punktów i `400`.

Liczba punktów jest sprawdzana przed zapytaniem i generowaniem serii.
Te limity nie ograniczają endpointów podsumowania i kategorii.
Serie nie mają paginacji; dodatkowe parametry, w tym `type`, `categoryId`,
`userId`, `walletId` i `page`, dają `400`.

Jedno parametryzowane zapytanie SQL generuje ograniczoną serię dat,
grupuje operacje według `occurredOn` i uzupełnia luki. Obliczenia kwot
wykorzystują PostgreSQL `numeric`. Daty i miesiące są liczone kalendarzowo;
nie następuje konwersja dat operacji między strefami czasowymi ani
przesunięcie punktów podczas zmiany czasu.

Dla tego samego zakresu i stanu danych suma `income`, `expenses` oraz
`periodResult` ze wszystkich punktów odpowiada tym samym polom z
`/analytics/summary`, dla obu granularności. Niezależne żądania mogą
zobaczyć inne dane, jeśli między nimi nastąpi edycja lub usunięcie operacji.
Kolejny odczyt trendów uwzględnia aktualną historię.

## Wynik okresu a saldo

Saldo początkowe nie jest przychodem i nie wpływa na raport:

- Saldo początkowe `100.00`, przychód `50.20` i wydatek `20.10` w okresie
  dają wynik okresu `30.10` oraz globalne saldo portfela `130.10`.
- Zmiana salda początkowego zmienia globalne saldo, ale zachowuje raport.
- Operacja spoza okresu zmienia globalne saldo, ale nie to podsumowanie.
- Edycja kwoty, typu lub daty oraz usunięcie operacji są uwzględniane
  w następnym odczycie raportu.

Globalne saldo nadal zwraca `GET /wallet`. Endpoint podsumowania zwraca
przepływy wybranego okresu i nie dodaje do nich salda początkowego.

## Statusy i błędy

| Status | Znaczenie                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `200`  | Podsumowanie, kategorie lub trendy, także dla pustego okresu.                                                           |
| `400`  | Błędne lub dodatkowe parametry, niepełny albo odwrócony zakres dat, błędna granularność lub przekroczony limit trendów. |
| `401`  | Brak sesji, wygaśnięcie lub wylogowanie.                                                                                |
| `404`  | Użytkownik nie ma portfela; odczyt nie tworzy go ponownie.                                                              |
| `500`  | Błąd odczytu; odpowiedź i logi nie ujawniają zapytań ani treści danych.                                                 |

## Weryfikacja

Przygotowanie lokalnej bazy oraz oddzielnej `DATABASE_URL_TEST` opisuje
[README](../README.md#testy-integracyjne-z-postgresql).

```bash
npm --prefix backend test -- src/analytics/analytics-period.spec.ts
npm --prefix backend test -- src/analytics/analytics-trends.spec.ts
npm --prefix backend run test:integration -- test/analytics-summary.integration-spec.ts
npm --prefix backend run test:integration -- test/analytics-categories.integration-spec.ts
npm --prefix backend run test:integration -- test/analytics-trends.integration-spec.ts
```

Testy jednostkowe sprawdzają domyślny miesiąc, zimowy i letni czas Warszawy,
przełom roku, lata przestępne, pełny zakres kalendarza i reguły obu granic.
Testy HTTP z rzeczywistym PostgreSQL sprawdzają kwoty, granice okresu,
ujemny i pusty wynik, duże sumy, domyślny miesiąc, odrębność salda,
izolację kont, sesje, walidację, mutacje i bezpieczne błędy bazy.

Testy kategorii dodatkowo sprawdzają grupowanie i sortowanie, identyczne
nazwy różnych kategorii, zgodność sum z podsumowaniem, zaokrąglanie udziałów,
kategorie z zerowym procentem i przeliczenie po zmianie kwoty, kategorii,
daty i typu oraz usunięciu ostatniego wydatku.

Testy trendów sprawdzają kompletność i kolejność obu serii, częściowe
miesiące, zerowe luki, datę 29 lutego, przełom roku, zmianę czasu,
daty z lat 0001 i 9999, dokładne kwoty oraz zgodność sum z podsumowaniem.
Obejmują również limity i ich przekroczenie przed zapytaniem, domyślny
miesiąc, izolację kont, mutacje i niezależność od salda początkowego.

Ręcznie można sprawdzić przykład z sekcji „Wynik okresu a saldo”:
utwórz obie operacje w lutym 2024, zaloguj się i odczytaj endpoint z podanym
zakresem. Następnie zmień wydatek na `30.10` — wynik wyniesie `20.10`.
Po jego usunięciu wynik wyniesie `50.20`.

Dla kategorii dodaj w wybranym okresie wydatki Jedzenie `50.00` i `25.00`
oraz Transport `25.00`. Raport kategorii powinien zwrócić odpowiednio
`75.00` / `75.00%` i `25.00` / `25.00%`, a podsumowanie `expenses: "100.00"`.
Dodanie przychodu lub zmiana salda początkowego zachowuje to zestawienie.

Dla trendów dodaj przychód `50.20` z `2024-02-28` i wydatek `20.10`
z `2024-03-02`, a następnie wybierz zakres `2024-02-28`–`2024-03-02`.
Seria dzienna ma cztery punkty, w tym zera dla 29 lutego i 1 marca.
Seria miesięczna ma dwa punkty: luty z wynikiem `50.20` i marzec z wynikiem
`-20.10`. Podsumowanie dla tego zakresu ma wynik `30.10`.
