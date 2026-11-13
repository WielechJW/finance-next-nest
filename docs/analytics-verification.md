# Weryfikacja całej pierwszej wersji — etap 4.5 (#26)

Scenariusz łączy rejestrację i logowanie, prywatny portfel, transakcje
oraz analitykę. Weryfikuje jednocześnie podsumowanie, kategorie,
serie dzienne i miesięczne oraz globalne saldo, na tych samych danych.

## Dane wspólnego scenariusza

[Fixture testowe](../backend/test/support/analytics-scenario.ts) zawiera
wejściowe operacje i jawne oczekiwane kwoty. Wyniki nie są wyliczane
z odpowiedzi API. Pomocnicze funkcje składają etykiety kalendarzowe,
uzupełniają oczekiwane zerowe dni i kopiują zapisane wartości.

Konto A zaczyna od `100.00`, a konto B od `-50.00`. Każda operacja ma tytuł
`Weryfikacja ` i klucz z odpowiedniej tabeli, np. `Weryfikacja A-zmienna`.
W formularzu można wpisać kwoty z polskim przecinkiem.

| Klucz A      | Data       | Typ      | Kategoria      | Kwota |
| ------------ | ---------- | -------- | -------------- | ----- |
| A-grudzien   | 2023-12-31 | Przychód | Wynagrodzenie  | 10.00 |
| A-przychod   | 2024-01-01 | Przychód | Wynagrodzenie  | 50.20 |
| A-zmienna    | 2024-01-15 | Wydatek  | Jedzenie       | 20.10 |
| A-transport  | 2024-01-31 | Wydatek  | Transport      | 0.20  |
| A-luty       | 2024-02-01 | Przychód | Inne przychody | 0.30  |
| A-przestepny | 2024-02-29 | Wydatek  | Jedzenie       | 0.10  |
| A-marzec     | 2024-03-01 | Przychód | Inne przychody | 1.00  |

| Klucz B      | Data       | Typ      | Kategoria      | Kwota |
| ------------ | ---------- | -------- | -------------- | ----- |
| B-grudzien   | 2023-12-31 | Wydatek  | Mieszkanie     | 1.01  |
| B-przychod   | 2024-01-01 | Przychód | Wynagrodzenie  | 7.07  |
| B-jedzenie   | 2024-01-15 | Wydatek  | Jedzenie       | 3.03  |
| B-transport  | 2024-01-31 | Wydatek  | Transport      | 2.02  |
| B-luty       | 2024-02-01 | Przychód | Inne przychody | 0.40  |
| B-przestepny | 2024-02-29 | Wydatek  | Mieszkanie     | 0.04  |
| B-marzec     | 2024-03-01 | Przychód | Inne przychody | 5.05  |

Testy tworzą unikalne konta i zapisują operacje przez API. Scenariusz
Chromium sprawdza również rejestrację konta A formularzem, ustawienie
obu portfeli oraz późniejsze mutacje przez interfejs. Konto B działa
w oddzielnym kontekście przeglądarki. Fixtures usuwają własne konta,
ich transakcje i sesje także po niepowodzeniu testu.

## Oczekiwane raporty przed zmianami

Granice są wliczane. Dla każdego zakresu suma kategorii odpowiada wydatkom,
a sumy wszystkich trzech pól serii dziennej i miesięcznej odpowiadają
podsumowaniu. Testy sprawdzają również każdą pozycję i punkt osobno.

