# Wdrożenie wersji B i obsługa awarii

Kod i konfiguracja są przygotowane. Serwer, DNS, HTTPS i Telegram nie zostały
uruchomione w ramach implementacji. Próba wysyłki na rzeczywisty telefon nastąpi
na osobne polecenie. Wymagane: Docker z Compose v2, Linux, zasoby na PostgreSQL,
Redis, API, worker i frontend oraz niezależne miejsce na zaszyfrowane kopie.

## Konfiguracja i pierwsze uruchomienie

1. Skopiuj `deploy/.env.production.example` do ignorowanego
   `deploy/.env.production`; ustaw uprawnienia 600. Przechowuj ten plik także
   w swoim menedżerze sekretów. Nie dodawaj go do Git ani obrazu.
2. Wybierz domeny tego samego serwisu, np. `finance.example.com` oraz
   `api.finance.example.com`. Ustaw rekordy DNS na serwer. Otwórz tylko porty
   80/443 dla aplikacji. PostgreSQL, Redis i API nie publikują portów hosta.
   Ten układ używa cookies Secure/HttpOnly/SameSite=Lax i CORS dokładnego originu.
   Różne domeny rejestrowalne wymagają osobnego projektu polityki cookies.
3. Ustaw losowe hasło bazy, odpowiadające mu `DATABASE_URL` do hosta `db`,
   losowy `SESSION_SECRET` min. 32 bajty i adres e-mail TLS. Hasło w URL zakoduj
   procentowo albo wybierz znaki URL-safe. Klucze EODHD/Telegram pozostają
   puste do świadomej aktywacji. `MARKET_DATA_ENABLED=0` wyłącza synchronizację.
4. Zapisz SHA wersji i zbuduj obrazy: `deploy/compose.sh build`.
   Frontend utrwala `NEXT_PUBLIC_API_URL` podczas budowania. Zmiana API_DOMAIN
   wymaga przebudowania frontendu. Użyj wybranego, przetestowanego commita.
5. `deploy/compose.sh up -d --wait` uruchamia bazę/Redis, wykonuje migracje
   w osobnym kontenerze, a dopiero po ich sukcesie startuje API i frontend.
   Caddy zapewnia HTTPS dla dwóch domen i utrwala certyfikaty. Pierwsze wydanie
   wymaga dostępu do ACME i publicznie poprawnego DNS. Obrazy używają Node 24;
   przed wydaniem produkcyjnym przypnij sprawdzone digesty obrazów bazowych.
6. Sprawdź `https://API_DOMAIN/health/live` oraz `/health/ready`, zaloguj się
   z domeny frontendu i sprawdź trwałość sesji po odświeżeniu.
   Ustaw `OPERATOR_USER_ID` na UUID wybranego użytkownika i odtwórz kontener API.

Kontenery mają politykę `unless-stopped`; Docker musi startować z systemem.
Healthcheck sygnalizuje awarię; sam Docker Compose nie restartuje kontenera tylko
na podstawie statusu unhealthy. Zewnętrzny monitoring powinien alarmować operatora.

## Dane i worker

Po skonfigurowaniu Redis/EODHD ustaw `MARKET_DATA_ENABLED=1` i uruchom
`deploy/compose.sh --profile worker up -d --wait`. Profil worker oraz flaga są
wymagane razem. API readiness wymaga wtedy Redis i heartbeat workera młodszego
niż 120 sekund. Bez flagi readiness sprawdza bazę i nie wymaga procesu synchronizacji.

Katalog importuje się jawnie, po potwierdzeniu budżetu:
`deploy/compose.sh run --rm api node dist/market-data/catalog-cli.js --execute`.
Operacja korzysta z prawdziwego limitu EODHD. Samo uruchomienie API niczego nie
importuje. Worker pobiera ceny dla pozycji, watchlist i aktywnych alertów.
Darmowy limit 20 jednostek/dobę oznacza ograniczony zakres aktualizacji;
przekroczenie budżetu odkłada zadanie do następnego dnia UTC. Dodatkowego
bonusu startowego nie traktujemy jako stałego limitu.

PostgreSQL jest rejestrem zadań/outboxa. Redis AOF jest trwały; po utracie Redis
worker odtwarza kwalifikujące się zadania z PostgreSQL. Nie usuwaj rekordów
MarketJob w celu odzyskiwania kolejki. Rejestry, rewizje cen i snapshoty są
zachowywane; etap B nie kasuje historycznych wersji automatycznie. Monitoruj
rozmiar i zaplanuj archiwizację przed wprowadzeniem retencji.

Kalendarz GPW obejmuje zatwierdzony rok 2026, USA lata 2026–2028. Nieznany rok
zatrzymuje planowanie zamiast zgadywać sesje. Przed 2027 trzeba zaktualizować
GPW na podstawie oficjalnego kalendarza i uruchomić testy świąt/DST.
Weryfikacja dostawcy #45 pozostaje częściowa: potwierdzono katalogi i ceny
próbki GPW/USA; pełny zakres zdarzeń, fundamentów i długiej historii jest otwarty.

## Telegram podczas późniejszej aktywacji

