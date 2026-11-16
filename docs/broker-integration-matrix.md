# Macierz brokerów i decyzje integracyjne — INV 0.3

Stan na 16 listopada 2026 r. Zadanie: [#46](https://github.com/WielechJW/finance-next-nest/issues/46).
Zakres: akcje GPW i USA, rachunek testowy, późniejsze zlecenia paper/live.
Wersja A prowadzi portfel ręcznie i **nie wymaga połączenia z brokerem**.

To porównanie dokumentacji dostawców, nie wynik logowania do ich rachunków.
Nie otwierano kont, nie pobierano danych z prywatnych API i nie składano zleceń.
„Oferta” oznacza dostępność w platformie brokera; nie potwierdza, że
konkretny instrument i rodzaj zlecenia będą dostępne przez API na danym
rachunku. Puste lub sprzeczne informacje pozostają oznaczone jako **do próby**.

## 1. Rynki, API i środowisko testowe

| Kandydat | API i autoryzacja | Paper / demo | Akcje GPW | Akcje USA | Ocena do dalszej próby |
| --- | --- | --- | --- | --- | --- |
| [Interactive Brokers](https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/) (IBKR) | Web API i TWS API. Klient indywidualny Web API loguje się przez Client Portal Gateway z 2FA; tokenowa autoryzacja dla uprawnionych integratorów wymaga osobnej ścieżki. [Metody](https://www.interactivebrokers.com/docs/web-api/authentication/introduction), [sesja](https://www.interactivebrokers.com/support/faq/articles/56690616). | Osobny rachunek paper i API, powiązany z rachunkiem rzeczywistym. Materiały różnie opisują wymóg jego zasilenia; **warunki otwarcia do potwierdzenia**. Symulacja różni się od egzekucji live. [Rachunek paper](https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/), [warunki](https://www.interactivebrokers.com/campus/trading-lessons/how-to-open-an-ibkr-paper-trading-account/). | GPW w ofercie po uzyskaniu uprawnienia „Central Europe” dla akcji; **dostęp i instrumenty w API do próby**. [GPW](https://www.interactivebrokers.com/support/faq/content/23299047). | [Akcje USA w ofercie](https://www.interactivebrokers.com/en/trading/us-for-non-us-traders.php); **konkretne instrumenty i uprawnienia API do próby**. | Kandydat dla obu rynków; trzeba sprawdzić autoryzację aplikacji wieloużytkownikowej. |
| [Saxo Bank](https://www.home.saxo/pl-pl/platforms/api) | REST/streaming OpenAPI; token OAuth 2.0 i klucz aplikacji. [Autoryzacja](https://www.developer.saxo/openapi/learn/security). | Oddzielne SIM i LIVE; w SIM część danych rynkowych i raportów jest niedostępna albo zwraca dane przykładowe. [Środowiska](https://www.developer.saxo/openapi/learn/environments), [mocki](https://www.developer.saxo/openapi/learn/mock-data-in-simulation). | Platforma oferuje GPW; **konkretne akcje i uprawnienia OpenAPI do próby**. [Akcje](https://www.home.saxo/pl-pl/products/stocks). | Platforma oferuje giełdy USA; **konkretne akcje i uprawnienia OpenAPI do próby**. [Akcje](https://www.home.saxo/pl-pl/products/stocks). | Kandydat dla obu rynków, z jawną luką danych w SIM. |
| [Alpaca](https://docs.alpaca.markets/us/docs/trading-api) | Trading API; osobne klucze paper/live, opcjonalne OAuth aplikacji dla użytkowników. [Klucze](https://docs.alpaca.markets/us/docs/authentication), [OAuth](https://docs.alpaca.markets/us/docs/using-oauth2-and-trading-api). | Darmowe paper; symulacja nie odwzorowuje np. poślizgu i dywidend. [Paper](https://docs.alpaca.markets/us/docs/paper-trading). | Brak potwierdzonego dostępu do GPW; zakres danych giełdowych obejmuje akcje USA. [Pokrycie](https://docs.alpaca.markets/us/docs/about-market-data-api). | Akcje USA w Trading API i paper. | Kandydat tylko do testów USA; nie wystarcza samodzielnie do GPW+USA. |
| [XTB](https://www.xtb.com/pl/centrum-pomocy/platformy-tradingowe-5/czy-xtb-oferuje-narzedzia-automatyzacji-inwestowania) | **API wyłączone 14 marca 2025 r.**; brak obsługiwanej ścieżki automatycznej integracji. | Konto demo w aplikacji/webie, bez API. [Demo](https://www.xtb.com/pl/centrum-pomocy/rachunek-inwestycyjny/konto-demo). | W ofercie platformy; bez API. [GPW](https://www.xtb.com/pl/blog/gpw-wraz-xtb-zwiekszaja-dostepnosc-polskiego-rynku-dla-zagranicznych-inwestorow-indywidualnych). | W ofercie platformy; bez API. [USA](https://www.xtb.com/pl/centrum-pomocy/akcje-i-etf/jakie-sa-warunki-inwestowania-w-spolki-z-usa). | Nie kwalifikuje się do etapu zleceń API; może służyć wyłącznie jako ręczny rachunek. |

## 2. Zlecenia, wykonania i notowania

| Kandydat | Rodzaje zleceń i ograniczenia | Statusy i historia wykonań | Notowania przez API |
| --- | --- | --- | --- |
| IBKR | Web/TWS API opisuje m.in. market, limit i stop. Dostępność wariantu zależy od rynku i rachunku; paper nie obsługuje wszystkich typów. [Typy](https://www.interactivebrokers.com/campus/ibkr-api-page/order-types/), [paper](https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/). | Web API udostępnia bieżące transakcje; TWS `reqExecutions` ma ograniczone okno historii (Gateway: od północy). Dłuższy import i korekty wymagają osobnej próby raportów. [Web API](https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-account-management/), [TWS](https://www.interactivebrokers.com/docs/tws-api/doc/order-management/execution-details). | API ma dane bieżące/historyczne, ale wymaga uprawnień, sesji i właściwych subskrypcji; licencja na wyświetlanie w naszej aplikacji jest **do potwierdzenia**. [Dane](https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/). |
| Saxo | OpenAPI obsługuje m.in. market i limit; typy, czas ważności i parametry trzeba odczytać dla konkretnego instrumentu. [Zlecenia](https://www.developer.saxo/openapi/learn/order-placement). | `/audit/orderactivities` pokazuje także częściowe wykonania i odrzucenia; raporty transakcji w SIM mogą wymagać mocków. [Audyt](https://www.developer.saxo/openapi/learn/audit-orderactivities), [SIM](https://www.developer.saxo/openapi/learn/mock-data-in-simulation). | OpenAPI udostępnia ceny i wykresy, lecz zakres zależy od umów na dane; SIM nie odwzorowuje w pełni LIVE. [Dane](https://www.home.saxo/pl-pl/platforms/api), [środowiska](https://www.developer.saxo/openapi/learn/environments). |
| Alpaca | Market, limit, stop i stop-limit dla akcji USA; ilości ułamkowe i czas ważności mają odrębne reguły. [Zlecenia](https://docs.alpaca.markets/us/docs/orders-at-alpaca). | API aktywności zwraca `FILL` i identyfikator zlecenia; paper symuluje częściowe wykonania. [Aktywności](https://docs.alpaca.markets/us/reference/getaccountactivities-2), [paper](https://docs.alpaca.markets/us/docs/paper-trading). | Dane akcji USA; plan Basic daje ograniczony feed IEX. Brak potwierdzenia GPW. [Plan danych](https://docs.alpaca.markets/us/docs/about-market-data-api). |
| XTB | Brak obsługiwanego API do zleceń. | Brak obsługiwanego API do odczytu wykonań. | Brak obsługiwanego API. [Status API](https://www.xtb.com/pl/centrum-pomocy/platformy-tradingowe-5/czy-xtb-oferuje-narzedzia-automatyzacji-inwestowania). |

## 3. Decyzja o danych dla MVP

**Techniczny wybór do projektowania adaptera #60: EODHD dla dziennych
notowań GPW i USA, niezależnie od brokera.** Wersja A prowadzi ręczny
portfel bez feedu, a fundamenty powstaną później. [Próba INV 0.2](market-data-verification.md)
potwierdziła 5/5 spółek USA, lecz token demo zwrócił `403` dla 5/5 GPW.
Wybór jest **warunkowy**: przed uruchomieniem pobierania GPW potrzebna jest
udana próba uprawnionym kluczem, a przed udostępnieniem danych innym
użytkownikom pisemne potwierdzenie licencji na przechowywanie, wyświetlanie
i powiadomienia. Do tego czasu #45 pozostaje otwarte; Twelve Data jest
rezerwą do porównania. Brak danych nie zamienia się w cenę zero ani w
domniemany brak zdarzenia. Brokerowe notowania nie zastępują tego źródła
bez weryfikacji pokrycia i praw do ich użycia.

Wersja A może powstać z ręcznym rejestrem bez aktywnego adaptera. Wersja B
z wyceną GPW wymaga zamknięcia luki z #45; nie obiecujemy tej funkcji na
podstawie samej dokumentacji lub testu demo.

## 4. Bramka wyboru brokera przed #92 i przed live

IBKR i Saxo zostają kandydatami do **osobnej próby technicznej** dla GPW
i USA. Nie wybieramy jeszcze brokera do zleceń rzeczywistych. Alpaca może
służyć jako punkt porównania testów USA, ale nie spełnia wymogu obu rynków;
XTB odpada przy obecnym braku API. Przed #92 sprawdzamy:

1. Uprawnienia i identyfikatory pięciu akcji GPW oraz pięciu USA z #45 na
   rachunku paper i w API; walutę, możliwość kupna/sprzedaży oraz ograniczenia
   zleceń market/limit, ilości ułamkowych i godzin sesji. Wynik każdej próby
   zapisujemy oddzielnie od deklaracji marketingowej.
2. Autoryzację aplikacji dla wielu użytkowników, zgodę brokera na ten model,
   izolację rachunków i kluczy paper/live oraz procedurę odnowienia sesji.
   Dla IBKR szczególnie sprawdzamy wymóg Gateway i dostępność tokenowej
   ścieżki dla integratora; dla Saxo uprawnienia aplikacji LIVE.
3. Częściowe wykonanie, anulowanie, odrzucenie, nieznany wynik wysłania,
   ponowne pobranie historii i korektę wykonania. Wymagane są trwałe ID
   zlecenia/wykonania i sposób uzgodnienia po restarcie; sam stan pozycji
   nie wystarczy do rekonstrukcji rejestru.
4. Warunki danych GPW/USA, opóźnienie, opłaty i prawo do ich prezentowania
   użytkownikom. Dostęp do notowań w panelu brokera nie jest licencją na
   redystrybucję w naszej aplikacji.
5. Przed etapem live ponownie weryfikujemy ofertę, regulamin, koszty,
   uprawnienia konkretnego użytkownika i wszystkie testy z paper. Sam
   sukces w symulatorze nie potwierdza zachowania zleceń rzeczywistych.

Do momentu przejścia tej bramki integracja pozostaje odłączona. Ręczny
portfel, paper i live mają osobne rachunki, identyfikatory, sekrety i historię
zgodnie z [decyzjami domenowymi](investment-decisions.md).
