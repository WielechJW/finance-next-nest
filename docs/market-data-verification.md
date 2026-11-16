# Weryfikacja dostawcy danych GPW i USA — INV 0.2

Data: 16 listopada 2026 r. Zadanie: [#45](https://github.com/WielechJW/finance-next-nest/issues/45).
Zakres: [decyzje domenowe](investment-decisions.md) i etap 0
[roadmapy](investment-roadmap.md).

**Wynik:** EODHD jest preferowanym kandydatem technicznym dla dziennych
danych MVP. Demo potwierdziło dane pięciu spółek USA. Pięć spółek GPW
zwróciło `403`; ich dane API wymagają weryfikacji kluczem użytkownika.
Publiczne karty potwierdzają symbole i pokazują ceny w złotych, ale nie
zastępują tej próby. Alternatywą jest Twelve Data.

Użytkownik nie ma konta ani klucza dostawcy i wybrał sprawdzenie dostępnych
danych oraz opis ograniczeń. Nie kupowano subskrypcji. Analiza i próba demo
są wykonane; pełne potwierdzenie pokrycia GPW pozostaje warunkiem odbioru
#45. Nie oznaczamy tego etapu roadmapy jako ukończonego.

## 1. Metoda i materiał do odtworzenia

[Skrypt próby](../scripts/verify-eodhd.mjs) wykonuje odczyty EODHD:

| Zasób | Endpoint | Co sprawdzamy |
| --- | --- | --- |
| Katalog | `/api/exchange-symbol-list/WAR` i `/US` | Kod, typ akcji, waluta i obecność ISIN. |
| Ceny dzienne | `/api/eod/{symbol}` | Obecność OHLC, adjusted close i wolumenu. Okno 2026-11-02–2026-11-13. |
| Splity | `/api/splits/{symbol}` | Data i dodatnia proporcja. Okno 2020-01-01–2026-11-13. |
| Dywidendy | `/api/div/{symbol}` | Data, kwota i waluta; obecność kwoty nieskorygowanej i daty wypłaty. To samo okno co splity. |
| Fundamenty | `/api/v1.1/fundamentals/{symbol}?filter=General,Financials` | Zgodność kodu i waluty, obecność sprawozdań. Bez ograniczenia okresu raportów. |

Każde żądanie jawnie wybiera JSON. Gdy katalog jest niedostępny,
tożsamość sprawdzamy przez `General` z fundamentów. Kod dostawcy `WAR`
odpowiada GPW; nie jest MIC `XWAR`. `US` obejmuje giełdy amerykańskie.
Docelowy model zachowa właściwą giełdę i trwałe ID.
[Źródło: Exchanges API](https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours).

[Zapis wyniku demo](market-data/eodhd-demo-2026-11-16.json) zawiera statusy
HTTP, liczniki, wyniki sprawdzeń i czas odczytu. Nie zawiera cen, kwot
dywidend, treści raportów, odpowiedzi błędów ani tokenu. To obserwacja
próby, nie zbiór danych rynkowych do dystrybucji.

Skrypt nie jest adapterem produkcyjnym: nie oblicza wartości pieniężnych,
nie potwierdza poprawności kursów względem giełdy ani kompletności historii.
Parsowanie JSON służy sprawdzeniu struktury. Adapter w #60 ma osobno
zapewnić dokładność dziesiętną zgodnie z decyzjami domenowymi.

## 2. Wyniki pięciu instrumentów GPW

`403` oznacza odmowę dostępu dla użytego tokenu; nie dowodzi braku danych
u dostawcy. PLN w tabeli jest oczekiwaną walutą notowania, zgodną z symbolem
złotego na kartach, nie wynikiem udanego żądania API.

| Instrument i karta dostawcy | Symbol | Waluta | EOD | Splity | Dywidendy | Fundamenty API |
| --- | --- | --- | --- | --- | --- | --- |
| [CD PROJEKT](https://eodhd.com/financial-summary/CDR.WAR) | `CDR.WAR` | PLN | 403 | 403 | 403 | 403 |
| [ORLEN](https://eodhd.com/financial-summary/PKN.WAR) | `PKN.WAR` | PLN | 403 | 403 | 403 | 403 |
| [PKO BP](https://eodhd.com/financial-summary/PKO.WAR) | `PKO.WAR` | PLN | 403 | 403 | 403 | 403 |
| [PZU](https://eodhd.com/financial-summary/PZU.WAR) | `PZU.WAR` | PLN | 403 | 403 | 403 | 403 |
| [KGHM](https://eodhd.com/financial-summary/KGH.WAR) | `KGH.WAR` | PLN | 403 | 403 | 403 | 403 |

Katalog `WAR` również zwrócił `403`. Publiczne karty pokazują podgląd
notowań i ofertę fundamentów. Nie potwierdzają kompletności szeregów,
zdarzeń ani sprawozdań otrzymywanych przez API. Nie eksportujemy danych
z kart jako zamiennika API.

## 3. Wyniki pięciu instrumentów USA

Wszystkie poniższe endpointy zwróciły `200`. Tożsamość, typ akcji i USD
potwierdziła sekcja `General`. Katalog `US` zwrócił `403`, więc nie
potwierdziliśmy jego dostępności na demo.

| Instrument | Symbol | Waluta | Wiersze EOD | Splity | Dywidendy | Roczne raporty: bilans / wynik / przepływy |
| --- | --- | --- | --- | --- | --- | --- |
| Apple | `AAPL.US` | USD | 10 | 1 | 28 | 42 / 42 / 38 |
| Microsoft | `MSFT.US` | USD | 10 | 0 | 27 | 41 / 41 / 38 |
| Tesla | `TSLA.US` | USD | 10 | 2 | 0 | 20 / 20 / 20 |
| Amazon | `AMZN.US` | USD | 10 | 1 | 0 | 30 / 30 / 30 |
| McDonald's | `MCD.US` | USD | 10 | 0 | 27 | 41 / 41 / 37 |

Liczniki zdarzeń dotyczą okna z sekcji 1. `0` oznacza poprawną pustą
tablicę w tym oknie, nie błąd ani gwarancję braku zdarzeń poza nim.
Wszystkie odpowiedzi miały też kwartalne bilanse, rachunki wyników
i przepływy. Liczymy wiersze z datą i co najmniej jedną wartością
liczbową; nie sprawdzamy jeszcze każdej pozycji sprawozdania.

W niepustych odpowiedziach dywidendowych były waluta, kwota nieskorygowana
i data wypłaty. Nie zakładamy takiej kompletności dla GPW. W odczytanym
`General` nie było pola `ISIN`; pozostaje opcjonalne. Różne długości
szeregów raportów wymagają jawnych braków przy analizie fundamentalnej.

Dokumentacja podaje różniące się listy instrumentów demo:
[Help Center](https://eodhd.com/help/plans) i
[Quick Start](https://eodhd.com/financial-apis/quick-start-with-our-financial-data-apis).
Tabela opisuje faktycznie wykonane żądania. Dostęp demo może się zmienić.

## 4. Znaczenie danych i obsługa braków

| Sytuacja | Decyzja dla implementacji |
| --- | --- |
| Brak ceny / odrzucone żądanie | Niepełna wycena z opisem przyczyny; nigdy cena zero. |
| Pusta lista zdarzeń | Brak zdarzeń w badanym zakresie; nie zastępuje walidacji pokrycia. |
| `401` / `403` | Błąd klucza lub uprawnień; bez pętli ponowień i bez wniosku o wycofaniu instrumentu. |
| `402` / `429` | Próba zatrzymuje dalsze odczyty. Worker z #62 otrzyma oddzielną politykę limitów i ponowień. |
| Timeout, HTML lub zła struktura JSON | Osobny błąd transportu/formatu; nie zapisujemy jako poprawnych danych ani pustej historii. |
| Niepełne fundamenty | Brak wskaźnika z przyczyną; przed obliczeniem sprawdzamy okres, jednostkę i walutę. |
| Nieznany czas publikacji | Zachowujemy datę sesji i czas pobrania, bez fikcyjnego czasu publikacji. |

EODHD opisuje OHLC jako ceny nieskorygowane, `adjusted_close` jako
skorygowane o splity i dywidendy, a wolumen jako skorygowany o splity.
Do wyceny pozycji użyjemy surowego close. Całkowita stopa zwrotu wymaga
konwencji zapobiegającej ponownemu naliczeniu dywidendy. Metadane korekty
muszą być jawne. [Źródło: EOD API](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes).

W dywidendach `date` oznacza ex-dividend, `value` kwotę skorygowaną
o splity, a `unadjustedValue` kwotę historyczną. Rejestr gotówki nie może
używać kwoty skorygowanej. Pozostałe daty są opcjonalne; walutę wypłaty
odczytujemy niezależnie od notowania. Samo zdarzenie rynkowe nie tworzy
wypłaty na rachunku. [Źródło: Splits & Dividends API](https://eodhd.com/financial-apis/api-splits-dividends).

## 5. Plany, koszty i budżet EODHD

Ceny w USD z głównego [cennika EODHD](https://eodhd.com/pricing), odczytane
16 listopada 2026 r.; personal, płatność miesięczna, bez promocji.

| Plan | USD / miesiąc | Zastosowanie |
| --- | --- | --- |
| Free | 0 | 20 jednostek dziennie, 20 żądań/min, rok historii. Do ograniczonych prób. |
| EOD Historical All-World | 19.99 | Dzienne ceny, splity i dywidendy prywatnego MVP. |
| EOD + Intraday | 29.99 | Rozszerzenie poza dzienny zakres MVP. |
| Fundamentals | 59.99 | Sprawozdania; sam plan nie obejmuje EOD. |
| All-In-One | 99.99 | Ceny i fundamenty w jednym pakiecie. |

EOD i Fundamentals osobno dają nominalnie 79.98 USD/mies. Zakres
i możliwość łączenia opisuje [Help Center](https://eodhd.com/help/plans).
Fundamenty nie są potrzebne do pierwszej wersji ręcznego portfela.

Płatne plany mają bazowo 100 000 jednostek dziennie i 1000 żądań/min.
Jedno EOD, split, dywidenda lub katalog kosztuje 1 jednostkę; fundamenty
kosztują 10. Dzienny reset: północ GMT. To jednostki, nie liczba żądań.
[Źródło: API Limits](https://eodhd.com/financial-apis/api-limits).

Pełna próba to maksymalnie **42 żądania i 132 jednostki**:
2 katalogi + 10 × (EOD + splity + dywidendy + fundamenty). Nie mieści się
w standardowym limicie Free. Bonus nie zapewnia uprawnień do nieobjętych
planem endpointów. Historia zdarzeń od 2020 r. wymaga odpowiedniego planu.

Szacunek własny: aktualizacja 10 unikalnych instrumentów raz po sesji
to 10 jednostek na ceny lub 30 z odczytem obu typów zdarzeń. Katalog
i fundamenty odświeżamy oddzielnie; wspólne instrumenty użytkowników raz.
Kursy FX i retry zwiększą budżet.

## 6. Przechowywanie, prezentacja i fixture

[Warunki EODHD](https://eodhd.com/financial-apis/terms-conditions) dopuszczają
przechowywanie i analizę w prywatnym, niekomercyjnym użyciu. Ograniczają
udostępnianie, redystrybucję i wyświetlanie danych innym osobom. Personal
nie stanowi podstawy do obsługi wielu użytkowników aplikacji.

Oferta dla projektu musi potwierdzić przechowywanie historii, backupy,
retencję po końcu subskrypcji, panel i Telegram. Nie znaleziono jednoznacznej
zgody na publiczne fixture z odpowiedzi API; nie zakładamy jej na podstawie
dostępu demo. Wycena komercyjna wymaga oferty: 19.99 USD/mies. nie jest
wyceną platformy dla wielu użytkowników.
[Źródło: Commercial vs Personal](https://eodhd.com/financial-apis/commercial-vs-personal-license-use).

W Git zapisujemy własny raport dostępności i liczniki. Testy mają wyłącznie
wymyślone przykłady struktur. Nie publikujemy pobranych szeregów ani
raportów finansowych. Skrypt nie wypisuje treści błędów ani wyjątków,
które mogłyby zawierać klucz.

## 7. Twelve Data i rekomendacja

| Cecha | EODHD | Twelve Data |
| --- | --- | --- |
| GPW | `WAR`, publiczne karty 5/5; API demo 403. | MIC `XWAR`, EOD; próbka PKO wymaga zalogowania. |
| USA | Udana próba 5/5. | Deklarowane pokrycie; bez próby API w tym zadaniu. |
| Plan GPW | EOD All-World, prywatnie 19.99 USD/mies.; wymagane potwierdzenie próbą. | Strona GPW wskazuje Ultra+ / Enterprise+. |
| Koszt i uprawnienia | Cennik personal; osobna oferta dla platformy. | Cennik pokazuje wariant Ultra 999 USD/mies. przy wyświetlonym wolumenie; nie jest to potwierdzona cena minimalna ani oferta dla projektu. |
| Decyzja | Preferowany kandydat do dalszej próby. | Rezerwa po porównaniu pokrycia i otrzymaniu oferty. |

Źródła Twelve Data: [GPW](https://twelvedata.com/exchanges/xwar),
[cennik](https://twelvedata.com/pricing) i
[zasady EOD](https://support.twelvedata.com/en/articles/12682324-end-of-day-eod-pricing-market-data).
Nie potwierdzono API ani kompletności fundamentów GPW tego dostawcy.

Rekomendacja warunkowa: **EODHD do dziennych danych prywatnego MVP,
po udanej próbie GPW; przed udostępnieniem innym użytkownikom osobna oferta
obejmująca ten sposób użycia.** Fundamenty można dołączyć w etapie 8.
Decyzje integracyjne należą do #46, adapter do #60. Broker i dane
do rzeczywistych zleceń mają odrębny zakres.

## 8. Powtórzenie próby i odbiór

Z katalogu głównego, Node.js 24, bez dodatkowych zależności:

```bash
# Publiczne demo, bez konta i odczytu lokalnych sekretów.
node scripts/verify-eodhd.mjs --demo > /tmp/eodhd-demo.json

# Własny EODHD_API_TOKEN w backend/.env lub środowisku.
# Uwzględnij budżet 132 jednostek i zakres swojego planu.
node --env-file-if-exists=backend/.env scripts/verify-eodhd.mjs > /tmp/eodhd-key.json

# Testy z wymyślonymi danymi, bez sieci i klucza.
node scripts/verify-eodhd.test.mjs
```

Kod zakończenia: `0` — wszystkie instrumenty przeszły próbę struktury;
`2` — raport gotowy, ale zawiera braki lub odmowę; `1` — błędne wywołanie
albo brak klucza. Demo w tej próbie daje `2`. `complete: true` dotyczy
obecności i struktury próbki, nie licencji ani zgodności z giełdą.

Skrypt ma timeout 20 s, odczytuje kolejno, a dla własnego klucza zachowuje
odstęp 3.1 s. Przy 402/429 zatrzymuje dalsze żądania, bez retry. Nie przechodzi
samoczynnie na demo po błędzie własnego klucza. Wyniki mogą zmienić się po
korekcie danych lub uprawnień; zachowujemy datę i zakres każdej próby.

| Kryterium #45 | Dowód / pozostały warunek |
| --- | --- |
| Porównanie 5+5, waluty, ceny, zdarzenia, fundamenty | Sekcje 1–3 i JSON; dla GPW odmowa dostępu, pokrycie niepotwierdzone. |
| Próba, luki, plany, limity, koszty, warunki | Sekcje 4–7; wyceny komercyjnej nie zamawiano. |
| Brak sekretów, obsługa braków, rekomendacja | Raport bez wartości finansowych, syntetyczne testy, rekomendacja warunkowa. |

Pełny odbiór wymaga powtórzenia próby GPW własnym kluczem z właściwymi
uprawnieniami, sprawdzenia raportów i uzgodnienia warunków odpowiadających
planowanemu udostępnieniu aplikacji.
