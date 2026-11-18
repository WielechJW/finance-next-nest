# Telegram: połączenie i dostarczanie

Integracja jest przygotowana do późniejszego uruchomienia. Domyślnie bez konfiguracji
nie wysyła wiadomości. Testy używają syntetycznego transportu; nie wykonano próby
na prawdziwym telefonie.

## Konfiguracja

Backend i osobny worker potrzebują `TELEGRAM_BOT_TOKEN`, losowego
`TELEGRAM_WEBHOOK_SECRET` (32–256 znaków A–Z/a–z/0–9/_/-),
`FRONTEND_ORIGIN` i opcjonalnie `TELEGRAM_BOT_USERNAME` do linku `t.me`.
Webhook HTTPS: `POST /integrations/telegram`; Telegram musi dołączać nagłówek
`X-Telegram-Bot-Api-Secret-Token`. Operator rejestruje webhook dopiero podczas
uruchamiania usług. Samo uruchomienie API nie wywołuje Telegrama ani EODHD.
Worker jest wyłączony bez `MARKET_DATA_ENABLED=1`; korzysta z trwałego outboxa.

[Telegram Bot API](https://core.telegram.org/bots/api#setwebhook) opisuje ustawienie
`secret_token`, prywatne wiadomości i odpowiedzi `sendMessage`.

## API sesyjne i panel

Panel **Rynek i alerty** zawiera ustawienia oraz historię dostarczenia.
Wszystkie poniższe zasoby są prywatne dla zalogowanego właściciela:

- `GET /notifications/telegram`: dostępność, połączenie i ustawienia; bez chat ID i tokena.
- `POST /notifications/telegram/pairing`: kod ważny 5 minut, opcjonalny link do bota.
  Baza przechowuje SHA-256 kodu. Nowy kod unieważnia poprzedni.
- `PATCH /notifications/telegram`: `quietStart`, `quietEnd` (minuty 0–1439),
  `timeZone` (Europe/Warsaw, America/New_York, UTC), `dailySummaryEnabled`.
- `DELETE /notifications/telegram`: odłączenie i anulowanie oczekujących prób.
- `GET /notifications?page=1`: 25 pozycji i `total`, od najnowszej.
- `POST /notifications/:id/retry`: `{ "acknowledgeDuplicateRisk": false }`.
  Stan UNKNOWN wymaga wartości true. Pozostałe konta otrzymują 404.

Użytkownik wysyła `/start KOD` w prywatnej rozmowie z botem. Weryfikowane są
nadawca równy chat ID, typ rozmowy, termin i jednorazowość kodu. Jedna rozmowa
może należeć do jednego konta aplikacji. Publiczny webhook weryfikuje sekret
przed przetwarzaniem danych. Nie przyjmuje arbitralnego chat ID od użytkownika API.

## Polityka dostarczenia

Alert tworzy jeden logiczny `AlertEvent` i zadanie outbox w tej samej transakcji.
`Notification` ma unikalny event ID. Treść utrwala symbol, rynek, cenę, próg,
walutę, sesję, czas zdarzenia i odnośnik do aplikacji. Wiadomości są zwykłym tekstem.

Stan PENDING → PROCESSING → SENT/FAILED/UNKNOWN. Każde rozpoczęcie transportu
ma osobny numer próby. Maksymalnie 5 prób na powiadomienie i 10 prób na użytkownika
w godzinie; blokada użytkownika serializuje naliczanie. Odpowiedź 429 pozwala na
odroczone ponowienie. Timeout, błąd sieci, 5xx i niepoprawna odpowiedź oznaczają
UNKNOWN. Nie są ponawiane automatycznie, ponieważ wiadomość mogła dotrzeć.
Restart zastający PROCESSING po 120 sekundach oznacza UNKNOWN. Aktywne równoległe
wywołanie jest odraczane. Ręczne ponowienie UNKNOWN wymaga zgody właściciela
na możliwy duplikat. Nie ma gwarancji jednego fizycznego doręczenia przez Telegram.

Cisza domyślnie 22:00–07:00 Europe/Warsaw, z obsługą zmian czasu.
Równe godziny wyłączają ciszę. Odroczenie nie zużywa próby wysyłki. Alert starszy
niż 24 godziny, usunięta reguła albo brak połączenia kończą się CANCELLED.
Jednorazowy alert wyłączony po wyzwoleniu nadal może być doręczony.
Odłączenie/rebind jest sprawdzane przed wysyłką; rozpoczętej prośby HTTP
nie można cofnąć. Błędy zawierają kody, nigdy token/URL transportu.

Opcjonalne podsumowanie jest planowane raz dziennie po zamknięciu obu rynków
oraz 90-minutowym buforze publikacji. Używa zapisanych cen/FX, nie pobiera danych
od dostawcy. Braki wyceny są jawne; do 15 portfeli w wiadomości. Dni bez sesji
obu rynków są pomijane. Podsumowanie podlega tej samej ciszy i limitom.

## Odbiór

Automatycznie: `npm test -- src/notifications/telegram.spec.ts`,
`npm run test:integration -- notifications.integration-spec.ts`,
Playwright `watchlists-alerts.pw.ts`. Obejmuje prywatny webhook, wygasanie i replay
kodu, izolację kont, równoległe wysłania, restart/UNKNOWN, ręczne ponowienie,
ciszę, DST, 429, odłączenie i idempotencję podsumowania. Rzeczywista wysyłka
przy zamkniętej stronie pozostaje osobnym krokiem uruchomienia usług.
