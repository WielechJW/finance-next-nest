# Finance — nauka TypeScript, NestJS i Next.js

Jeden projekt, dwie aplikacje napisane w TypeScript:

- `frontend/` — Next.js z Reactem i App Routerem: strony i interfejs użytkownika.
- `backend/` — NestJS: API, logika aplikacji i dostęp do PostgreSQL przez Prisma.

Na początek każda aplikacja ma własny `package.json` i `package-lock.json`.
`package.json` opisuje zależności i komendy, a `package-lock.json` zapisuje ich
dokładne wersje. Pliki lock należy dodawać do Gita.

## Wymagania

Node.js 24 LTS, npm i Git. Jeśli korzystasz z nvm, uruchom w tym folderze:

```bash
nvm install
nvm use
```

TypeScript i narzędzia frameworków są instalowane lokalnie z zależnościami.
Do uruchomienia lokalnej bazy potrzebujesz również Dockera z Docker Compose.

## Instalacja po sklonowaniu repozytorium

W głównym katalogu projektu:

```bash
npm --prefix frontend ci
npm --prefix backend ci
```

## Lokalna baza PostgreSQL

W głównym katalogu projektu skopiuj przykładową konfigurację (jednorazowo):

```bash
cp .env.example .env
```

Plik `.env.example` zawiera przykładowe dane do lokalnej nauki. Własne wartości
ustawiaj w `.env`, który jest ignorowany przez Git.

Uruchom PostgreSQL 18 i poczekaj na gotowość bazy:

```bash
docker compose up -d --wait db
```

Baza `finance` jest dostępna na `127.0.0.1:5432`, z użytkownikiem `finance`
i hasłem z `.env`. Sprawdź połączenie:

```bash
docker compose exec db psql -U finance -d finance -c "SELECT current_database();"
```

Oczekiwany wynik to `finance`. Jeśli zmienisz użytkownika lub nazwę bazy
w `.env`, dostosuj odpowiednio argumenty `-U` i `-d`.

Dane są przechowywane w nazwanym wolumenie `postgres_data` i przetrwają
zatrzymanie lub odtworzenie kontenera. Aby zatrzymać bazę:

```bash
docker compose stop db
```

## Prisma i konfiguracja backendu

Prisma 7 opisuje modele w `backend/prisma/schema.prisma`, zapisuje zmiany bazy
jako migracje SQL i generuje typowanego klienta dla NestJS.

Po sklonowaniu repozytorium przygotuj lokalną konfigurację backendu:

```bash
cp backend/.env.example backend/.env
```

Wygeneruj losowy sekret sesji i wklej wynik jako `SESSION_SECRET` w `backend/.env`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Zachowaj ten sekret między uruchomieniami backendu. Zmiana sekretu unieważnia
podpisy istniejących cookies. Plik `.env.example` celowo nie zawiera sekretu.

Ustaw `DATABASE_URL` zgodnie z danymi PostgreSQL w głównym `.env`.
Przykładowy adres dla domyślnej konfiguracji lokalnej:

```dotenv
DATABASE_URL="postgresql://finance:finance_local_dev@127.0.0.1:5432/finance?schema=public"
```

Znaki specjalne w użytkowniku, haśle lub nazwie bazy zakoduj jak w adresie URL.
Główny `.env` konfiguruje Compose, a `backend/.env` jest wczytywany przez Prisma
i NestJS niezależnie od katalogu, z którego uruchamiasz backend. Zmienne
środowiskowe procesu mają pierwszeństwo przed plikiem. Brak lub błędny format
`DATABASE_URL` powoduje czytelny błąd przy starcie, bez wypisywania danych dostępu.

Przy działającej bazie zastosuj zapisane migracje:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:seed
npm --prefix backend run prisma:status
```

Model `User` ma identyfikator UUID, unikalny e-mail, hash hasła i daty utworzenia
oraz aktualizacji. Każde konto otrzymuje prywatny portfel `Wallet` w PLN.
Konta można tworzyć przez API rejestracji opisane poniżej.

Po kolejnej zmianie schematu utwórz migrację i wygeneruj klienta:

```bash
npm --prefix backend run prisma:migrate -- --name opis_zmiany
npm --prefix backend run prisma:generate
```

Migracje w `backend/prisma/migrations/` zapisuj w Git. Wygenerowany klient
w `backend/src/generated/prisma/` jest ignorowany; build, uruchomienie NestJS
i podstawowe testy generują go automatycznie. Generowanie nie wymaga połączenia
z bazą ani ustawionego `DATABASE_URL`.

`PrismaModule` udostępnia jeden `PrismaService` serwisom aplikacji. Backend
łączy się z bazą podczas startu i zamyka połączenia przy zakończeniu procesu.
Testy konfiguracji i endpointu powitalnego działają bez bazy; test endpointu
zastępuje dostawcę Prisma, ponieważ ten endpoint nie wykonuje zapytań.

## Rejestracja użytkownika

`POST /auth/register` przyjmuje JSON z polami `email` i `password`:

```bash
curl -i http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@example.com","password":"Moje testowe haslo 123!"}'
```

Poprawne żądanie tworzy użytkownika razem z portfelem i zwraca `201 Created`
z polami `id`, `email` i `createdAt`. Dane zobaczysz też w Prisma Studio:

```bash
cd backend
npx prisma studio
```

Reguły danych wejściowych:

- E-mail musi być tekstem w poprawnym formacie, po normalizacji do 254 znaków.
  Usuwamy spacje na końcach i zamieniamy litery na małe.
- Hasło musi być tekstem o długości od 15 do 128 znaków. Spacje, Unicode
  i wielkość liter są zachowywane; hasło nie jest przycinane ani skracane.
- Dodatkowe pola są odrzucane. Potwierdzenie hasła sprawdza formularz;
  do API wysyłamy tylko `email` i `password`.

Hasła są zapisywane jako Argon2id: `memoryCost=19456` KiB (19 MiB),
`timeCost=2`, `parallelism=1`, z losową solą generowaną przez bibliotekę.
Parametry odpowiadają jednej z minimalnych konfiguracji
[OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id).
API zwraca wyłącznie jawnie wybrane pola użytkownika. Hasło i hash nie trafiają
do odpowiedzi ani logów rejestracji, także przy błędach zapisu i hashowania.

| Status | Znaczenie |
| --- | --- |
| `201` | Konto zostało utworzone. |
| `400` | Nieprawidłowe dane lub dodatkowe pola. |
| `409` | E-mail jest zajęty, również po normalizacji lub przy równoczesnej rejestracji. |
| `500` | Nie udało się utworzyć konta; szczegóły techniczne nie trafiają do odpowiedzi. |

Unikalność e-maila rozstrzyga indeks w PostgreSQL. Utworzenie konta jest
obsługiwane przez moduły `Auth` i `Users`.

## Prywatny portfel i reprezentacja kwot

Model `Wallet` zawiera UUID, unikalny `userId`, nazwę, walutę i saldo początkowe
`openingBalance`. Domyślne wartości to `Mój portfel`, `PLN` oraz `0.00`.
Enum PostgreSQL dopuszcza wyłącznie PLN. Klucz obcy wymaga istniejącego
użytkownika, a unikalny indeks `userId` pozwala przypisać mu najwyżej jeden
portfel. Usunięcie konta kaskadowo usuwa jego portfel.

`UsersService.create()` używa zagnieżdżonego `wallet.create` w `user.create`.
Prisma wykonuje oba zapisy w jednej transakcji: błąd portfela wycofuje także
utworzenie użytkownika. Hashowanie hasła odbywa się przed transakcją.
Indeks oraz ten przepływ zapewniają dokładnie jeden portfel nowego konta,
także przy równoległych rejestracjach z tym samym e-mailem. Pole `User.wallet`
jest opcjonalne w schemacie Prisma, ponieważ klucz obcy jest po stronie
`Wallet`; sam ten typ nie wymusza istnienia portfela.

Migracja `20261102120000_add_wallet` tworzy strukturę i uzupełnia portfele
wszystkich dotychczasowych użytkowników w jednej transakcji SQL. Zachowuje
ich identyfikatory, hasła, daty i sesje. Przy aktualizacji istniejącej instalacji
zatrzymaj backend, zastosuj migrację, a następnie uruchom nową wersję:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:generate
```

