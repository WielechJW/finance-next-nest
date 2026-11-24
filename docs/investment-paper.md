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

## Lokalny rejestr zleceń

Rachunek lokalny ma własny portfel i osobne salda PLN oraz USD. Intencja
ma klucz ponowienia oraz trwały `clientOrderId`. Wysłanie, przyjęcie,
odrzucenie, anulowanie i wykonanie przychodzą jako zdarzenia. Wykonanie
zapisuje wpis rejestru w tej samej transakcji. Chroni je identyfikator
wykonania w obrębie rachunku. Numer kolejności w danym dniu pochodzi
z symulatora i pozwala odtworzyć względny czas wpisów, także gdy dotrą później.
Pierwsze dwa numery dnia są zarezerwowane dla sald otwarcia.

W trybie lokalnym obsługiwane są akcje GPW i USA, kupno, sprzedaż oraz zlecenia
market i limit. Warunek ceny oraz dostępne saldo i ilość są sprawdzane przed
zaksięgowaniem wykonania.

## Uzgodnienie stanu

Adapter lokalny zapisuje przyjęcie i wykonania po stronie symulatora w
oddzielnym zbiorze zdarzeń. Po timeout aplikacja szuka trwałego
`clientOrderId`. Gdy wynik pozostaje niepewny, zlecenie ma stan `UNKNOWN`,
a kolejne wysyłki z rachunku są wstrzymane. Ponowne uzgodnienie po restarcie
korzysta z trwałego stanu symulatora.

Raport porównuje otwarte zlecenia, wykonania, pozycje, gotówkę i gotówkę dostępną
po kwotach oczekujących zakupów z ustalonym limitem. Uzgodnienie odtwarza
brakujące wykonania dokładnie raz. Gdy identyfikator nie występuje jeszcze
po stronie symulatora albo występuje inna różnica, blokada pozostaje aktywna.

## Odbiór lokalnej wersji D

Otwórz **Inwestycje → Lokalny symulator zleceń** i załóż osobny rachunek z testową
gotówką PLN i USD. Z historii strategii wybierz **Przenieś sygnał do symulatora**.
Instrument i strona wynikają z zapisanego sygnału. Podaj ilość i ewentualny limit,
zapisz intencję i wyślij ją do symulatora przed upływem ważności sygnału. Wprowadź
cenę, ilość i prowizję wykonania. Panel pokaże aktualny zapis gotówki i pozycji.
Wybierz **Uzgodnij rachunek**, aby porównać księgę z potwierdzeniami symulatora
i zapisać wynik. Po częściowym wykonaniu można anulować resztę i ponownie uzgodnić.

| Rynek | Przejście zapisywane w CI | Oczekiwany wynik |
| --- | --- | --- |
| GPW (XWAR) | Sygnał kupna → intencja na trzy akcje → wygaśnięcie sesji przed wysyłką → przyjęcie po ponowieniu → częściowe wykonanie i anulowanie reszty → uzgodnienie | Dwie akcje, 799,00 PLN z początkowych 1000 PLN, status anulowania z wykonaniem. |
| USA (XNAS) | Sygnał kupna → intencja na jedną akcję → przyjęcie → pełne wykonanie → uzgodnienie | Jedna akcja, 949,50 USD z początkowych 1000 USD, status wykonania. |

`npm run test:integration -- investment-paper.integration-spec.ts` w backendzie
sprawdza także brak odpowiedzi po przyjęciu, wznowienie z nową instancją usługi,
brak potwierdzenia przed przyjęciem, odrzucenie, limit ceny oraz równoczesne
duplikaty. Przy braku rozstrzygającego potwierdzenia rachunek zgłasza rozbieżność
i wstrzymuje wysyłkę. `npm run test:browser -- investment-paper.pw.ts` przechodzi
przez oba rynki z PostgreSQL i Chromium na jawnie przygotowanych danych.

Strategia pobiera zapisane rewizje dziennych kursów zamknięcia z oznaczeniem
źródła EODHD. Wykonanie korzysta z ręcznie podanych cen, ilości i opłat, a próba
przeglądarkowa przygotowuje syntetyczne kursy w PostgreSQL. Zakres odbioru obejmuje
poprawność procesu lokalnego i spójność rejestru. Arkusz zleceń, kolejka
uczestników, jakość wykonania i dostępność danych wymagają weryfikacji
zewnętrznej w #92.
