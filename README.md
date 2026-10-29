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
npm --prefix backend run prisma:status
```

Model `User` ma identyfikator UUID, unikalny e-mail, hash hasła i daty utworzenia
oraz aktualizacji. Konta można tworzyć przez API rejestracji opisane poniżej.

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

Poprawne żądanie tworzy użytkownika i zwraca `201 Created` z polami `id`,
`email` i `createdAt`. Dane zobaczysz też w Prisma Studio:

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
frontendowych opisano poniżej; CSRF i ograniczanie prób logowania to etap #7.

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
Poprawne logowanie prowadzi do `/dashboard`, gdzie widać e-mail użytkownika
i przycisk wylogowania. Odświeżenie strony zachowuje sesję, a wejście bez sesji
prowadzi do logowania. Formularze blokują kolejne wysłanie podczas żądania,
pokazują błędy i zachowują wpisane dane przy niepowodzeniu. Potwierdzenie hasła
nie jest wysyłane do API. Zbyt długie hasło jest odrzucane z komunikatem,
a jego treść nie jest automatycznie skracana.

Wspólny klient API wysyła `credentials: include` i `cache: no-store`, obsługuje
odpowiedź `204`, przerwanie żądania i limit oczekiwania 15 sekund. Backend
udostępnia odpowiedzi przeglądarce z dokładnie skonfigurowanego originu wraz
z obsługą cookies. CORS nie zastępuje ochrony CSRF zaplanowanej w #7.

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
2. Odśwież `/dashboard` i sprawdź e-mail użytkownika.
3. Wyloguj się, użyj przycisku Wstecz i spróbuj wejść na `/dashboard`.
4. Zaloguj inne konto i sprawdź, czy widać właściwe dane, również w drugiej karcie.
5. Sprawdź błędne hasło, zajęty e-mail i ponowienie operacji po błędzie połączenia.

Testy jednostkowe klienta API, formularzy i stanu sesji:

```bash
npm --prefix frontend test
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
| `backend/src/main.ts` | Uruchomienie serwera NestJS na porcie 3001. |
| `backend/src/app.module.ts` | Rejestracja kontrolerów i serwisów. |
| `backend/src/app.controller.ts` | Obsługa adresów API i metod HTTP. |
| `backend/src/app.service.ts` | Logika wywoływana przez kontroler. |
| `backend/src/prisma/prisma.service.ts` | Wspólny klient Prisma i cykl połączenia z bazą. |
| `backend/prisma/schema.prisma` | Modele danych. |
| `backend/prisma.config.ts` | Konfiguracja poleceń Prisma i migracji. |

## Sprawdzenie projektu

```bash
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run test:integration
npm --prefix backend run build
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