Utwórz bota, ustaw serwerowe `TELEGRAM_BOT_TOKEN`, losowy
`TELEGRAM_WEBHOOK_SECRET` i opcjonalny `TELEGRAM_BOT_USERNAME` w pliku środowiska
API/workera. Odtwórz procesy po zmianie sekretów. Zarejestruj przez Bot API metodę
`setWebhook` z URL `https://API_DOMAIN/integrations/telegram`, `secret_token`
równym sekretowi i `allowed_updates=["message"]`. Wysyłaj token wyłącznie
serwerowo; nie umieszczaj URL zawierającego token w historii terminala ani logach.
Nie wykonuj `drop_pending_updates` bez oceny wpływu na oczekujące wiadomości.
Panel aplikacji generuje kod połączenia ważny 5 minut.

Odbiór: połącz własny telefon, utwórz testowy alert na rzeczywistych świeżych
cenach, zamknij stronę i sprawdź doręczenie. Następnie odłącz Telegram i sprawdź
brak dalszych prób. Nie zmieniaj produkcyjnych cen w celu wyzwolenia testu.
Zasady ciszy, opóźnienia, limitów i UNKNOWN opisuje `telegram-notifications.md`.

## Monitoring i kontrolowane ponowienia

`GET /health/live` daje wyłącznie informację o procesie. `GET /health/ready`
zwraca 200/503 i bezpieczne statusy bazy/Redis/workera, bez adresów ani sekretów.
Readiness nie jest testem uprawnień ani dostępności danych u dostawcy.
Healthcheck workera sprawdza heartbeat w PostgreSQL i Redis.

Zalogowany operator: `GET /operations/market-data` zwraca kolejkę według
rodzaju/stanu, ostatnią udaną synchronizację, heartbeat, wykorzystanie dziennego
budżetu, stany powiadomień i 25 ostatnich błędnych zadań. Próbka maks. 100
instrumentów zawiera datę sesji, pobrania i świeżość; nie zastępuje przeglądu
całego dużego katalogu. Dane diagnostyczne nie ujawniają payloadów, chat ID,
tokenów ani treści prywatnych wiadomości.

`POST /operations/market-data/jobs/:id/retry` ponawia tylko FAILED zadań danych
lub wyceny po usunięciu przyczyny. Budżet dostawcy nadal obowiązuje. Wysyłki
UNKNOWN nie są dostępne w tym mechanizmie: ponawia je właściciel w panelu,
świadomie akceptując możliwy duplikat. Nie ponawiaj ręcznie RUNNING.

Alarmy do ustawienia na serwerze: readiness 503, brak heartbeat >120 s,
rosnąca liczba FAILED/UNKNOWN, nieaktualne ceny po sesji i limit API,
brak udanego backupu w 24 h, mało miejsca i wygasający certyfikat.
Przy awarii sprawdź `deploy/compose.sh ps` i logi API/workera; aplikacja
maskuje błędy integracji kodami. Nie publikuj pełnego `docker compose config`,
środowiska kontenerów ani plików sekretów — mogą zawierać hasła.

## Kopia, odtworzenie i aktualizacja

`deploy/backup.sh` wykonuje pg_dump custom z pełnej bazy, tworzy plik 600
oraz SHA-256 w `deploy/backups` (albo BACKUP_DIRECTORY). Uruchamiaj codziennie
z zewnętrznego timera/cron, szyfruj kopie i wysyłaj poza serwer. Kopie obejmują
również sesje, powiązania Telegrama i prywatne dane; ogranicz dostęp.
Przykład crona z absolutną ścieżką repo: `0 2 * * * /srv/finance/deploy/backup.sh`.
Retencję i przechowywanie poza serwerem skonfiguruj w docelowym środowisku.

`deploy/restore.sh ARCHIVE NOWA_BAZA --confirm-new-database` sprawdza dostępną
sumę i odtwarza do nowej bazy. Odmawia nadpisania istniejącej. Zatrzymaj API,
worker i proxy przed przełączeniem ruchu; zweryfikuj nową bazę i zmień
DATABASE_URL/POSTGRES_DB. Nie uruchamiaj dwóch kopii workerów na odtworzonej bazie.
Po awarii SEND w locie pozostaje UNKNOWN; nie wymuszaj automatycznego retry.
Suma SHA-256 wykrywa uszkodzenie, nie zastępuje szyfrowania i autentyczności kopii.

`deploy/test-backup-restore.sh` sprawdza te same skrypty w nowym kontenerze,
odtwarza dokładną kwotę decimal i potwierdza ochronę istniejącej bazy. Kontener
nie publikuje portów i jest usuwany po teście. Test jest częścią CI.

Przed aktualizacją: backup, zapis poprzedniego SHA/obrazów, migracje i test
odtworzenia na boku. Przywrócenie starego obrazu jest dopuszczalne tylko dla
zgodnego schematu. Migracje nie mają automatycznego down; przy niezgodności
wycofuj przez nowe wydanie naprawcze albo zweryfikowane odtworzenie bazy i
poprzednich obrazów. Nie używaj `down -v` na produkcji.

## Źródła konfiguracji

- [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Compose: kolejność i gotowość usług](https://docs.docker.com/compose/how-tos/startup-order/)
- [PostgreSQL: oficjalny obraz i ścieżka wolumenu dla 18](https://hub.docker.com/_/postgres)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook)