Saldo początkowe jest osobną wartością, a nie transakcją. Może być dodatnie,
zerowe lub ujemne. W bazie używamy `Decimal(14,2)`: 12 cyfr części całkowitej
i 2 cyfry groszy, czyli zakres od `-999999999999.99` do `999999999999.99`.
Kwoty wprowadzamy do `Prisma.Decimal` ze stringów i obliczamy metodami Decimal,
bez pośredniej konwersji przez `Number` lub `parseFloat`.

Kontrakt API portfela przewiduje stringi dziesiętne z kropką
i dokładnie dwoma miejscami po przecinku, np. `"0.10"` i `"-123.45"`.
Pomocnicza funkcja `backend/src/wallets/money.ts` serializuje odczytane kwoty
przez `toFixed(2)`. Przykład dokładnego obliczenia:

```ts
const sum = new Prisma.Decimal('0.10').plus(new Prisma.Decimal('0.20'));
formatMoney(sum); // "0.30"
```

`formatMoney` formatuje zapisane kwoty. Endpoint aktualizacji portfela waliduje
format i zakres przed utworzeniem `Prisma.Decimal`: wymagany jest string
z dokładnie dwoma miejscami po przecinku. PostgreSQL może zaokrąglić
nadmiarowe miejsca dziesiętne, więc sam typ kolumny nie zastępuje tej walidacji.

`npm --prefix backend test` sprawdza reprezentację kwot. Zestaw
`npm --prefix backend run test:integration` weryfikuje atomową rejestrację
(z rzeczywistym błędem zapisu portfela), ograniczenia bazy, granice kwot,
dokładność groszy i usuwanie kaskadowe. Testy migracji tworzą osobne, losowe
schematy w zwalidowanej bazie testowej, odtwarzają wcześniejsze migracje
i sprawdzają aktualizację pustej bazy oraz bazy ze starszymi kontami i sesją.
Po zakończeniu usuwają wyłącznie własne schematy.

## Modele transakcji i kategorii

