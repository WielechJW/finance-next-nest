# API inwestycji — ręczne portfele i rachunki (INV 3.1, #56)

Wszystkie poniższe endpointy wymagają sesji HttpOnly. Brak sesji daje `401`.
Zapisy korzystają z istniejącej ochrony CSRF. Odpowiedzi mają `Cache-Control: no-store`.
Portfele inwestycyjne są osobną domeną od osobistego portfela `/wallet`.

Prefiks `P` poniżej oznacza `/investments/portfolios`, a `A` oznacza
`P/:portfolioId/accounts`. Identyfikatory ścieżki muszą być UUID (`400` przy błędzie).

| Metoda i ścieżka | DTO żądania | Odpowiedź |
| --- | --- | --- |
| `POST P` | `{ "name": "Akcje" }` | `201`, portfel |
| `GET P` | — | `200`, tablica własnych portfeli, również pusta |
| `GET P/:portfolioId` | — | `200`, portfel |
| `PATCH P/:portfolioId` | `{ "name": "Nowa nazwa" }` | `200`, portfel |
| `POST A` | `{ "name": "Rachunek ręczny" }` | `201`, rachunek |
| `GET A` | — | `200`, tablica rachunków, również zarchiwizowanych |
| `GET A/:accountId` | — | `200`, rachunek |
| `PATCH A/:accountId` | `{ "name": "Nowa nazwa", "archived": true }` | `200`, rachunek |

Nazwy są tekstami, przycinamy otaczające spacje; długość po przycięciu 1–100 znaków.
PATCH rachunku wymaga przynajmniej jednego pola `name` lub `archived` (boolean).
Pominięte pole pozostaje bez zmian, `null`, błędne typy i dodatkowe pola dają `400`.
Nie przyjmujemy właściciela, identyfikatora portfela ani daty archiwizacji w DTO.
Lista ma stabilny porządek rosnący `(createdAt, id)`.

Portfel zawiera `id`, `name`, `createdAt`, `updatedAt`. Rachunek dodatkowo
`portfolioId` i `archivedAt` (ISO UTC lub `null`). Właściciel pochodzi z sesji;
pełna relacja właściciel → portfel → rachunek jest sprawdzana w każdym odczycie
i zapisie. Cudzy zasób, nieistniejący UUID lub rachunek pod błędnym portfelem
daje `404`, również jeśli obydwa portfele należą do tego samego użytkownika.

Archiwizacja nie usuwa rejestru, pozycji ani sald. Odczyt pozostaje dostępny.
Ponowne `archived: true` zachowuje pierwotną datę. `archived: false` przywraca
rachunek. Zarchiwizowany rachunek odrzuca nowe operacje i korekty (`409`),
ale ponowienie wcześniej zapisanego żądania z tym samym kluczem i treścią
zwraca ten sam identyfikator. Archiwizacja i księgowanie używają tej samej
blokady rachunku w PostgreSQL. Nie udostępniamy endpointu kasowania historii.

Przed uruchomieniem nowej wersji zastosuj migrację:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:generate
```

Testy HTTP na PostgreSQL: `investment-accounts-api.integration-spec.ts`.
Pokrywają sesję, CSRF, DTO, izolację dwóch kont, błędnego rodzica, archiwizację
z historią, blokadę nowych operacji, idempotencję i przywrócenie rachunku.
