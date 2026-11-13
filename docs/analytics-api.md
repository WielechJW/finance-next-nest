# Kontrakt analityki portfela

Etap 4.1 (#22) dodaje podsumowanie przychodów, wydatków i wyniku okresu.
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

| Status | Znaczenie                                                               |
| ------ | ----------------------------------------------------------------------- |
| `200`  | Podsumowanie, także dla pustego okresu.                                 |
| `400`  | Błędne lub dodatkowe parametry, niepełny albo odwrócony zakres dat.     |
| `401`  | Brak sesji, wygaśnięcie lub wylogowanie.                                |
| `404`  | Użytkownik nie ma portfela; odczyt nie tworzy go ponownie.              |
| `500`  | Błąd odczytu; odpowiedź i logi nie ujawniają zapytań ani treści danych. |

## Weryfikacja

Przygotowanie lokalnej bazy oraz oddzielnej `DATABASE_URL_TEST` opisuje
[README](../README.md#testy-integracyjne-z-postgresql).

```bash
npm --prefix backend test -- src/analytics/analytics-period.spec.ts
npm --prefix backend run test:integration -- test/analytics-summary.integration-spec.ts
```

Testy jednostkowe sprawdzają domyślny miesiąc, zimowy i letni czas Warszawy,
przełom roku, lata przestępne, pełny zakres kalendarza i reguły obu granic.
Testy HTTP z rzeczywistym PostgreSQL sprawdzają kwoty, granice okresu,
ujemny i pusty wynik, duże sumy, domyślny miesiąc, odrębność salda,
izolację kont, sesje, walidację, mutacje i bezpieczne błędy bazy.

Ręcznie można sprawdzić przykład z sekcji „Wynik okresu a saldo”:
utwórz obie operacje w lutym 2024, zaloguj się i odczytaj endpoint z podanym
zakresem. Następnie zmień wydatek na `30.10` — wynik wyniesie `20.10`.
Po jego usunięciu wynik wyniesie `50.20`.