Etap 3.1 (#13) dodaje `Transaction`, `Category` i enum `TransactionType`
(`INCOME`/`EXPENSE`). Transakcja należy do portfela i kategorii, ma dodatnią
kwotę `Decimal(14,2)`, tytuł, opcjonalną notatkę, datę `occurredOn` typu
PostgreSQL `DATE` i znaczniki czasu. Złożony klucz obcy wymusza zgodność typu
transakcji z kategorią. Usunięcie konta lub portfela usuwa jego transakcje;
kategorie systemowe pozostają.

Po zastosowaniu migracji uruchom powtarzalny seed sześciu kategorii:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:seed
```

Seed buduje backend i zapisuje kategorie po stałych UUID w jednej transakcji.
Można uruchamiać go wielokrotnie; nie tworzy przykładowych transakcji.
Szczegóły modeli, identyfikatory kategorii, reguły kwot i dat oraz komendy
testów opisuje [kontrakt transakcji i kategorii](docs/transactions-api.md).

## API kategorii i transakcji

Etapy 3.2 (#14) i 3.4 (#16) udostępniają endpointy wymagające aktywnej sesji:

| Endpoint | Wynik |
| --- | --- |
| `GET /categories?type=EXPENSE` | `200` z kategoriami wydatków. `INCOME` wybiera przychody, brak filtra zwraca wszystkie kategorie. |
| `POST /transactions` | `201` z transakcją zapisaną w portfelu użytkownika z sesji. |
| `GET /transactions` | `200` z historią własnego portfela, filtrami, paginacją i licznikiem `total`. |
| `GET /transactions/:id` | `200` ze szczegółami własnej operacji; cudza lub nieistniejąca daje `404`. |

Transakcja przyjmuje `type`, `amount`, `categoryId`, `title`, `occurredOn`
i opcjonalne `note`. Kwota jest dodatnim stringiem z dokładnie dwoma miejscami
po przecinku; API sprawdza również istnienie daty i zgodność typu kategorii.
Właściciel i portfel wynikają wyłącznie z sesji, a dodatkowe pola żądania
są odrzucane. Zapis korzysta z istniejącej globalnej ochrony CSRF.

Historia obsługuje opcjonalne filtry `type`, `categoryId`, `from` i `to`,
które można łączyć. Obie daty graniczne są wliczane. Domyślna paginacja to
`page=1&pageSize=20`, a maksymalny rozmiar strony wynosi 100. Wyniki są
sortowane po dacie operacji i identyfikatorze, malejąco. Odpowiedź zawiera
`items`, `page`, `pageSize` i `total`; licznik dotyczy wszystkich pasujących
własnych operacji. Lista i licznik są odczytywane z jednego obrazu danych.
Pusta lub zbyt odległa poprawna strona daje pustą tablicę i status `200`.
Nieprawidłowe daty, odwrócony zakres i błędna paginacja dają `400`.

Przykłady żądań curl, odpowiedzi i statusy błędów opisuje
[kontrakt transakcji i kategorii](docs/transactions-api.md).
Testy API z rzeczywistym PostgreSQL uruchomisz poleceniem:

```bash
npm --prefix backend run test:integration -- test/transaction-api.integration-spec.ts
npm --prefix backend run test:integration -- test/transaction-read.integration-spec.ts
```

Etap 3.3 (#15) wylicza saldo portfela z całej historii zapisanych transakcji.
Etap 3.5 (#17) pozwala dodawać operacje przez formularz w zakładce Transakcje.

## API własnego portfela

| Endpoint | Wynik |
| --- | --- |
| `GET /wallet` | `200` z portfelem zalogowanego użytkownika. |
| `PATCH /wallet` | `200` z portfelem po zmianie nazwy lub salda początkowego. |

Oba endpointy korzystają z tego samego `SessionAuthGuard` co `/auth/me`.
Właściciel jest ustalany wyłącznie z sesji, a zapytania do bazy używają
unikalnego `userId`. Parametry zapytania GET nie pozwalają wybrać innego
użytkownika. Każda poprawna odpowiedź ma `Cache-Control: no-store` i zawiera
wyłącznie następujące pola:

```json
{
  "id": "6f27b471-37dd-4b93-bd55-7e84c4aa2308",
  "name": "Mój portfel",
  "currency": "PLN",
  "openingBalance": "0.00",
  "balance": "0.00"
}
```

Powyżej pokazano nowy, pusty portfel. Bieżące `balance` jest wyliczane przy
odczycie: **saldo początkowe + suma INCOME − suma EXPENSE** z całej historii
własnego portfela. Wliczamy również zapisane operacje z przyszłą datą.
Wynik jest niezależny od filtrów, zakresu dat i paginacji historii.

Przykład: `100.00 + 50.20 − 20.10 = 130.10`. Pusta historia zachowuje saldo
początkowe, a przewaga wydatków może dać ujemny wynik. Saldo bieżące jest
wartością wyliczaną; saldo początkowe pozostaje osobnym polem portfela.

Agregacja i dodanie salda początkowego odbywają się w jednym zapytaniu
PostgreSQL na dokładnych wartościach `numeric`, z jednego obrazu danych.
Prisma zwraca wynik jako `Decimal`, a API serializuje go do stringa z dwoma
miejscami po przecinku. Suma może przekroczyć zakres pojedynczej kwoty
`Decimal(14,2)`, np. `"2999999999999.97"`; panel wyświetla ją dokładnie
przy użyciu stringów i `BigInt`. Limity pojedynczej transakcji i salda
początkowego pozostają określone w ich kontraktach.

`PATCH /wallet` wymaga obiektu JSON z przynajmniej jednym polem:

- `name`: tekst o długości od 1 do 100 znaków po usunięciu spacji na końcach.
  Nazwa złożona wyłącznie z białych znaków jest odrzucana.
- `openingBalance`: string z opcjonalnym minusem, kropką i dokładnie dwoma
  miejscami po przecinku, w zakresie od `-999999999999.99` do
  `999999999999.99`. Dopuszczamy np. `"0.10"`, `"-250.50"` i `"0.00"`.
  `"-0.00"` jest zapisywane i zwracane jako `"0.00"`.

Pominięte pole zachowuje dotychczasową wartość. `null`, pusty obiekt oraz
dodatkowe pola, w tym `id`, `userId`, `walletId`, `currency` i `balance`, dają
`400`. Kwoty jako liczby JSON, z przecinkiem, białymi znakami, znakiem plus,
nadmiarowymi zerami na początku, zapisem wykładniczym albo inną liczbą miejsc
po przecinku także dają `400`. Błędne żądanie nie zmienia portfela.
Oba ustawienia są aktualizowane w jednym zapytaniu bazy. Zapis ustawień
i odczyt wyliczonego salda są wykonywane w jednej transakcji: odpowiedź PATCH
zawiera aktualne `balance`, a błąd agregacji wycofuje zmianę ustawień.

| Status | Znaczenie |
| --- | --- |
| `200` | Portfel odczytany lub zaktualizowany. |
| `400` | Nieprawidłowe dane aktualizacji. |
| `401` | Brak ważnej sesji, także po jej wygaśnięciu lub wylogowaniu. |
| `403` | Żądanie zapisujące z obcej strony odrzucone przez globalną ochronę CSRF. |
| `404` | Brak portfela konta; endpointy nie tworzą go automatycznie. |
| `500` | Błąd bazy; odpowiedź i log nie zawierają szczegółów zapytania. |

CSRF jest sprawdzane przed sesją, więc obcy origin może otrzymać `403` także
bez zalogowania. CORS dopuszcza PATCH z zaufanego frontendu z cookies.

Przykładowy odczyt i zmiana po utworzeniu konta z wcześniejszego przykładu:

```bash
curl -i -c /tmp/finance-wallet-cookies.txt http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@example.com","password":"Moje testowe haslo 123!"}'

curl -i -b /tmp/finance-wallet-cookies.txt http://localhost:3001/wallet

curl -i -b /tmp/finance-wallet-cookies.txt -X PATCH http://localhost:3001/wallet \
  -H 'Content-Type: application/json' \
  -d '{"name":"Budżet domowy","openingBalance":"-250.50"}'

curl -i -b /tmp/finance-wallet-cookies.txt http://localhost:3001/wallet

curl -i -b /tmp/finance-wallet-cookies.txt -c /tmp/finance-wallet-cookies.txt \
  -X POST http://localhost:3001/auth/logout
```

Testy `backend/test/wallet-api.integration-spec.ts` sprawdzają rzeczywiste sesje
i PostgreSQL: odczyt, zapis i częściowe aktualizacje, granice kwot, walidację,
izolację dwóch kont, CSRF, preflight PATCH, wygaśnięcie sesji, wylogowanie oraz
bezpieczne błędy. Korzystają z osobnej bazy `DATABASE_URL_TEST` i sprzątają
własne konta oraz sesje. Przygotowanie bazy opisano w sekcji testów
integracyjnych. Sam zestaw API portfela uruchomisz poleceniem:

```bash
npm --prefix backend run test:integration -- test/wallet-api.integration-spec.ts
```

## Logowanie i sesje

| Endpoint | Wynik |
| --- | --- |
| `POST /auth/login` | `200`, dane użytkownika i cookie sesji. |
| `GET /auth/me` | `200` z aktualnymi danymi użytkownika albo `401` bez ważnej sesji. |
| `POST /auth/logout` | `204`, usunięta sesja i wyczyszczone cookie; powtórzenie jest dozwolone. |

Logowanie przyjmuje `email` i `password`. E-mail jest normalizowany tak jak
przy rejestracji. Hasło jest wymaganym tekstem do 128 znaków i jest sprawdzane
w dokładnie podanej postaci. Niepoprawny format żądania daje `400`, a błędne
hasło i nieistniejący e-mail dają identyczne `401` z komunikatem
`Nieprawidłowy e-mail lub hasło.`. Weryfikacja Argon2 odbywa się także dla
nieistniejącego konta, na przygotowanym podczas startu hashu zastępczym.

Przykładowy cykl po utworzeniu konta powyżej, uruchamiany z katalogu głównego:

```bash
curl -i -c /tmp/finance-cookies.txt http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@example.com","password":"Moje testowe haslo 123!"}'

curl -i -b /tmp/finance-cookies.txt http://localhost:3001/auth/me

curl -i -b /tmp/finance-cookies.txt -c /tmp/finance-cookies.txt \
  -X POST http://localhost:3001/auth/logout

curl -i -b /tmp/finance-cookies.txt http://localhost:3001/auth/me
```

Ostatnie żądanie zwraca `401`. Logowanie i `/auth/me` zwracają wyłącznie `id`,
`email` i `createdAt`; odpowiedzi sesyjnych endpointów mają `Cache-Control: no-store`.
Wylogowanie usuwa rekord w bazie, więc kopia starego cookie także przestaje działać.

Sesje obsługuje `express-session` z magazynem `connect-pg-simple` w PostgreSQL.
Wersjonowana migracja tworzy tabelę `session` z polami `sid`, `sess` i `expire`.
W JSON sesji zapisujemy `userId` oraz ustawienia cookie. Cookie `finance.sid`
zawiera podpisany losowy identyfikator. Każde poprawne logowanie generuje nowy
identyfikator i czeka na zapis w bazie przed odpowiedzią. Błąd magazynu daje
ogólny komunikat `500`, bez wypisywania identyfikatorów sesji i danych logowania.

Domyślnie sesja wygasa po godzinie bezczynności. Aktywne żądania odnawiają
zarówno cookie, jak i termin ważności w bazie. `SESSION_TTL_SECONDS` pozwala
ustawić od 1 do 604800 sekund. Wygasłe rekordy są okresowo usuwane przez magazyn;
nie dają dostępu także przed ich fizycznym usunięciem. Sesje przetrwają restart
backendu dzięki wspólnej bazie i niezmienionemu `SESSION_SECRET`.

Cookie ma `HttpOnly`, `SameSite=Lax` i `Path=/`. Przy `NODE_ENV=production`
otrzymuje również `Secure` i wymaga HTTPS. Lokalnie korzystamy z HTTP.
`TRUST_PROXY_HOPS=0` oznacza brak zaufania do nagłówków proxy. Przy HTTPS
zakończonym na reverse proxy ustaw liczbę zaufanych pośredników zgodną
z rzeczywistą konfiguracją sieci.

`SessionAuthGuard` sprawdza sesję i odczytuje aktualnego użytkownika z bazy.
Usunięcie użytkownika odbiera dostęp jego sesji. Dekorator `@CurrentUser()`
udostępnia kontrolerowi bezpiecznie wybrane dane. Połączenia magazynu i jego
timer sprzątający są zamykane przy zakończeniu aplikacji. Podłączenie formularzy
frontendowych oraz ochronę żądań opisano poniżej.

## Ochrona żądań i ograniczanie prób

Backend korzysta z wbudowanej ochrony CSRF NestJS (dostępnej od 12.1;
wersje używane w projekcie zapisuje lockfile). Przy uruchamianiu konfiguracja
CORS i CSRF korzysta z tego samego, zwalidowanego `FRONTEND_ORIGIN`.
Lokalnie ustaw `http://localhost:3000`, a przy HTTPS dokładny origin frontendu,
np. `https://finance.example.com`. Używamy jednego zaufanego originu,
z obsługą credentials i bez wildcardów.

Ochrona jest globalna i działa przed middleware sesji oraz kontrolerami:
obejmuje rejestrację, login, logout i przyszłe endpointy zapisujące dane.
NestJS sprawdza nagłówki przeglądarki `Sec-Fetch-Site` oraz `Origin`.
Obcy origin, także inny port localhost zgłoszony jako `same-site`, jest
odrzucany kodem `403`. Zaufany frontend może wysyłać żądania między portami
3000 i 3001. Formularze korzystają z ochrony bez dodatkowego tokena CSRF.

`GET`, `HEAD` i `OPTIONS` są dozwolone przez ochronę i nie mogą wykonywać
operacji biznesowych zmieniających dane. Klienci bez obu nagłówków
`Sec-Fetch-Site` i `Origin`, np. zwykły curl, pozostają dozwoleni.
Ochrona opiera się na nagłówkach wysyłanych przez współczesne przeglądarki;
bardzo stare przeglądarki niewysyłające obu nagłówków wymagałyby ochrony
tokenowej. CORS udostępnia obecnie metody GET, HEAD, POST i PATCH; przy dodawaniu
endpointów DELETE należy rozszerzyć tę listę. Globalne sprawdzanie
CSRF już obejmuje tę metodę.

`@nestjs/throttler` ogranicza osobno login i rejestrację na podstawie IP:

| Zmienna w backend/.env | Domyślnie | Znaczenie |
| --- | --- | --- |
| `AUTH_LOGIN_LIMIT` | `10` | Liczba żądań POST /auth/login. |
| `AUTH_LOGIN_TTL_SECONDS` | `60` | Okres zliczania i długość blokady logowania w sekundach. |
| `AUTH_REGISTER_LIMIT` | `5` | Liczba żądań POST /auth/register. |
| `AUTH_REGISTER_TTL_SECONDS` | `900` | Okres zliczania i długość blokady rejestracji w sekundach. |

Liczymy wszystkie próby dopuszczone przez CSRF, także błędne dane wejściowe
i poprawne logowania. Pierwsze żądanie ponad limit rozpoczyna blokadę danego
endpointu i zwraca `429` z polskim komunikatem oraz pozostałym czasem.
Nagłówki `Retry-After-login` i `Retry-After-register` podają czas blokady
w sekundach dla odpowiedniego limitera. Po upływie blokady można próbować
ponownie. Logout i odczyt sesji działają również podczas blokady.

Limity muszą być liczbami całkowitymi od 1 do 1000000, a okresy od 1 do
604800 sekund; błędna konfiguracja zatrzymuje start. Wartości w sekundach
są przeliczane na milisekundy wymagane przez bibliotekę.
Liczniki działają w pamięci jednego procesu i zerują się po restarcie.
Wdrożenie wielu instancji wymaga wspólnego magazynu limitera.
IP jest ustalane przez Express zgodnie z `TRUST_PROXY_HOPS`; lokalne
`0` nie ufa podstawionemu `X-Forwarded-For`. Użytkownicy za tym samym
publicznym IP współdzielą limit danego endpointu.

Odpowiedzi i logi nie zawierają haseł, hashy ani cookies. Frontend pokazuje
czytelne błędy 403/429, zachowuje dane formularza i pozwala ponowić próbę.
Te statusy nie są traktowane jak 401 oznaczające brak sesji.

Testy HTTP ochrony i limitera działają bez bazy:

```bash
npm --prefix backend run test:e2e
```

Zestaw sprawdza zaufane i obce originy, przyszłe metody zapisu, przekroczenie
limitów, powrót po blokadzie, niezależność liczników i podstawianie IP.
Testy konfiguracji limitera uruchamia `npm --prefix backend test`.
Testy integracyjne PostgreSQL dodatkowo potwierdzają, że obce logowanie
i wylogowanie nie naruszają istniejącej sesji, oraz sprawdzają flagi cookie.
W testach rejestracji i sesji progi są podwyższone wyłącznie przez nadpisanie
dostawcy konfiguracji w teście; dedykowane testy bezpieczeństwa korzystają
z rzeczywistego limitera z niskimi progami i świeżym magazynem dla każdego
scenariusza.

Dokumentacja mechanizmów:
[NestJS CSRF](https://docs.nestjs.com/security/csrf) i
[NestJS rate limiting](https://docs.nestjs.com/security/rate-limiting).

## Formularze i panel w przeglądarce

Po instalacji zależności skopiuj konfigurację frontendu:

```bash
cp frontend/.env.example frontend/.env.local
```

Domyślne adresy lokalne:

| Ustawienie | Wartość |
| --- | --- |
| Frontend w przeglądarce | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` w `frontend/.env.local` | `http://localhost:3001` |
| `FRONTEND_ORIGIN` w `backend/.env` | `http://localhost:3000` |

Używaj `localhost` dla obu aplikacji; cookie jest przypisane do hosta.
Po zmianie konfiguracji uruchom aplikacje ponownie. `NEXT_PUBLIC_API_URL`
jest publicznym adresem API dołączanym do kodu frontendu podczas budowania.

Rejestracja na `/register` tworzy konto i prowadzi do `/login` z potwierdzeniem.
Poprawne logowanie prowadzi przez `/dashboard` do `/dashboard/wallet`, gdzie
widać własny portfel, e-mail użytkownika i przycisk wylogowania.
Odświeżenie strony zachowuje sesję, a wejście bez sesji
prowadzi do logowania. Formularze blokują kolejne wysłanie podczas żądania,
pokazują błędy i zachowują wpisane dane przy niepowodzeniu. Potwierdzenie hasła
nie jest wysyłane do API. Zbyt długie hasło jest odrzucane z komunikatem,
a jego treść nie jest automatycznie skracana.

Wspólny klient API wysyła `credentials: include` i `cache: no-store`, obsługuje
odpowiedź `204`, przerwanie żądania i limit oczekiwania 15 sekund. Backend
udostępnia odpowiedzi przeglądarce z dokładnie skonfigurowanego originu wraz
z obsługą cookies. Globalna ochrona CSRF dodatkowo weryfikuje pochodzenie
żądań zmieniających dane.

Stan sesji rozróżnia ładowanie, zalogowanie, brak sesji i błąd sieci. Panel
pokazuje stan ładowania do czasu weryfikacji `/auth/me`. Błąd sieci daje
możliwość ponowienia, a `401` chronionego żądania czyści dane i prowadzi do
logowania. Błędne dane w formularzu logowania pozostają błędem tego formularza.
Każdy chroniony endpoint nadal sprawdza uprawnienia w NestJS.

Dane użytkownika są pobierane bezpośrednio w przeglądarce i nie trafiają do
współdzielonego cache Next.js ani do statycznego HTML panelu. Nie zapisujemy
identyfikatora sesji, hasła ani profilu w localStorage/sessionStorage.
Przy wylogowaniu, zmianie konta i sprawdzaniu sesji poprzednie dane są usuwane
z widoku; spóźniona odpowiedź nie może ich przywrócić. Sesja jest ponownie
sprawdzana przy nawigacji, powrocie do karty i przywróceniu strony z historii.
`BroadcastChannel` synchronizuje zmianę sesji między kartami przez komunikat
bez danych użytkownika; gdy jest niedostępny, pozostaje sprawdzenie przy fokusie.

Ręczne sprawdzenie całej ścieżki:

1. Otwórz `/register`, utwórz konto i zaloguj się z formularza.
2. Odśwież `/dashboard/wallet` i sprawdź e-mail użytkownika oraz dane portfela.
3. Wyloguj się, użyj przycisku Wstecz i spróbuj wejść na `/dashboard/wallet`.
4. Zaloguj inne konto i sprawdź, czy widać właściwe dane, również w drugiej karcie.
5. Sprawdź błędne hasło, zajęty e-mail i ponowienie operacji po błędzie połączenia.

Testy jednostkowe klienta API, formularzy i stanu sesji:

```bash
npm --prefix frontend test
```

## Panel portfela

Po loginie użytkownik trafia na `/dashboard/wallet`. Nawigacja wskazuje
aktywny Portfel. Widok pobiera dane przez `GET /wallet` i pokazuje nazwę,
walutę PLN, bieżące saldo oraz osobno saldo początkowe. Kwoty są prezentowane
w polskim formacie, np. `1 234,50 zł` i `-0,01 zł`. Zera nie są pokazywane
zastępczo podczas ładowania. Przy zerowym saldzie początkowym pojawia się
podpowiedź zachęcająca do jego ustawienia.

Formularz ustawień pozwala zmienić nazwę i saldo początkowe. Nazwa musi mieć
od 1 do 100 znaków po przycięciu białych znaków na końcach. Kwota może używać
przecinka lub kropki, mieć maksymalnie dwa miejsca po przecinku i być ujemna.
Przykłady `123`, `123,4` i `-0,05` są wysyłane odpowiednio jako `"123.00"`,
`"123.40"` i `"-0.05"`. Formularz odrzuca przekroczony zakres, zapis
wykładniczy, separatory tysięcy, nadmiarowe zera na początku oraz nadmiarowe
miejsca dziesiętne. Normalizacja działa na stringach, a formatowanie grupuje
część całkowitą przez BigInt i zachowuje grosze bez konwersji kwoty na Number.

Przycisk zapisu jest nieaktywny, gdy dane nie zmieniły się. PATCH zawiera
wyłącznie zmienione pola. Podczas zapisu pola oraz przycisk są zablokowane,
a podsumowanie zachowuje ostatnio zapisane wartości do czasu sukcesu.
Odpowiedź PATCH odświeża podsumowanie i formularz oraz pokazuje potwierdzenie.
Błąd zapisu zachowuje wpisane dane i pozwala spróbować ponownie. Błąd
pobierania ma osobny przycisk ponowienia. Status `401` korzysta ze wspólnej
obsługi sesji i prowadzi do logowania; `400` i `403` są błędami formularza.

Stan portfela jest powiązany z kontem użytkownika. Zmiana konta, sprawdzanie
sesji lub opuszczenie ekranu usuwa dane i anuluje żądania. Spóźniona odpowiedź
poprzedniego odczytu lub zapisu nie może przywrócić cudzego portfela.
Dane pozostają w pamięci komponentu, bez localStorage i współdzielonego cache.

Ręczne sprawdzenie panelu:

1. Zaloguj się i sprawdź przejście do `/dashboard/wallet` oraz saldo `0,00 zł`
   nowego konta.
2. Ustaw nazwę `Budżet domowy` i kwotę `-250,5`, zapisz i sprawdź obie kwoty
   `-250,50 zł` oraz komunikat `Zmiany zapisane.`.
3. Odśwież stronę i sprawdź zachowanie nazwy oraz salda.
4. Sprawdź pustą nazwę, kwotę `0,001` i ponowienie po błędzie połączenia.
5. Sprawdź formularz klawiaturą: Tab, widoczny fokus i zapis Enterem.
6. Przy szerokości 375 px sprawdź długą nazwę i graniczne saldo
   `-999999999999,99`: układ powinien mieć jedną kolumnę bez przewijania w bok.

Testy frontendu obejmują normalizację i prezentację kwot, klienta portfela,
formularz, blokowanie równoległych zapisów, ponawianie po błędach, nawigację,
przekierowanie po `401` i spóźnione odpowiedzi po zmianie konta.

Weryfikacja portfela i izolacji kont (etap 2.4, #12):

- Testy API tworzą dwa portfele o różnych nazwach i saldach. Podstawienie
  identyfikatorów drugiego konta w odczycie lub aktualizacji nie pozwala
  odczytać ani zmienić jego danych. Niedozwolone pola w treści PATCH dają `400`;
  parametry URL nie zmieniają właściciela ustalonego z sesji.
- Playwright zapisuje `Portfel Ani` z saldem `100,50 zł` oraz `Portfel Bartka`
  z saldem `-20,20 zł`. Sprawdza oba portfele w osobnych kontekstach oraz
  przełączenie A → wylogowanie → B → wylogowanie → A w jednej przeglądarce.
  Nazwa, obie kwoty i pola ustawień muszą odpowiadać aktualnemu kontu,
  także po odświeżeniu.
- Osobne scenariusze sprawdzają zapis obu granicznych kwot i zachowanie groszy
  po odświeżeniu. Pusta nazwa, nadmiarowe miejsca dziesiętne, przekroczony
  zakres i zapis wykładniczy wyświetlają błędy bez wysyłania PATCH.
  Odświeżenie po błędnej edycji przywraca wcześniej zapisane dane.

Ręcznie można powtórzyć powyższy scenariusz na dwóch kontach: po każdym
logowaniu sprawdź nazwę, saldo i oba pola ustawień. Po powrocie na konto A
powinny nadal być widoczne jego wcześniejsze wartości.

## Dodawanie transakcji w panelu

Po zalogowaniu wybierz **Transakcje** w nawigacji (`/dashboard/transactions`).
Strona pokazuje bieżące saldo i formularz z typem operacji, kwotą, kategorią,
tytułem, datą i opcjonalną notatką. Kategorie są pobierane z API i dopasowane
do typu. Zmiana typu czyści poprzedni wybór kategorii. Błąd pobierania
kategorii ma osobny przycisk ponowienia.

Kwota musi być dodatnia, od `0,01` do `999999999999,99`; można użyć przecinka
lub kropki i najwyżej dwóch miejsc po przecinku. Przykład `12,5` jest wysyłany
jako string `"12.50"`, bez obliczeń zmiennoprzecinkowych. Domyślną datę
wyznaczamy według `Europe/Warsaw`. Przyszłe daty są dozwolone i wpływają
na saldo. Tytuł ma od 1 do 100 znaków po przycięciu, a notatka do 1000 znaków.

Błędy walidacji są wyświetlane przy polach; fokus przechodzi na pierwsze
błędne pole. Podczas wysyłania pola i przycisk są zablokowane; blokada obejmuje
również ponowne wywołania zapisu. Błąd zapisu zachowuje wpisane
dane. Status `401` korzysta ze wspólnej obsługi sesji i prowadzi do logowania.

Po sukcesie formularz pokazuje potwierdzenie i czyści kwotę, tytuł oraz
notatkę, pozostawiając typ, kategorię i datę dla kolejnej operacji. Saldo jest
pobierane ponownie z `GET /wallet`. Jeżeli ten odczyt zawiedzie, potwierdzenie
zapisu pozostaje widoczne, a **Odśwież saldo** ponawia wyłącznie GET.
Przejście do Portfela również pobiera aktualne dane. Formularz udostępnia
callback `onCreated` do podłączenia odświeżania historii w etapie 3.6 (#18).
Stan widoku jest powiązany z kontem; opuszczenie widoku lub zmiana konta
anuluje oczekujące żądania i ignoruje ich spóźnione odpowiedzi.

Ręczny scenariusz sprawdzenia:

1. Ustaw saldo początkowe `100,00`, a następnie przejdź do Transakcji.
2. Zapisz wydatek `20,10` z kategorią Jedzenie i sprawdź saldo `79,90 zł`.
3. Zmień typ na Przychód, wybierz Wynagrodzenie i zapisz `50,20`.
4. Sprawdź saldo `130,10 zł`, także po przejściu do Portfela i odświeżeniu.
5. Sprawdź odrzucenie kwoty `0`, komunikat przy pustym tytule oraz obsługę
   formularza klawiaturą i na ekranie 375 px.

Testy formularza, klienta API, warszawskiej daty, błędów i sesji:

```bash
npm --prefix frontend test
npm --prefix backend run test:browser -- transactions.pw.ts wallet.pw.ts auth-session.pw.ts
```

## Testy integracyjne z PostgreSQL

Podstawowe testy (`test` i `test:e2e`) nie wymagają działającej bazy.
Rejestrację z rzeczywistym PostgreSQL sprawdza osobny zestaw:

```bash
cp backend/.env.test.example backend/.env.test
npm --prefix backend run test:integration
```

W `backend/.env.test` ustaw `DATABASE_URL_TEST`, dopasowując użytkownika, hasło
i port do lokalnego PostgreSQL. Wzór wskazuje bazę `finance_test`. Konfiguracja
testów wymaga osobnego adresu, lokalnego hosta, nazwy zakończonej na `_test`
i schematu `public`; nie korzysta zastępczo z developerskiego `DATABASE_URL`.

Przy działającym PostgreSQL przygotowanie testów tworzy bazę testową, jeśli jej
brakuje, i stosuje migracje. Użytkownik z domyślnego Compose ma wymagane
uprawnienia. Testy używają losowych e-maili i usuwają własne rekordy po każdym
scenariuszu. Sprawdzają zapis hasha, walidację, granice długości hasła,
normalizację, duplikaty, równoległe żądania i bezpieczne odpowiedzi na błędy.
Testy sesji obejmują logowanie, izolację dwóch kont, rotację identyfikatora,
restart aplikacji, wygaśnięcie, odnawianie czasu, flagi cookie i wylogowanie.
Sprawdzają też błędy odczytu, zapisu i usunięcia sesji. Każdy proces testowy
używa osobnego sekretu sesji, bez korzystania z developerskiego sekretu.

## Testy całej aplikacji w Chromium

Playwright sprawdza prawdziwy frontend Next.js, API NestJS i PostgreSQL.
Narzędzie i scenariusze znajdują się w backendzie, obok istniejących testów
integracyjnych. Wymagany jest Node.js 24 oraz zainstalowane zależności obu
aplikacji. Jednorazowo pobierz przeglądarkę zarządzaną przez Playwright:

```bash
npm --prefix backend run test:browser:install
```

W istniejącym `backend/.env.test` uzupełnij `DATABASE_URL_BROWSER_TEST`
według `backend/.env.test.example`. Jeśli pliku jeszcze nie ma, skopiuj
przykład. Wartość musi wskazywać osobną lokalną bazę, np.
`finance_browser_test`, z nazwą zakończoną na `_test` i schematem `public`.
Nazwa bazy musi być inna niż w `DATABASE_URL_TEST` i `DATABASE_URL`.
Brak tej zmiennej zatrzymuje testy; nie używamy zastępczo innej bazy.
Dopasuj dane dostępu do swojego lokalnego PostgreSQL.

Przygotowanie aplikacji testowej tworzy brakującą bazę, stosuje migracje
i uruchamia powtarzalny seed kategorii systemowych, korzystając ze wspólnego
mechanizmu testów integracyjnych. Użytkownik bazy
musi mieć uprawnienia do jej utworzenia, tak jak w domyślnym Compose.
Uruchom PostgreSQL, a następnie cały zestaw:

```bash
docker compose up -d --wait db
npm --prefix backend run test:browser
```

Testy samodzielnie budują i uruchamiają obie aplikacje:

| Element | Adres | Wynik kompilacji |
| --- | --- | --- |
| Frontend | `http://localhost:3100` | `frontend/.next-browser-test/` |
| Backend | `http://localhost:3101` | `backend/.browser-dist/` |

Używamy osobnych buildów, więc nie trzeba zatrzymywać aplikacji developerskich
na portach 3000/3001. Porty 3100/3101 muszą być wolne. Playwright nie
wykorzystuje już działających serwerów: w razie konfliktu zwraca błąd.
Po zakończeniu zamyka uruchomione przez siebie procesy.
Frontend jest budowany z testowym `NEXT_PUBLIC_API_URL`, a backend otrzymuje
testowy origin, losowy sekret i osobny magazyn sesji w bazie przeglądarkowej.
Ochrona CSRF działa normalnie. Progi limitera są podwyższone tylko w tym
procesie, aby wielokrotne logowania nie blokowały scenariuszy. Zachowanie
domyślnych progów nadal sprawdzają testy HTTP z poprzedniego etapu.

Scenariusze `backend/test/browser/*.pw.ts` obejmują:

- Rejestrację z formularza, login, odświeżenie panelu i logout.
- Odmowę wejścia na panel bez sesji i odrzucenie starego cookie po logout.
- Błędne hasło, nieistniejące konto i zajęty e-mail po normalizacji.
- Wygaśnięcie sesji w PostgreSQL przy nadal obecnym cookie przeglądarki.
- Izolację dwóch kont w oddzielnych kontekstach przeglądarki.
- Zmianę konta w jednym kontekście i powrót przyciskiem Wstecz po logout.
- Izolację nazw, sald i ustawień portfela w dwóch kontekstach oraz po zmianie
  konta A → B → A w jednym kontekście.
- Edycję portfela z polskim przecinkiem i zachowanie ustawień po odświeżeniu.
- Zapis Enterem na ekranie 375 px, długą nazwę i graniczne ujemne saldo.
- Obie graniczne kwoty po odświeżeniu oraz odrzucenie błędnych ustawień
  bez żądania zapisu i bez zmiany danych w bazie.
- Dodanie wydatku i przychodu z formularza, kategorie zależne od typu,
  przyszłe daty i aktualizację salda także po powrocie do Portfela.
- Zachowanie danych po błędzie sieci, blokowanie równoległych zapisów,
  ponawianie samego odczytu salda i przekierowanie po wygaśnięciu sesji.
- Walidację pól i zapis klawiaturą na ekranie 375 px.
- Saldo z historii zawierającej przyszłą operację oraz przeliczenie wyniku
  po zmianie salda początkowego i po odświeżeniu strony.
- Saldo większe od zakresu pojedynczej kwoty z zachowaniem groszy
  i poprawnym układem na ekranie 375 px.

Każdy scenariusz używa unikalnych kont i osobnego kontekstu przeglądarki.
Fixtures sprzątają własne konta oraz ich sesje także po niepowodzeniu testu.
Wygaśnięcie jest wymuszane wyłącznie dla własnego konta w bazie testowej.
Pozwala to uniknąć oczekiwania na upływ czasu sesji. Istniejący zestaw
integracyjny dodatkowo zawiera jeden ciągły przepływ rejestracja → login →
ponowny odczyt sesji → logout → odrzucenie skopiowanego cookie.

Przydatne komendy:

```bash
# Weryfikacja portfela, izolacji kont i salda z historii (etapy 2.4 i 3.3)
npm --prefix backend run test:integration -- test/wallet-api.integration-spec.ts
npm --prefix backend run test:browser -- wallet.pw.ts auth-session.pw.ts

# Formularze transakcji i aktualizacja salda (etap 3.5)
npm --prefix backend run test:browser -- transactions.pw.ts

# Uruchomienie z widocznym oknem Chromium
npm --prefix backend run test:browser:headed

# Otwarcie raportu HTML po uruchomieniu testów
npm --prefix backend run test:browser:report

# Sprawdzenie typów konfiguracji i testów Playwright
npm --prefix backend run test:browser:typecheck

# Wypisanie scenariuszy bez uruchamiania serwerów
npm --prefix backend run test:browser -- --list
```

Raport jest w `backend/playwright-report/`, a zrzuty ekranu i ślady
nieudanych scenariuszy w `backend/test-results/`. Ślad można otworzyć
z raportu, aby zobaczyć kolejne akcje, stan strony i żądania sieciowe.
Artefakty i buildy testowe są ignorowane przez Git.

Jeśli Chromium zgłasza brak bibliotek systemowych w Linuksie, zainstaluj je
poleceniem `npm --prefix backend run test:browser:install -- --with-deps`.
Jeśli testy nie mogą połączyć się z bazą, sprawdź gotowość kontenera oraz
dane w `backend/.env.test`. Jeśli port jest zajęty, zakończ własny proces
testowy na tym porcie. Pierwsze uruchomienie obejmuje kompilację obu
aplikacji i może trwać dłużej niż kolejne testy jednostkowe.

## Uruchomienie podczas nauki

Otwórz dwa terminale w głównym katalogu projektu.

Terminal 1 — frontend:

```bash
npm --prefix frontend run dev
```

Otwórz http://localhost:3000. Zmień tekst w `frontend/src/app/page.tsx`, zapisz
plik i zobacz zmianę w przeglądarce.

Terminal 2 — backend (po uruchomieniu bazy i zastosowaniu migracji):

```bash
npm --prefix backend run start:dev
```

Tryby `start:dev` i `start:debug` zapisują wynik kompilacji oraz cache
TypeScript w `backend/.dev-dist/`. Produkcyjny `build` korzysta z
`backend/dist/`, a testy przeglądarkowe z `backend/.browser-dist/`.
Dzięki osobnym katalogom build nie usuwa plików używanych przez tryb watch.
Po zmianie tej konfiguracji zatrzymaj poprzedni proces przez `Ctrl+C`
i uruchom `start:dev` ponownie, aby przejął nowy katalog.

Otwórz http://localhost:3001 — API odpowiada `Hello World!`.
Możesz też sprawdzić je komendą `curl http://localhost:3001`.
Zmiany w kodzie automatycznie restartują backend. `Ctrl+C` zatrzymuje aplikację.

Obie aplikacje uruchamiasz osobno. Na `http://localhost:3000` formularze
korzystają już z API działającego na porcie 3001.

## Od których plików zacząć

| Plik | Za co odpowiada |
| --- | --- |
| `frontend/src/app/page.tsx` | Strona główna i komponent Reacta. |
| `frontend/src/app/layout.tsx` | Wspólny układ stron i metadane. |
| `frontend/src/components/transaction-form.tsx` | Formularz dodawania wydatków i przychodów. |
| `frontend/src/components/transactions-panel.tsx` | Zakładka Transakcje i odświeżanie salda po zapisie. |
| `frontend/src/lib/transactions-api.ts` | Klient API kategorii i zapisu transakcji z walidacją odpowiedzi. |
| `frontend/src/lib/transaction-input.ts` | Dodatnie kwoty, daty kalendarzowe i dzisiejsza data w Warszawie. |
| `backend/src/main.ts` | Uruchomienie serwera NestJS na porcie 3001. |
| `backend/src/app.module.ts` | Rejestracja kontrolerów i serwisów. |
| `backend/src/app.controller.ts` | Obsługa adresów API i metod HTTP. |
| `backend/src/app.service.ts` | Logika wywoływana przez kontroler. |
| `backend/src/prisma/prisma.service.ts` | Wspólny klient Prisma i cykl połączenia z bazą. |
| `backend/prisma/schema.prisma` | Modele danych. |
| `backend/prisma.config.ts` | Konfiguracja poleceń Prisma i migracji. |
| `backend/src/categories/system-categories.ts` | Stałe UUID kategorii i ich powtarzalny seed. |
| `backend/src/categories/categories.controller.ts` | API odczytu kategorii z filtrem typu. |
| `backend/src/transactions/transactions.controller.ts` | API dodawania, historii i szczegółów własnych transakcji. |
| `backend/src/transactions/dto/list-transactions.dto.ts` | Walidacja filtrów i paginacji historii. |
| `backend/src/wallets/wallet-balance.ts` | Wspólna agregacja salda z historii dla GET i PATCH portfela. |
| `docs/transactions-api.md` | Kontrakt kwot, dat i kategorii transakcji. |

## Sprawdzenie projektu

```bash
npm --prefix frontend run lint
npm --prefix frontend test
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

## Codzienna praca z Gitem

```bash
git status
git add frontend/src/app/page.tsx
git commit -m "Change home page text"
git push
```

Nie dodawaj `node_modules`, wyników kompilacji ani lokalnych plików `.env` —
chroni przed tym główny `.gitignore`.

## Proponowana kolejność nauki

Szczegółowy zakres i zależności zadań opisuje
[plan projektu w issue #1](https://github.com/WielechJW/finance-next-nest/issues/1).

1. Logowanie: formularze, PostgreSQL i Prisma, API rejestracji, sesje oraz
   połączenie interfejsu z API.
2. Prywatny portfel użytkownika i saldo początkowe.
3. Przychody i wydatki: dodawanie, historia, filtry, edycja i usuwanie.
4. Analityka: podsumowania okresów, kategorie i trendy.

## Dokumentacja

- [TypeScript — podstawy](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
- [NestJS — pierwsze kroki](https://docs.nestjs.com/first-steps)
- [Next.js — instalacja i start](https://nextjs.org/docs/app/getting-started/installation)
