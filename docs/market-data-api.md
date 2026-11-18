# Dane rynkowe — wersja B

Backend przechowuje wspólny katalog GPW/USA i mapowania EODHD. Prywatne
portfele odwołują się do trwałego ID instrumentu. Zmiana symbolu po zgodnym
ISIN zachowuje ID; niejednoznaczna tożsamość lub zmiana waluty wymaga sprawdzenia.
Import obejmuje akcje PLN na GPW i akcje USD na rozpoznanych giełdach USA;
OTC, inne waluty i nieznane MIC są pomijane, a nie zgadywane.

`GET /market-data/instruments?q=PKO&mic=XWAR&page=1&pageSize=25` wymaga sesji.
Zwraca `items`, `total`, `page`, `pageSize`. Wyszukiwanie obejmuje symbol,
nazwę i ISIN, a dane pochodzą wyłącznie z PostgreSQL. Maksymalna strona ma
100 pozycji. Endpoint nie udostępnia tokenu ani mapowań dostawcy.

Po migracji i buildzie katalog synchronizuje operator:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run build
npm --prefix backend run market-data:catalog -- --execute
```

`EODHD_API_TOKEN` ustawiamy w ignorowanym `backend/.env`. Opcjonalne
`EODHD_DAILY_BUDGET` ma zakres 1–20 i domyślnie wynosi 20. Każdy odczyt
danych sprawdza bezpłatny endpoint użycia, a PostgreSQL atomowo rezerwuje
jednostkę dla klucza i dnia UTC. Licznik nie cofa się po błędzie ani restarcie.
Uwzględniamy także zużycie poza aplikacją. Nie korzystamy z bonusowych jednostek.
Rezerwacje utrzymują odstęp 3,2 s, a 402/429 blokuje kolejne próby na czas
ochłonięcia. Brak klucza nie uniemożliwia działania ręcznego portfela.

Synchronizacja katalogów kosztuje dwie jednostki. Nie jest wykonywana przy
starcie API ani przy otwarciu panelu. Testy używają wymyślonych danych.
JSON dostawcy parsujemy z zachowaniem oryginalnych cyfr liczb (Node 24),
a liczby rynkowe przechodzą walidację Decimal przed zapisem.

## Notowania, FX i zdarzenia

`PriceBar` przechowuje surowe OHLCV oraz osobne `adjustedClose`; do wyceny
pozycji używamy surowego close. `FxRate` zapisuje tabelę A NBP jako referencyjny
kurs PLN za USD. Nie zastępuje kursu rzeczywiście wykonanej wymiany walut.
`CorporateAction` przechowuje split lub dywidendę, jej podstawę kwotową i
opcjonalną datę wypłaty. Sam import zdarzenia rynkowego nie zmienia rejestru rachunku.

Identyczne ponowienie aktualizuje tylko czas ostatniego pobrania. Zmiana treści
tworzy kolejną rewizję; poprzednia pozostaje w bazie, a unikalny aktywny slot
wskazuje obecną wersję. Blokada instrumentu serializuje równoległe zapisy.
Źródło, data sesji, pobranie i ewentualna data publikacji pozostają rozdzielone;
brak chwili publikacji u dostawcy daje `null`, a nie wymyślony czas.

`GET /market-data/instruments/:id/prices?from=2026-11-01&to=2026-11-18`
wymaga sesji, odczytuje wyłącznie bazę i zwraca aktualne rewizje z liczbami
jako stringami. Zakres jest ograniczony do roku. Pusta seria oznacza brak
danych; nie tworzy zerowych cen. Rewizje zachowujemy do odtworzenia obliczeń.

## Worker i kolejka

Worker działa osobno od API. Redis przechowuje kolejkę, ale źródłem prawdy
jest `MarketJob` w PostgreSQL: trwały klucz biznesowy, stan, próby, czas kolejnej
próby i dzierżawa procesu. Ten sam rekord stanowi outbox. Po utracie Redis
niezakończone zadania są ponownie publikowane. Token wykonania chroni zapis
wyniku przed zakończeniem przez stary proces. Zakończony sukcesem klucz nie
jest wykonywany ponownie. Błędy mają tylko bezpieczne kody.

```bash
docker compose up -d --wait db redis
# W backend/.env: REDIS_URL=redis://127.0.0.1:6379/0
# W backend/.env: MARKET_DATA_ENABLED=1
npm --prefix backend run build
npm --prefix backend run start:worker
```

Domyślnie worker jest wyłączony. Nie uruchamia się w procesie API ani w testach
HTTP. Harmonogram tworzy zadania cen dla posiadanych instrumentów, kursów NBP
oraz rzadsze zadania zdarzeń. Ceny mają pierwszeństwo przed zdarzeniami.
Wyczerpanie budżetu przesuwa próbę po resetowaniu limitu UTC. Inne błędy
przejściowe mają rosnące opóźnienie; po pięciu próbach pozostają do sprawdzenia.
Zadania z niepoprawnymi danymi/konfiguracją nie są ponawiane automatycznie.
Odstęp dotyczy także bezpłatnych odczytów zużycia API.

Testy Redis wymagają oddzielnej usługi na porcie 6380; nie używają domyślnie
REDIS_URL. Każdy test ma osobną nazwę kolejki, a CI uruchamia osobny Redis.

```bash
docker compose --profile test up -d --wait redis-test
REDIS_URL_TEST=redis://127.0.0.1:6380/0 npm --prefix backend run test:integration -- test/market-data-jobs.integration-spec.ts
```
