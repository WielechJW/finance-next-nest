# Weryfikacja portfela i FIFO — INV 2.4 (#55)

Wspólny scenariusz ma jawne, ręcznie policzone oczekiwania w
`backend/test/support/investment-scenario.ts`. Test akceptacyjny zapisuje operacje
przez `InvestmentPostingService` w PostgreSQL i odczytuje ponownie zapisany rejestr.
Nie korzysta z notowań ani zewnętrznego brokera.

| Krok | Gotówka PLN | Akcje | Koszt pozostały PLN | Wynik sprzedaży PLN |
| --- | --- | --- | --- | --- |
| Wpłata 1000 | 1000.00 | 0 | 0 | — |
| Zakup 10 × 50 + 5 prowizji | 495.00 | 10 | 505.00 | — |
| Sprzedaż 4 × 60 − 2 prowizji | 733.00 | 6 | 303.00 | 36.00 |

Koszt jednej akcji wynosi 50.50, koszt sprzedanych czterech 202.00,
a wpływ netto 238.00. Stąd zysk 238 − 202 = 36.00. Wpłata nie jest zyskiem.
Powtórzenie zapisu sprzedaży z tym samym kluczem nie zmienia żadnego wyniku.

Osobne warianty zaczynają od tego samego scenariusza:

- Korekta ceny zakupu z 50 na 55: gotówka 683.00, koszt sześciu akcji 333.00,
  koszt sprzedanych czterech 222.00, zysk 16.00. Poprzednia wersja zostaje w audycie.
- Dwie równoległe próby sprzedaży pozostałych sześciu akcji po 60 z prowizją 2:
  dokładnie jedna dochodzi do skutku. Gotówka wynosi 1091.00, pozycja jest zamknięta,
  wynik drugiej sprzedaży to 358 − 303 = 55.00. Łącznie rozliczono cały koszt 505.00.
- Drugie konto nie może odczytać ani zmienić rejestru pierwszego użytkownika.

## Mapa kryteriów odbioru etapu 2

| Obszar | Zestaw testów PostgreSQL |
| --- | --- |
| Scenariusz 1000 → 733, 6 akcji, koszt 303, wynik 36; ponowny odczyt i idempotencja | `investment-verification.integration-spec.ts` |
| Kilka partii, podział prowizji, reszty zaokrągleń, pełne zamknięcie | `investment-fifo.integration-spec.ts` |
| Ułamki akcji, osobne PLN/USD, partia otwarcia bez ruchu gotówki | `investment-fifo.integration-spec.ts` |
| Wpłaty, wypłaty, kupno/sprzedaż, dywidendy, opłaty, FX, brak gotówki/akcji | `investment-posting.integration-spec.ts` |
| Konkurujące sprzedaże, korekta historii, anulowanie i przywrócenie | `investment-corrections.integration-spec.ts` i test akceptacyjny |
| Izolacja użytkowników i brak częściowego zapisu po odrzuceniu | Powyższe zestawy |

Uruchomienie z katalogu głównego, po skonfigurowaniu lokalnej bazy `_test`
zgodnie z README:

```bash
npm --prefix backend run test:integration -- test/investment-verification.integration-spec.ts test/investment-fifo.integration-spec.ts test/investment-posting.integration-spec.ts test/investment-corrections.integration-spec.ts
npm --prefix backend run lint
npm --prefix backend run typecheck
```

Testy sprzątają wyłącznie własne konta i instrumenty. Wartości kwot i ilości
pozostają stringami dziesiętnymi; FIFO służy analityce aplikacji.
