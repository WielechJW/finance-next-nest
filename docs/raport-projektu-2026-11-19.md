# Raport projektu Finance

19 listopada 2026 r.

## Wynik po naprawach

| Obszar | Co zmieniło się dla użytkownika | Zmiana |
| --- | --- | --- |
| Portfel osobisty i pierwsze uruchomienie | Ponowienie wydatku po utracie odpowiedzi zachowuje jeden wpis. Świeże wdrożenie inicjalizuje kategorie i podstawowy katalog przed pierwszą transakcją. | [PR #133](https://github.com/WielechJW/finance-next-nest/pull/133) |
| Inwestycje | Do czasu uzgodnienia splitu aplikacja wskazuje przyczynę braku pełnej wyceny. Historia, stopa zwrotu, snapshot i podsumowanie Telegrama uwzględniają ten stan. Formularz transakcji przeszukuje pełny katalog. | [PR #134](https://github.com/WielechJW/finance-next-nest/pull/134) |
| Zadania w tle i alerty | Worker nadal przekazuje gotowe zadania, gdy błąd wstrzyma planowanie dla jednego rachunku lub rynku. Akcje na archiwalnych rachunkach są odświeżane. Wznowiony alert rozpoznaje pierwsze przekroczenie progu. Kalendarz GPW obejmuje 2027 r. | [PR #135](https://github.com/WielechJW/finance-next-nest/pull/135) |
| Obsługa aplikacji | Portfel pokazuje saldo i cztery najnowsze operacje. Skróty prowadzą do formularza i historii. Na komputerze główne sekcje są dostępne z boku, a na telefonie z dolnego paska. | [PR #136](https://github.com/WielechJW/finance-next-nest/pull/136) |
| Historia splitów | Filtr instrumentu pokazuje split razem z jego proporcją. Jeśli na rachunku zapisano już split ręcznie, próba potwierdzenia propozycji dostawcy chroni przed powtórnym przeliczeniem liczby akcji. | [PR #137](https://github.com/WielechJW/finance-next-nest/pull/137) |

**Weryfikacja zmian objęła 988 testów.** Przeszły 302 testy frontendu, 165 testów jednostkowych backendu, 15 testów HTTP, 439 testów integracyjnych, 54 scenariusze w Chromium i 13 testów skryptów dostawcy na danych syntetycznych. Scenariusz portfela sprawdza m.in. szerokości 320, 390 i 1440 px oraz przejście bezpośrednio do historii.

**Do odbioru na środowisku docelowym** pozostają rzeczywista dostawa na telefon i sprawdzenie usług produkcyjnych. Przed wersją C pozostaje pełna weryfikacja zakresu i warunków korzystania z danych dostawcy. [Odbiór wdrożenia #74](https://github.com/WielechJW/finance-next-nest/issues/74) · [Weryfikacja dostawcy #45](https://github.com/WielechJW/finance-next-nest/issues/45)

## Audyt przed naprawami

Poniższe obserwacje, zalecenia i wyniki testów dotyczą stanu projektu z commita `2743746`.

**Przed odbiorem wersji B naprawiłbym cztery problemy.** Aplikacja może pokazać pozorną stratę po splicie, zaksięgować dwukrotnie jeden ponowiony wydatek, zablokować pierwszą transakcję po wdrożeniu i wstrzymać przekazywanie zadań wszystkich użytkowników do kolejki. Odtworzyłem te przypadki na lokalnym PostgreSQL 18. Jednocześnie wszystkie **981 testów** z uruchomionych zestawów przeszły.

## Co już działa

Finanse osobiste obejmują rejestrację i sesje, portfel, przychody i wydatki, historię oraz analitykę. W części inwestycyjnej działają ręczne prowadzenie rachunków GPW i USA, rozliczanie kosztu akcji metodą FIFO i korekty z historią zmian. W repozytorium są także wycena w PLN, notowania dzienne, watchlisty, alerty i integracja z Telegramem. Testy objęły API, bazę danych oraz obsługę tych funkcji w Chromium. [Weryfikacja finansów osobistych](analytics-verification.md) · [Weryfikacja ręcznego portfela](investment-verification.md) · [Zakres wersji B](investment-roadmap.md#etap-7-telefon-i-wdrożenie-działające-przez-całą-dobę--wersja-b)

**Otwarte pozostają dwa odbiory.** Zadanie #74 wymaga m.in. sprawdzenia doręczenia alertu na prawdziwy telefon przy zamkniętej stronie. W zadaniu #45 projekt ma potwierdzenie katalogów i cen pięciu spółek z każdego rynku. Pozostają zdarzenia dla pełnej próbki, dłuższa historia, fundamenty oraz warunki wykorzystania danych w docelowym zastosowaniu. Podstawą tej oceny są statusy GitHub i zapisane wyniki wcześniejszych prób dostawcy. [Wdrożenie #74](https://github.com/WielechJW/finance-next-nest/issues/74) · [Dostawca #45](https://github.com/WielechJW/finance-next-nest/issues/45) · [Wyniki próby danych](market-data-verification.md)

## Cztery błędy o wysokim priorytecie

### 1. Znany split może dać pozorną stratę i kompletną wycenę

Portfel miał jedną akcję kupioną za 100 zł. Dla następnej sesji zapisałem split 2:1 i surową cenę zamknięcia 50 zł. Aplikacja pokazywała już propozycję potwierdzenia splitu, a jednocześnie wycenę **50 zł**, wynik **−50 zł**, stopę zwrotu TWR **−50%** i `complete: true`. Po potwierdzeniu wartość wyniosła 100 zł, a wynik i TWR wróciły do zera. Wycena mnoży ilość z księgi przez nową cenę bez sprawdzenia oczekujących splitów. [Obliczanie wartości](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/portfolio-analytics/valuation.service.ts#L57) · [Historia zwrotu](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/portfolio-analytics/valuation.service.ts#L138) · [Propozycje zdarzeń](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/portfolio-analytics/corporate-actions.service.ts#L15)

Do czasu uzgodnienia splitu dotyczącego posiadanej pozycji wycena i historia powinny wskazywać przyczynę niepełnego wyniku. Test odbioru powinien objąć również snapshot i podsumowanie Telegrama. Po potwierdzeniu przez użytkownika oczekiwany wynik scenariusza to dwie akcje po 50 zł i TWR 0%.

### 2. Ponowienie zapisu może podwoić wydatek w portfelu osobistym

Jeśli baza zapisała wydatek, a odpowiedź zaginęła, formularz zachowuje dane i pozwala zapisać je ponownie. W próbie HTTP dwa identyczne żądania `POST /transactions` po 25 zł dostały dwa razy `201` i różne identyfikatory. Historia miała dwa wpisy, a saldo nowego portfela wyniosło **−50 zł**. Blokada przycisku działa tylko podczas trwania pojedynczego żądania. [Zapis w API](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/transactions/transactions.service.ts#L122) · [Wysłanie formularza](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/frontend/src/components/transaction-form.tsx#L190) · [Obsługa błędu i odblokowanie](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/frontend/src/components/transaction-form.tsx#L221)

Jedna operacja użytkownika powinna mieć trwały klucz ponowienia, sprawdzany w bazie w obrębie portfela. Test powinien zgubić odpowiedź po zatwierdzeniu pierwszego zapisu i po ponowieniu wykazać jeden wpis oraz saldo −25 zł. Dwa osobno zlecone zakupy po 25 zł powinny nadal tworzyć dwa wpisy.

### 3. Świeże wdrożenie nie inicjalizuje kategorii i katalogu ręcznego

Kontener produkcyjny wykonuje `prisma migrate deploy`. Po zastosowaniu wszystkich 18 migracji na pustej bazie odczytałem **0 kategorii i 0 instrumentów**. Próba zapisu wydatku zakończyła się błędem 400. Po uruchomieniu funkcji inicjalizujących z repozytorium baza zawierała 6 kategorii i 10 instrumentów, a ten sam wydatek zapisał się poprawnie. Playwright przygotowuje kategorie samodzielnie, a test kontenerów sprawdza gotowość usług i haszowanie hasła. [Polecenie kontenera](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/Dockerfile#L11) · [Dane startowe](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/prisma/seed.mjs#L10) · [Start testów przeglądarkowych](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/test/browser/start-backend.mjs#L32) · [Test kontenerów](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/deploy/test-containers.sh#L45)

W procedurze wdrożenia należy wykonać powtarzalną inicjalizację po migracjach, przed przyjęciem ruchu. Test odbioru powinien wystartować na pustym wolumenie, zarejestrować użytkownika, zapisać pierwszy wydatek i potwierdzić zachowanie identyfikatorów kategorii po kolejnym uruchomieniu.

### 4. Błąd jednego rachunku lub kalendarza blokuje kolejkę wszystkich użytkowników

W próbie wystarczył jeden aktywny rachunek z wpisem `MIGRATED_UNVERIFIED`, oznaczeniem nadawanym przez istniejącą migrację. Harmonogram przerwał cały przebieg i nie odświeżył znacznika działania workera. Ta sama zależność ujawniła się dla **4 stycznia 2027 r.** Kalendarz GPW obejmuje tylko 2026 r., a każdy przebieg zaczyna się od sprawdzenia GPW. W obu przypadkach wyjątek występuje przed `runtime.dispatch()`, więc oczekujące w PostgreSQL zadania, również powiadomienia innych osób, nie trafiają w tym przebiegu do Redis. [Migracja kolejności](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/prisma/migrations/20261116170000_investment_precision_and_order/migration.sql#L25) · [Harmonogram](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/jobs/scheduler.service.ts#L11) · [Przekazanie zadań](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/worker.ts#L114) · [Kalendarze](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/market-data/calendar.ts#L6)

Przekazywanie gotowych zadań do kolejki powinno działać niezależnie od tworzenia nowych. Błąd rachunku lub rynku powinien wskazywać operatorowi konkretną przyczynę. Kryteria odbioru to wykonanie zadania drugiego użytkownika mimo błędu pierwszego oraz test przejścia grudzień–styczeń z uzupełnionym kalendarzem GPW.

## Pozostałe potwierdzone błędy

| Problem | Wynik próby | Jak sprawdzić naprawę |
| --- | --- | --- |
| Wznowiony alert pomija pierwsze przekroczenie | Przy świeżej cenie 90 zł wyłączyłem i włączyłem regułę z progiem 100 zł. Po zamknięciu na 110 zł identyczna reguła kontrolna zapisała jedno zdarzenie, wznowiona zapisała zero. | Przy wznowieniu zapisać świeżą cenę jako stan początkowy. Kolejna sesja przekraczająca próg ma utworzyć dokładnie jedno zdarzenie. [Aktualizacja reguły](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/alerts/alerts.service.ts#L27) · [Reguła pierwszej obserwacji](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/alerts/transition.ts#L9) |
| Formularz kupna i sprzedaży pomija część katalogu | Przy 1012 instrumentach formularz otrzymał pierwsze 1000. CDR był dostępny w wyszukiwarce rynkowej, lecz brakowało go na liście wyboru rachunku. | Podłączyć formularz do istniejącego wyszukiwania z paginacją. Zapisać zakup instrumentu spoza pierwszego 1000. [Limit API](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/investments/events.service.ts#L121) · [Selektor formularza](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/frontend/src/components/investments/investment-form.tsx#L305) · [Wyszukiwanie](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/market-data/instruments.controller.ts#L23) |
| Archiwizacja rachunku może zatrzymać aktualizację wyceny | Dwie akcje na zarchiwizowanym rachunku nadal wchodziły do wyceny. Gdy instrument był posiadany wyłącznie tam i nie miał watchlisty ani alertu, na kolejną sesję powstało zero zadań ceny, a pozycja otrzymała stan `stale`. | Uwzględnić otwarte pozycje archiwalnych rachunków w harmonogramie. Sprawdzić odświeżenie ceny następnej sesji. [Wybór rachunków do synchronizacji](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/jobs/scheduler.service.ts#L15) · [Wybór rachunków do wyceny](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/portfolio-analytics/valuation.service.ts#L22) |
| Historia instrumentu ukrywa zaksięgowany split | Lista zdarzeń pokazała jeden split. Dodanie filtra tego samego instrumentu dało zero. W odpowiedzi bez filtra brakowało także proporcji splitu. | Uwzględnić relację `split` w filtrze i odpowiedzi. Po splicie 2:1 historia instrumentu powinna zwrócić zdarzenie, identyfikator akcji i proporcję. [Filtr](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/investments/events.service.ts#L87) · [Odpowiedź API](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/backend/src/investments/events.service.ts#L21) |

## Kolejność dalszych prac

1. **Poprawić poprawność kwot i pierwszego uruchomienia.** Przenieść do testów regresyjnych trzy odtworzone przypadki obejmujące split, ponowienie wydatku i pustą bazę. Do testu wdrożeniowego dodać pierwszą rzeczywistą operację użytkownika.
2. **Ustabilizować wersję B przed odbiorem całodobowym.** Uniezależnić wysyłkę oczekujących zadań od planowania, uzupełnić kalendarz GPW przed 1 stycznia 2027 r. i naprawić wznowienie alertu. Uzupełnić wybór instrumentów, wycenę archiwalnych rachunków oraz historię splitów. Zaktualizować statusy etapów 4–7 w roadmapie. Przykładowo lokalna lista nadal ma puste pola przy 7.1, 7.2 i 7.4, podczas gdy odpowiadające zadania na GitHubie są zamknięte. [Roadmapa](investment-roadmap.md) · [Połączenie Telegrama #72](https://github.com/WielechJW/finance-next-nest/issues/72) · [Dostarczanie #73](https://github.com/WielechJW/finance-next-nest/issues/73) · [Monitoring #75](https://github.com/WielechJW/finance-next-nest/issues/75)
3. **Odebrać #74 na docelowym środowisku.** Sprawdzić HTTPS i sesję po odświeżeniu, restart workera z oczekującym zadaniem, odtworzenie kopii i dostarczenie alertu na prawdziwy telefon przy zamkniętej stronie. Zapisać wynik odbioru w zadaniu. [Kryteria #74](https://github.com/WielechJW/finance-next-nest/issues/74) · [Instrukcja wdrożenia](deployment-runbook.md)
4. **Przed wersją C domknąć próbę danych #45.** Potwierdzić pokrycie i uprawnienia dla planowanego użycia. Następne zaplanowane funkcje to wersjonowane raporty spółek i dane fundamentalne w etapie 8, a potem import, uzgodnienie i eksport historii w etapie 9. [Dane #45](https://github.com/WielechJW/finance-next-nest/issues/45) · [Raporty spółek #76](https://github.com/WielechJW/finance-next-nest/issues/76) · [Import CSV #80](https://github.com/WielechJW/finance-next-nest/issues/80)

## Zakres weryfikacji

| Kontrola lokalna | Wynik |
| --- | --- |
| Frontend, testy komponentów i bibliotek | 302/302 |
| Backend, testy jednostkowe | 163/163 |
| Backend, testy HTTP | 15/15 |
| Integracja PostgreSQL i Redis | 435/435 |
| Playwright w Chromium | 53/53 |
| Skrypty sprawdzające dostawcę na danych syntetycznych | 13/13 |
| Lint, TypeScript i kompilacja obu aplikacji | Przeszły, również kontrola typów Playwrighta. Lint backendu zgłosił jedno ostrzeżenie dotyczące sortowania w teście. |
| Wdrożenie i odzyskiwanie | Poprawna konfiguracja Compose i składnia skryptów. Przeszły test lokalnych obrazów oraz próba odtworzenia kopii z kontrolą dokładnej wartości dziesiętnej. |

Użyłem Node.js 24.14.1, tymczasowego PostgreSQL 18, Redis 8 i osobnych baz dla poszczególnych prób. Dodatkowe scenariusze błędów opisane wyżej wykonano na danych syntetycznych. Odbiór produkcyjnych domen, rzeczywistej wysyłki Telegram i pełnego zakresu danych EODHD wymaga sprawdzenia w docelowym środowisku. Na GitHubie pięć zadań CI ostatniego scalonego PR #132 również zakończyło się sukcesem. [Wynik CI](https://github.com/WielechJW/finance-next-nest/actions/runs/44318746074) · [Próba odzyskiwania](https://github.com/WielechJW/finance-next-nest/blob/2743746add3d8f14ce25b58b5bc16bec48edda06/deploy/test-backup-restore.sh)
