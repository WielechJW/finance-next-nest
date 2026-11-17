# Ręczny panel inwestycji — INV 3.3 (#58)

Strony chroni istniejąca sesja panelu Finance. Dane inwestycji są odrębne od
przychodów i wydatków osobistego portfela.

| Strona | Zawartość |
| --- | --- |
| `/dashboard/investments` | Lista i tworzenie portfeli. |
| `/dashboard/investments/[portfolioId]` | Lista i tworzenie rachunków. |
| `/dashboard/investments/[portfolioId]/accounts/[accountId]` | Gotówka PLN/USD, ilości i koszt akcji, historia, zapis i korekta operacji. |

Formularze obsługują wpłatę, zakup i sprzedaż. Korekta wymaga powodu i tworzy
nową wersję zdarzenia; poprzednia pozostaje w audycie API. API obsługuje
również pozostałe typy z [kontraktu](investment-api.md), a historia je pokazuje.
Formularze pozostałych typów będą mogły korzystać z tego samego kontraktu.

Kwoty przyjmują kropkę lub polski przecinek. Ilości i ceny zachowują do 10
miejsc, koszty do 8; formatowanie i normalizacja nie konwertują kwot na Number.
Przy korekcie zdarzenia z dokładną chwilą zachowujemy strefę i offset źródła.
Koszt obejmuje prowizję zakupu, wynik sprzedaży rozlicza FIFO. Nie prezentujemy
wyceny rynkowej bez notowań ani nie dodajemy PLN i USD bez kursu.

Standardowy seed dodaje początkowe metadane dziesięciu instrumentów z próby
GPW/USA: CDR, PKN, PKO, PZU, KGH, AAPL, MSFT, TSLA, AMZN, MCD.
Nie dodaje notowań, danych dostawcy ani transakcji. Powtórzenie zachowuje
istniejące ID i metadane; import pełnego katalogu należy do #60.

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:seed
```

Po zapisie odświeżamy stan i historię. Przy utracie potwierdzenia po wysłaniu
formularz zachowuje treść i klucz idempotencji, blokuje edycję i pozwala
ponowić dokładnie ten sam zapis. Odrzucone dane pozostają w formularzu.
Nowa instancja widoku i przerwanie odczytów przy zmianie użytkownika chronią
przed wyświetleniem danych wcześniejszej sesji.

## Weryfikacja

`backend/test/browser/investments.pw.ts` uruchamia prawdziwe aplikacje i osobną
bazę PostgreSQL. Przechodzi utworzenie portfela/rachunku → wpłatę 1000 PLN →
zakup 10 × 50 + 5 → sprzedaż 4 × 60 − 2 → odświeżenie → korektę ceny zakupu
na 55. Sprawdza gotówkę 733 → 683 PLN, pozostały koszt 303 → 333 PLN i wynik
sprzedaży 36 → 16 PLN. Drugie konto nie widzi zasobów pierwszego.
Osobny test gubi odpowiedź dopiero po zatwierdzeniu operacji przez backend
i potwierdza, że retry pozostawia jedną wpłatę.

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix backend run test:browser:typecheck
npm --prefix backend run test:browser -- investments.pw.ts
```
