# Import historii inwestycyjnej z CSV

Na rachunku inwestycyjnym wybierz **Import historii CSV** i wskaż plik oraz
format. Aplikacja zapisuje partię i wynik odczytu każdego wiersza. Saldo i
historia operacji pozostają bez zmian. Ponowne przesłanie tego samego pliku
w tym samym formacie i na ten sam rachunek zwraca istniejącą partię.

## Szablon ogólny

Na stronie importu możesz pobrać przykładowy plik. Nagłówki `type` i
`occurredOn` są obowiązkowe. Pozostałe kolumny zależą od rodzaju operacji.
Wpisz ticker z kodem rynku MIC lub ISIN, gdy operacja dotyczy instrumentu.
`externalId` jest opcjonalnym identyfikatorem operacji w źródle.

| `type` | Kolumny obowiązkowe poza datą | Kolumny opcjonalne |
| --- | --- | --- |
| `DEPOSIT`, `WITHDRAWAL`, `FEE` | `currency`, `amount` | |
| `BUY`, `SELL` | `currency`, `quantity`, `unitPrice` i instrument | `commission` |
| `DIVIDEND` | `currency`, `grossAmount` | `withholdingTax`, `fee`, instrument |
| `FX` | `soldCurrency`, `boughtCurrency`, `soldAmount`, `boughtAmount` | `commission` w walucie sprzedawanej |
| `OPENING_POSITION` | `currency`, `quantity`, `totalCost`, `acquiredOn` i instrument | |
| `SPLIT` | `currency`, `numerator`, `denominator` i instrument | |

Obsługiwane waluty to PLN i USD. Użyj kropki lub przecinka jako separatora
dziesiętnego i pomiń separatory tysięcy. Pole z przecinkiem w pliku rozdzielanym
przecinkami wymaga cudzysłowu. Datę można zapisać jako `YYYY-MM-DD`, `DD.MM.YYYY`
lub `YYYYMMDD`. Opcjonalne pola `settledOn` oraz `marketSessionOn` mają ten
sam format. Jeśli wypełniasz `executedAt`, użyj ISO 8601 z przesunięciem i podaj
strefę IANA w `sourceTimeZone`. `occurredOn` musi odpowiadać dacie w Warszawie.

## Interactive Brokers Activity Flex Query

W Client Portal utwórz **Activity Flex Query** z jedną sekcją **Trades** i
poziomem **Executions**. Wybierz jeden rachunek, wyłącz anulowane wykonania,
włącz nagłówki kolumn, wyłącz kody sekcji oraz rekordy otwierające i zamykające.
Wybierz CSV i datę `yyyyMMdd` lub `yyyy-MM-dd`. Import korzysta z daty
wykonania i zachowuje dokładność do dnia.

| Pola eksportu | Wynik w partii |
| --- | --- |
| `AssetClass`, `LevelOfDetail` | Tylko wykonania akcji `STK`, `EXECUTION` |
| `Buy/Sell`, `TradeDate`, `TradeID` | Typ, data operacji, identyfikator brokera |
| `Symbol`, `ISIN`, `CurrencyPrimary` | Ticker, ISIN i waluta |
| `Quantity`, `TradePrice` | Dodatnia ilość i cena jednostkowa |
| `IBCommission`, `IBCommissionCurrency` | Obciążenie w walucie instrumentu |
| `Taxes`, `OrigTradeID` | Wykrywają dodatkowy podatek lub korektę wymagające weryfikacji |

Format dotyczy wykonań kupna i sprzedaży na akcjach. Pozostałe operacje
można przygotować w szablonie ogólnym. Testy adaptera korzystają z próbek
utworzonych według specyfikacji pól brokera.
[Instrukcja eksportu CSV](https://www.interactivebrokers.com/support/faq/content/58445893),
[definicje pól Trades](https://ibkrguides.com/reportingreference/reportguide/tradesfq.htm),
[opcje układu pliku](https://ibkrguides.com/reportingreference/reportguide/delivery%20configuration%20and%20general%20configuration.htm).

## Limity i wynik odczytu

Plik może mieć do 1 MB i 5000 rekordów. Wiersz to jedna fizyczna linia o
maksymalnej długości 4096 znaków. Obsługiwane kodowania to UTF-8 (także z BOM),
UTF-16 z BOM i Windows-1250. Separatory wykrywane z nagłówków to przecinek,
średnik i tabulator. Nagłówki są niewrażliwe na wielkość liter.

Partia zawiera typ formatu, autora, status, rozpoznane kodowanie, znormalizowane
wartości i ewentualny błąd wraz z numerem wiersza. Przesłane bajty pliku są
przetwarzane w pamięci. Widok ostatnich partii i ich wiersze są dostępne po
zalogowaniu na konto właściciela rachunku.