| Konto | Zakres                | Przychody | Wydatki | Wynik okresu |
| ----- | --------------------- | --------- | ------- | ------------ |
| A     | 2023-12-31–2024-03-01 | 61.50     | 20.40   | 41.10        |
| A     | 2024-01-01–2024-01-31 | 50.20     | 20.30   | 29.90        |
| A     | 2024-02-01–2024-02-29 | 0.30      | 0.10    | 0.20         |
| A     | 2024-02-29–2024-02-29 | 0.00      | 0.10    | -0.10        |
| A     | 2023-12-31–2024-01-01 | 60.20     | 0.00    | 60.20        |
| A     | 2024-04-01–2024-04-03 | 0.00      | 0.00    | 0.00         |
| B     | 2023-12-31–2024-03-01 | 12.52     | 6.10    | 6.42         |
| B     | 2024-01-01–2024-01-31 | 7.07      | 5.05    | 2.02         |
| B     | 2024-02-01–2024-02-29 | 0.40      | 0.04    | 0.36         |
| B     | 2024-02-29–2024-02-29 | 0.00      | 0.04    | -0.04        |
| B     | 2023-12-31–2024-01-01 | 7.07      | 1.01    | 6.06         |
| B     | 2024-04-01–2024-04-03 | 0.00      | 0.00    | 0.00         |

Globalne saldo A wynosi `141.10 = 100.00 + 61.50 − 20.40`, a B
`-43.58 = -50.00 + 12.52 − 6.10`, niezależnie od wybranego filtra.
Pełny zakres ma 62 punkty dzienne i cztery miesięczne; pusty kwietniowy
okres ma trzy zerowe dni i jeden zerowy miesiąc.

Kategorie pełnego zakresu A to Jedzenie `20.20` / `99.02%` oraz Transport
`0.20` / `0.98%`. Dla B: Jedzenie `3.03` / `49.67%`, Transport `2.02` /
`33.11%` i Mieszkanie `1.05` / `17.21%`. Procenty B sumują się do `99.99%`
ze względu na niezależne zaokrąglenia; kwoty sumują się dokładnie.

## Oczekiwania po kolejnych mutacjach A

Kroki wykonywane są kolejno. Pierwsze pięć dotyczy `A-zmienna`,
ostatni — `A-transport`. Saldo początkowe A pozostaje `100.00`.

| Stan / operacja                                     | Wynik pełnego zakresu | Wynik stycznia | Wynik lutego | Globalne saldo A |
| --------------------------------------------------- | --------------------- | -------------- | ------------ | ---------------- |
| Stan początkowy                                     | 41.10                 | 29.90          | 0.20         | 141.10           |
| Zmień kwotę wydatku na 30.10                        | 31.10                 | 19.90          | 0.20         | 131.10           |
| Zmień kategorię na Transport                        | 31.10                 | 19.90          | 0.20         | 131.10           |
| Przenieś operację na 2024-02-29                     | 31.10                 | 50.00          | -29.90       | 131.10           |
| Zmień typ na Przychód i kategorię na Inne przychody | 91.30                 | 50.00          | 30.30        | 191.30           |
| Usuń zmieniony przychód                             | 61.20                 | 50.00          | 0.20         | 161.20           |
| Usuń wydatek A-transport                            | 61.40                 | 50.20          | 0.20         | 161.40           |

API po każdym kroku sprawdza oba konta, wszystkie sześć zakresów, wszystkie
kategorie, oba podziały trendu i salda. Chromium sprawdza globalne saldo,
pełny zakres, styczeń i luty w podziale miesięcznym oraz 29 lutego w podziale
dziennym, z kartami i tabelami kategorii i trendu. Raport pełnego zakresu
i saldo B są sprawdzane po każdym kroku i pozostają niezmienione.

Osobne testy, zaczynające od stanu początkowego, potwierdzają:

- Zmiana salda początkowego A na `-200.00` daje saldo `-158.90` i zachowuje
  wszystkie raporty. Saldo B i jego raporty pozostają bez zmian.
- Zmiana przychodu grudniowego A z `10.00` na `11.00` daje saldo `142.10`
  i wynik pełnego zakresu `42.10`. Raporty stycznia i lutego są bez zmian.
- Cudze GET, PATCH i DELETE zwracają `404` dla każdej operacji w obu
  kierunkach. Próby wyboru `userId` i `walletId` w raportach dają `400`.
  Późniejszy komplet raportów i oba salda zachowują oczekiwane wartości.

