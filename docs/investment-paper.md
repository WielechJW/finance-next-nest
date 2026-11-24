# Handel symulowany GPW i USA

Wersja D korzysta z lokalnego symulatora dla GPW i USA. Uzgodnienie z rachunkiem
zewnętrznym pozostaje kryterium odbioru #92. Rachunki symulowane i operacje
rzeczywiste mają osobne rejestry. Wybór modelu lokalnego nie wymaga konta ani
kluczy u brokera.

## Macierz możliwości

| Rynek | Środowisko | Co potwierdza dokumentacja | Co wymaga próby na koncie |
| --- | --- | --- | --- |
| USA | Alpaca Paper | Oddzielny adres paper i osobne klucze. Katalog amerykańskich akcji, zlecenia market i limit, odczyt pozycji i statusów. Paper Only udostępnia dane IEX. Realizacja symulowana korzysta z NBBO. | Dostęp właściciela, status handlowy instrumentów, godziny i cykl przyjęcia, anulowania oraz wykonania. |
| GPW | Interactive Brokers Paper | Akcje warszawskie wymagają uprawnienia Central Europe. IBKR udostępnia Web API i TWS API dla rachunku paper. Symulator ma ograniczenia rodzajów zleceń i buduje wykonania na podstawie najlepszych ofert. | Dostęp właściciela do rachunku paper, uprawnienia Central Europe, identyfikatory kontraktów, PLN, dane GPW, sesje i akceptacja market oraz limit. |
| GPW i USA | Lokalny symulator | Środowisko odtwarza stan z kontrolowanych danych i osobnego rejestru. Scenariusze weryfikują statusy i ponowienia bez zależności od konta brokera. | Ograniczenia modelu lokalnego są częścią odbioru scenariuszy. Integrację z brokerem odbiera się na jego rachunku paper. |

[Alpaca Paper Trading](https://docs.alpaca.markets/us/docs/paper-trading) ·
[Katalog aktywów Alpaca](https://docs.alpaca.markets/us/reference/get-v2-assets-1) ·
[Uprawnienia GPW w IBKR](https://www.interactivebrokers.com/support/faq/content/trade-warsaw-stock-exchange-wse-23299047) ·
[API i rachunek paper w IBKR](https://www.interactivebrokers.com/support/faq/articles/629297841) ·
[Model realizacji IBKR Paper](https://www.ibkrguides.com/advisorportal/aboutpapertradingaccount.htm)

## Odbiór adaptera zewnętrznego

1. Potwierdzić dostęp właściciela i typ rachunku przed pobraniem prywatnych danych.
2. W konfiguracji paper ustawić osobny identyfikator rachunku, adres usługi i
   klucze z magazynu sekretów. Sprawdzać typ rachunku przy uruchomieniu adaptera.
3. Sprawdzić instrumenty z obu rynków, waluty, sesje i źródła cen. Zanotować
   różnicę między obserwacją strategii a ceną, którą wykorzystał broker paper.
4. Odczytać środki i pozycje. Przeprowadzić test zleceń paper market oraz limit,
   zapisując przyjęcie, wykonanie, anulowanie i trwały identyfikator klienta.

Testy na rachunku zewnętrznym wymagają jawnej zgody właściciela środowiska.
Tryb lokalny ma osobny stan i służy do odbioru przepływu wewnątrz aplikacji.