## Mapa kryteriów ukończenia

| Kryterium #26                                             | Sprawdzenie                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zgodność sum raportów i odrębność salda początkowego      | [Integracja](../backend/test/analytics-consistency.integration-spec.ts): bazowe raporty i zmiana salda początkowego; pierwszy scenariusz Chromium. |
| Mutacje zmieniają właściwe raporty i całkowite saldo      | Pętla sześciu kroków w integracji oraz drugi scenariusz Chromium; kontrola drugiego konta po każdym kroku.                                         |
| Pusty okres, grosze, granice, przełom roku, izolacja kont | Sześć wspólnych zakresów, dwa konta i próby dostępu do cudzych rekordów.                                                                           |
| Spójność filtra, kart i danych przy wykresach             | [Chromium](../backend/test/browser/analytics-verification.pw.ts): zakres w adresie, karty, każda komórka obu tabel, oba podziały trendu.           |
| Lint, build, pełne testy i instrukcja czterech etapów     | Pełna regresja poniżej oraz wspólny przebieg ręczny.                                                                                               |

## Jeden przebieg ręczny przez cztery etapy

1. Wykonaj instalację, konfigurację PostgreSQL, migracje i seed według
   [README](../README.md#instalacja-po-sklonowaniu-repozytorium).
   Uruchom frontend i backend według sekcji
   [Uruchomienie podczas nauki](../README.md#uruchomienie-podczas-nauki).
2. Na `/register` utwórz konto A, a następnie zaloguj się na `/login`.
   W Portfelu ustaw saldo początkowe `100,00`.
3. W Transakcjach dodaj siedem pozycji A z tabeli. Portfel powinien
   pokazać `141,10 zł`. Nazwy kategorii zależą od wybranego typu operacji.
4. W Analityce wybierz **Własny zakres**, wpisz daty z tabeli raportów
   i kliknij **Zastosuj**. Porównaj trzy karty, rozwiń **Pokaż dane kategorii**
   i **Pokaż dane trendu**. Sprawdź podział dzienny oraz miesięczny.
5. Przejdź do Transakcji i wykonaj po kolei sześć mutacji z tabeli.
   Po każdej wróć do Portfela i Analityki, sprawdzając saldo oraz właściwe
   okresy. Kategorię trzeba zmienić razem z typem na zgodną przychodową.
6. W drugiej przeglądarce lub osobnej sesji prywatnej utwórz konto B,
   ustaw `-50,00` i dodaj siedem pozycji B. Jego globalne saldo ma wynieść
   `-43,58 zł`; raporty mają odpowiadać tabeli niezależnie od zmian A.
7. Wyloguj A. Wejście na panel ma kierować do logowania, a konto B
   w osobnej sesji powinno nadal działać.

## Automatyczna weryfikacja

Konfiguracja baz i przeglądarki jest opisana w
[README](../README.md#testy-integracyjne-z-postgresql). Integracja korzysta
z `DATABASE_URL_TEST`, Chromium z osobnej `DATABASE_URL_BROWSER_TEST`.
Oba mechanizmy odrzucają niebezpieczne adresy i nie resetują bazy deweloperskiej.

Nowe scenariusze:

```bash
npm --prefix backend run test:integration -- test/analytics-consistency.integration-spec.ts
npm --prefix backend run test:browser -- analytics-verification.pw.ts
```

Pełna regresja pierwszej wersji obejmuje wszystkie pliki testów, również
cały zestaw Chromium bez filtra:

```bash
npm --prefix frontend run lint
npm --prefix frontend test -- --maxWorkers=2
npm --prefix frontend run build
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run test:integration
npm --prefix backend run build
npm --prefix backend run test:browser:typecheck
npm --prefix backend run test:browser
```

`--maxWorkers=2` ogranicza liczbę równoległych procesów testów frontendu,
zachowując cały zestaw. Raport i ślady Chromium trafiają do ignorowanych
katalogów opisanych w README.
