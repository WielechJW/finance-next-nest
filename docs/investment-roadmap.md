# Plan rozwoju platformy inwestycyjnej — GPW i USA

Data opracowania: 13 listopada 2026 r. Status: plan do realizacji.

Cel: rozwinąć obecną aplikację w narzędzie do prowadzenia portfela akcji,
analizy spółek, obserwowania rynku, otrzymywania powiadomień na telefon,
testowania strategii oraz docelowo wykonywania zleceń przez bota.

Poniższe modele, moduły i endpointy są propozycją implementacji. Checkboxy
oznaczają przyszłe zadania. Kolejność jest przeznaczona do pracy etapami;
każde zadanie z identyfikatorem można przenieść do osobnego issue.

## 1. Punkt wyjścia i zakres

Projekt ma już Next.js, NestJS, PostgreSQL, Prisma, sesje, portfel finansowy,
transakcje przychodów i wydatków, analitykę oraz testy komponentowe,
jednostkowe, HTTP, integracyjne i przeglądarkowe.

Miejsca rozszerzenia istniejącego kodu:

| Plik lub katalog | Planowana rola |
| --- | --- |
| `backend/prisma/schema.prisma` | Modele inwestycji i kolejne migracje. |
| `backend/src/app.module.ts` | Rejestracja nowych modułów. |
| `backend/src/auth/`, `backend/src/sessions/` | Wspólna tożsamość i autoryzacja. |
| `backend/src/config/` | Walidacja konfiguracji dostawców, kolejki i powiadomień. |
| `frontend/src/components/dashboard-nav.tsx` | Nawigacja do portfela inwestycyjnego, spółek i alertów. |
| `frontend/src/lib/api-client.ts` | Wspólna komunikacja z API i obsługa sesji. |
| `backend/test/`, `backend/test/browser/` | Testy nowych przepływów i regresji. |
| `compose.yaml` | Lokalna infrastruktura PostgreSQL i, od etapu 4, Redis. |

Założenia pierwszych wersji:

- Akcje GPW i USA, pozycje długie, środki własne, waluty PLN i USD.
- Jedna waluta prezentacji całego portfela: PLN; szczegóły także w walucie instrumentu.
- Wiele rachunków inwestycyjnych, np. u różnych brokerów, w jednym portfelu.
- Najpierw notowania dzienne po zamknięciu sesji; dane w trakcie sesji są rozszerzeniem.
- Ręczne zapisy operacji poprzedzają import historii i integrację z brokerem.
- Telegram jest pierwszym kanałem powiadomień na telefon.
- Wyniki i wskaźniki służą analizie; reguły strategii mają jawne parametry i uzasadnienie.
- ETF-y, opcje, shorty, dźwignia, podatkowe deklaracje i aplikacja natywna
  trafiają do późniejszych rozszerzeń po zakończeniu podstawowej ścieżki.

Obecny portfel finansowy pozostaje odrębną domeną. Operacje inwestycyjne
otrzymują własny rejestr: zakup akcji zamienia gotówkę na instrument,
sprzedaż zmienia pozycję i gotówkę, a zmiana kursu wpływa na wycenę.
Ewentualne połączenie obu domen wymaga wspólnego identyfikatora transferu,
aby nie policzyć tych samych środków dwukrotnie.

## 2. Kolejność i wersje aplikacji

| Etap | Rezultat | Wymagany wcześniejszy etap |
| --- | --- | --- |
| 0 | Decyzje projektowe, próbka danych i automatyczna weryfikacja | Obecne MVP |
| 1 | Model portfela i rejestr operacji | 0 |
| 2 | Obliczanie gotówki, pozycji i kosztu zakupu | 1 |
| 3 | API i interfejs ręcznego portfela | 2 |
| 4 | Pobieranie notowań, walut i zdarzeń korporacyjnych | 3 |
| 5 | Wycena i wyniki portfela | 4 |
| 6 | Watchlista i silnik alertów | 5 |
| 7 | Telegram i działanie na serwerze przez całą dobę | 6 |
| 8 | Analiza fundamentalna i porównywanie spółek | 7 |
| 9 | Import i eksport historii rachunku | 8 |
| 10 | Strategie i bot generujący sygnały | 9 |
| 11 | Testy historyczne strategii | 10 |
| 12 | Zlecenia na rachunku symulowanym | 11 |
| 13 | Integracja rzeczywistego rachunku i zlecenia zatwierdzane przez użytkownika | 12 |
| 14 | Automatyczne wykonywanie strategii | 13 |

Są to zależności przyjęte dla kolejności realizacji. Nie każda jest
zależnością techniczną: przykładowo analiza spółek może działać bez Telegrama,
a import historii bez analizy fundamentalnej.

Kamienie milowe:

- **Wersja A, po etapie 3:** ręczne prowadzenie portfela GPW i USA.
- **Wersja B, po etapie 7:** wycena po sesji, watchlista i alerty na telefon.
- **Wersja C, po etapie 9:** analiza spółek i import rzeczywistej historii.
- **Wersja D, po etapie 12:** strategie, backtesty i handel symulowany.
- **Wersja E, po etapie 14:** kontrolowana automatyzacja rzeczywistych zleceń.

## 3. Zasady wspólne dla implementacji

1. Kwoty, ceny, kursy i ilości przechodzą przez API jako stringi dziesiętne.
   Obliczenia finansowe korzystają z Decimal. Konwersja do `Number` służy
   wyłącznie geometrii wykresów, zgodnie z obecnym podejściem w analityce.
2. Portfele, rachunki, operacje, notatki, strategie i alerty mają właściciela.
   Odczyt i zapis zawsze sprawdzają właściciela, również w zadaniach tła.
3. Operacja wykonana, zlecenie oczekujące i sygnał strategii to różne obiekty.
   Dopiero potwierdzone wykonanie zlecenia tworzy operację w rejestrze.
4. Rejestr operacji jest źródłem prawdy dla pozycji i gotówki. Cache oraz
   snapshoty można odtworzyć. Korekty operacji zachowują historię zmian.
5. Dostawcy danych i brokerzy mają adaptery. Wewnętrzny identyfikator instrumentu
   jest niezależny od symbolu używanego przez konkretnego dostawcę.
6. Każde notowanie ma datę sesji, czas pomiaru lub publikacji, źródło,
   czas pobrania i informację o rodzaju danych: dzienne, opóźnione lub bieżące.
   Brakująca cena oznacza niepełną wycenę; nie jest zastępowana zerem.
7. Ponowienia zadań i żądań mają trwałe klucze idempotencji, czyli ponowienie
   tego samego zapisu nie tworzy kolejnej operacji biznesowej.
8. Warstwa inwestycyjna rozdziela środowiska śledzenia portfela, symulacji
   i rzeczywistych zleceń, łącznie z rachunkami, kluczami i historią.

## Etap 0. Decyzje, próbka danych i CI

**Cel:** potwierdzić dostępność danych i ustalić reguły, które wpływają na model.

- [ ] **0.1. Opisać decyzje w `docs/investment-decisions.md`.** Przyjąć zakres
  powyżej, koszt pozycji metodą FIFO na potrzeby analityki aplikacji, strefy
  `Europe/Warsaw` i `America/New_York` oraz sposób zaokrąglania. Przyjąć,
  że daty wykonanych operacji są historyczne lub bieżące, a plany są osobnymi obiektami.
- [ ] **0.2. Przeprowadzić próbę dostawcy danych.** Sprawdzić po pięć instrumentów
  GPW i USA: identyfikację, walutę, notowania dzienne, splity, dywidendy i
  dostępność fundamentów. Zapisać braki, limity, wymagany plan, koszty i warunki
  przechowywania oraz prezentowania danych. EODHD jest kandydatem do porównania.
- [ ] **0.3. Przygotować macierz możliwości brokerów.** Zapisać, który kandydat
  udostępnia API, rachunek testowy, wymagane instrumenty GPW/USA, typy zleceń,
  historię wykonań i autoryzację. Wybrać dostawcę danych do MVP; broker do
  rzeczywistych zleceń zostanie potwierdzony przed etapem 12.
- [ ] **0.4. Dodać CI.** Lint, typy, testy jednostkowe, HTTP i build obu aplikacji;
  osobny job PostgreSQL dla testów integracyjnych oraz Playwrighta. Zachować
  istniejące zabezpieczenia osobnych baz testowych. Przy dodaniu Redis rozszerzyć CI.

**Ukończenie:** istnieje zapis decyzji i próbka danych dla obu rynków,
braki danych mają określony sposób obsługi, a dotychczasowe funkcje przechodzą CI.
Próby dostawcy korzystają z jawnie skonfigurowanego klucza; fixture testowe
zawierają wyłącznie dane dopuszczone do takiego wykorzystania.

## Etap 1. Modele inwestycji i migracje

**Cel:** zapisać historię rachunku w sposób pozwalający odtworzyć jego stan.

- [ ] **1.1. Dodać `Portfolio`, `InvestmentAccount` i `Instrument`.** Portfel należy
  do użytkownika; rachunek do portfela. Instrument ma wewnętrzne ID, ticker,
  rynek lub MIC, walutę i opcjonalny ISIN. `InstrumentProviderMapping` przechowuje
  symbole dostawców; zmiana tickera zachowuje tożsamość instrumentu i historię.
- [ ] **1.2. Dodać `InvestmentEvent` oraz powiązane `Trade`, `CashEntry`
  i `SecurityEntry`.** Nagłówek opisuje zdarzenie; wpisy gotówkowe i ilościowe
  opisują jego wpływ. Typy: wpłata, wypłata, zakup, sprzedaż, dywidenda,
  opłata, wymiana walut, split oraz korekta. Podatek potrącony od dywidendy
  można zapisać jako składnik rzeczywistej operacji.
- [ ] **1.3. Ustalić precyzję i ograniczenia.** Proponowane pola:
  ilość i cena `Decimal(28,10)`, kwoty i kursy `Decimal(28,8)`, z osobną
  regułą zaokrąglania rozliczanej gotówki. Przechować czas wykonania,
  datę rozrachunku, czas zapisu i jednoznaczną kolejność zdarzeń.
- [ ] **1.4. Dodać indeksy, audyt i klucze idempotencji.** Unikalność operacji
  zewnętrznej w zakresie rachunku i źródła; ograniczenia dodatnich ilości
  i cen w transakcjach; powiązanie korekty z oryginałem. Migracja i seed
  katalogu testowego są powtarzalne.

**Ukończenie:** migracje działają na pustej bazie i na bazie z dotychczasowym MVP.
Testy PostgreSQL sprawdzają relacje właścicieli, precyzję, duplikaty i atomowość
zapisów składających się z kilku wpisów. Dane obecnych portfeli zachowują poprawność.

## Etap 2. Silnik gotówki, pozycji i wyniku ze sprzedaży

**Cel:** otrzymywać poprawny stan rachunku z historii operacji.

- [ ] **2.1. Zaimplementować zapis zdarzeń.** Zakup zmniejsza gotówkę o wartość
  akcji i prowizję oraz zwiększa ilość; sprzedaż wykonuje operację odwrotną.
  Dywidenda i opłata zmieniają gotówkę. Wymiana walut zapisuje obie strony
  atomowo oraz rzeczywisty kurs i opłaty. Zakup instrumentu w USD wymaga gotówki w USD.
- [ ] **2.2. Wyliczać pozycje i koszt FIFO.** Częściowa sprzedaż konsumuje partie
  zakupu i proporcjonalne prowizje. Liczyć wynik zrealizowany w walucie instrumentu.
  Stan początkowy istniejącego portfela można wprowadzić jako jawne partie
  otwarcia z kosztem i datą odniesienia.
- [ ] **2.3. Obsłużyć współbieżność i korekty.** Zapisy blokują właściwy rachunek
  w transakcji bazodanowej. Dwie równoczesne sprzedaże nie mogą zużyć tych samych
  akcji. Wprowadzenie operacji historycznej albo korekty przelicza kolejne stany
  i odrzuca historię powodującą niedozwoloną ujemną pozycję lub gotówkę.
- [ ] **2.4. Dodać wspólny scenariusz obliczeniowy.** Przykład: wpłata 1000 PLN,
  zakup 10 akcji po 50 PLN z prowizją 5 PLN, sprzedaż 4 po 60 PLN z prowizją
  2 PLN. Wynik: gotówka 733 PLN, 6 akcji, pozostały koszt 303 PLN,
  zrealizowany zysk 36 PLN.

**Ukończenie:** testy sprawdzają przykład powyżej, wiele partii FIFO, ułamkowe
ilości, dwie waluty, pełne zamknięcie pozycji, równoczesne sprzedaże i korektę
historii. Dla pierwszej wersji aplikacja pokazuje gotówkę według wykonanych
operacji; limit środków dostępnych do zleceń będzie później pochodził od brokera.

## Etap 3. API i interfejs ręcznego portfela — wersja A

**Cel:** użytkownik może prowadzić własny portfel bez zewnętrznej integracji.

- [ ] **3.1. Udostępnić API portfeli i rachunków.** Tworzenie, lista, szczegóły,
  zmiana nazwy i archiwizacja; rachunek z historią zachowuje rejestr operacji.
  Sprawdzanie właściciela dotyczy całej ścieżki portfel → rachunek → zdarzenie.
- [ ] **3.2. Udostępnić API operacji.** Dodawanie zdarzeń, historia z filtrami
  i paginacją, szczegóły oraz korekta. Walidacja kwot, walut, dat i zgodności
  instrumentu z rachunkiem; idempotencja zapisu również po błędzie sieci.
- [ ] **3.3. Zbudować strony `/dashboard/investments`.** Lista rachunków, gotówka
  według walut, posiadane akcje z kosztem zakupu, historia i formularze operacji.
  Komponenty inwestycyjne mają własne formatowanie ilości i cen.
- [ ] **3.4. Dodać obsługę błędów i nawigację.** Stany ładowania, puste portfele,
  retry odczytu, wygaśnięcie sesji i walidacja pól; układ mobilny i klawiatura.

**Ukończenie:** Playwright przechodzi rejestrację → utworzenie rachunku → wpłatę
→ zakup → częściową sprzedaż → odświeżenie → korektę. Drugie konto nie odczytuje
ani nie modyfikuje danych pierwszego. Widok prezentuje koszt i ilości;
wycena rynkowa pojawia się w etapie 5.

## Etap 4. Dane rynkowe, waluty i zadania w tle

**Cel:** zbudować wspólne źródło danych dla wyceny, analiz i alertów.

- [ ] **4.1. Dodać adapter dostawcy i katalog instrumentów.** Import katalogu
  GPW/USA, wyszukiwarka, mapowanie symboli oraz walidacja odpowiedzi.
  Klucze i limity dostawcy obsługuje backend. Na początek synchronizować
  instrumenty posiadane i obserwowane, aby kontrolować zużycie API.
- [ ] **4.2. Dodać `PriceBar`, `FxRate` i `CorporateAction`.** Zapisywać surowe
  OHLCV, osobno wartości skorygowane i ich znaczenie, źródło, wersję oraz
  daty publikacji/pobrania. NBP jest kandydatem do dziennych kursów referencyjnych;
  faktyczna wymiana walut korzysta z kursu zapisanej operacji.
- [ ] **4.3. Uruchomić worker NestJS i BullMQ z Redis.** Osobny entrypoint
  workera, harmonogramy, retry z opóźnieniem, limity, timeouty, trwały rejestr
  uruchomień i blokada równoległej synchronizacji tego samego zakresu.
  Zadania biznesowe mają trwałe identyfikatory w PostgreSQL; outbox pozwala
  ponownie zasilić kolejkę po awarii. Dodać Redis do Compose i odpowiednich testów CI.
- [ ] **4.4. Obsłużyć sesje i jakość danych.** Kalendarze obu giełd, święta,
  skrócone sesje i niezależne zmiany czasu. Przeprowadzać synchronizację
  po oczekiwanym udostępnieniu danych; później sprawdzać korekty i luki.
  Opisać retencję wersji danych oraz warunki oznaczania ceny jako nieaktualnej.

**Ukończenie:** worker zapisuje dane dla obu rynków; ponowne uruchomienie
nie mnoży rekordów. Testy pokrywają weekend, święto, rozbieżne zmiany czasu,
brak notowania, limit API, timeout, restart workera i korektę danych dostawcy.
Zamknięta sesja sama w sobie nie oznacza awarii danych.

## Etap 5. Wycena i analityka portfela

**Cel:** pokazać wartość portfela i wynik z rozdzieleniem wpłat oraz wypłat.

- [ ] **5.1. Wyliczać wycenę.** Liczba akcji × surowa cena rynkowa, gotówka
  w każdej walucie, suma w PLN według określonego kursu referencyjnego.
  Każdy wynik wskazuje datę ceny i waluty; suma ma status kompletności.
- [ ] **5.2. Obsłużyć zdarzenia korporacyjne.** Split zmienia ilość i cenę
  jednostkową kosztu, zachowując łączny koszt; dywidenda ma osobno zdarzenie
  rynkowe i rzeczywistą wypłatę na rachunek. Propozycja wypłaty wymaga
  potwierdzenia albo uzgodnienia z brokerem/importem. Rewizja zdarzenia zachowuje audyt.
- [ ] **5.3. Dodać wynik i alokację.** Zysk zrealizowany, niezrealizowany,
  dywidendy, opłaty, udział spółek, rynków i walut. Określić metodę wyceny
  przepływów w PLN; wzrost salda po wpłacie jest przepływem zewnętrznym.
- [ ] **5.4. Dodać historyczne snapshoty i stopy zwrotu.** Najpierw kwotowy
  wynik po uwzględnieniu wpłat i wypłat. Następnie TWR z wyceną na granicach
  przepływów i jawną konwencją dla danych dziennych. Przy brakujących wycenach
  prezentować lukę. Porównanie z benchmarkiem używa zgodnej waluty i zasad dywidend.

**Ukończenie:** zakup i sama wpłata nie tworzą sztucznego zysku; split nie zmienia
łącznego kosztu; dywidenda nie jest liczona drugi raz przez skorygowaną cenę.
Przykład z etapu 2 przy kursie 70 PLN daje wycenę akcji 420 PLN,
zysk niezrealizowany 117 PLN, wartość rachunku 1153 PLN i łączny wynik 153 PLN.
Testować też ruch USD/PLN przy niezmienionej cenie akcji, brak FX i korektę historii.

## Etap 6. Watchlista i silnik alertów

**Cel:** użytkownik definiuje warunki obserwacji wybranych instrumentów.

- [ ] **6.1. Dodać watchlisty.** Dodawanie/usuwanie instrumentów GPW i USA,
  ostatnia cena, waluta, data aktualizacji i przejście do szczegółów spółki.
- [ ] **6.2. Dodać `AlertRule` i `AlertEvent`.** Pierwszy typ: przekroczenie
  ceny w górę lub w dół. Reguła ma próg, walutę, częstotliwość, stan aktywności
  i tryb jednorazowy albo ponowne uzbrojenie po powrocie ceny na drugą stronę.
- [ ] **6.3. Zaimplementować ewaluację po aktualizacji danych.** Porównywać
  kolejne prawidłowe obserwacje; zdefiniować zachowanie pierwszego pomiaru,
  cooldown i reakcję na korektę notowania. Odrzucać dane niespełniające
  wymagań świeżości. Zapis zdarzenia i outbox jest jedną transakcją.
- [ ] **6.4. Dodać panel i historię alertów.** Formularz progu, włączenie,
  wyłączenie, usunięcie reguły oraz podgląd, kiedy i na jakich danych zadziałała.
  Po podstawowej regule dodać zmianę procentową między zamknięciami sesji.

**Ukończenie:** jedno przekroczenie tworzy jedno logiczne zdarzenie również
przy równoczesnych workerach i ponowieniu zadania. Testy obejmują dotknięcie
progu, wielokrotne odczyty, ponowne uzbrojenie, pierwszą obserwację i nieaktualne dane.
Alerty dzienne są opisane jako sprawdzane po aktualizacji ceny zamknięcia.

## Etap 7. Telefon i wdrożenie działające przez całą dobę — wersja B

**Cel:** otrzymywać powiadomienia również po zamknięciu przeglądarki.

- [ ] **7.1. Połączyć konto z Telegramem.** Użytkownik inicjuje połączenie,
  otrzymuje krótko ważny jednorazowy kod i potwierdza go w prywatnej rozmowie
  z botem. Backend wiąże zweryfikowane `chat_id` z kontem. Obsłużyć odłączenie
  oraz uwierzytelnienie webhooka. Token bota jest sekretem serwera.
- [ ] **7.2. Zaimplementować `Notification` i dostarczanie.** Wiadomość zawiera
  instrument, cenę, próg, czas i link do aplikacji. Zapisywać próby, odpowiedzi,
  retry oraz stany `pending/sent/failed/unknown`; zapewnić limity i ciszę nocną
  z jawną regułą dla opóźnionych alertów. Dodać opcjonalne podsumowanie sesji.
- [ ] **7.3. Przygotować wdrożenie.** Frontend, API, worker, PostgreSQL i Redis;
  HTTPS, sesje i CORS dla rzeczywistych domen, migracje przed startem,
  restart procesów, health/readiness, backup i przetestowane odtworzenie.
  Utrwalać Redis oraz zapewnić możliwość odbudowy zadań z rejestru w PostgreSQL.
- [ ] **7.4. Dodać obserwowalność.** Opóźnienie aktualizacji cen, kolejka,
  błędy dostawcy, ostatnie poprawne wykonanie workera i skuteczność wysyłki.
  Udostępnić kontrolowane ponowienie błędnego zadania i instrukcję obsługi awarii.

**Ukończenie:** próba akceptacyjna wysyła alert na połączony telefon przy
zamkniętej stronie. Restart workera zachowuje historię i niedokończone zadania;
odłączenie Telegrama zatrzymuje kolejne wysyłki. Testy automatyczne używają
adaptera testowego. Rzeczywista próba wysyłki jest jawnie inicjowana przez użytkownika.

Idempotencja dotyczy zdarzenia i prób dostarczenia. Timeout po stronie Telegrama
może pozostawić nieznany wynik wysyłki; plan nie zakłada gwarancji dokładnie
jednego fizycznego doręczenia. Stan `unknown` ma ustaloną politykę obsługi.

## Etap 8. Analiza fundamentalna i porównywanie spółek

**Cel:** połączyć notowania z raportami i własnym procesem analizy.

- [ ] **8.1. Dodać `Company`, `FinancialReport` i `FundamentalFact`.** Powiązać
  emitenta z instrumentami. Zapisywać okres, walutę raportową, jednostkę,
  czas publikacji, źródło, wersję i korekty raportu. Dla USA ocenić SEC EDGAR;
  dla GPW wykorzystać zweryfikowanego dostawcę i odnośniki do raportów emitenta.
- [ ] **8.2. Zbudować kartę spółki.** Wykres, opis działalności, przychody,
  zysk netto, cash flow, zadłużenie i historia dywidend. Oddzielić dane
  kwartalne, roczne oraz TTM; zapewnić przejście do dokumentu źródłowego.
- [ ] **8.3. Wyliczać jawnie zdefiniowane wskaźniki.** C/Z, C/WK, ROE,
  marże i dynamika wyników. Sprawdzić zgodność okresów, jednostek i walut;
  nieadekwatny lub brakujący mianownik daje opisany brak wskaźnika.
- [ ] **8.4. Dodać notatki i porównanie.** Prywatna teza inwestycyjna, ryzyka,
  warunki ponownej analizy i zestawienie kilku spółek. Potem prosty screener
  z filtrami wskaźników; brak danych jest osobnym stanem filtra.

**Ukończenie:** karta działa dla spółek z obu rynków i pokazuje pochodzenie danych.
Testy obejmują ujemny zysk, różne waluty notowań i raportów, brak kwartału,
korektę raportu oraz różne końce roku obrotowego. Wskaźniki dla konkretnych
fixture można ręcznie odtworzyć z danych źródłowych.

## Etap 9. Import i eksport historii — wersja C

**Cel:** przenieść istniejący portfel do aplikacji i uzgodnić go z rachunkiem.

- [ ] **9.1. Dodać import CSV.** Wybrać jeden rzeczywiście używany format
  brokera i ogólny szablon. `ImportBatch` przechowuje status, autora i wiersze;
  parser obsługuje separator, kodowanie, strefę czasu, daty, waluty i liczby.
- [ ] **9.2. Dodać podgląd i mapowanie.** Rozpoznać instrumenty, pokazać błędy,
  propozycje duplikatów, opłaty, FX i dywidendy. Identyczne data/kwota/tytuł
  są przesłanką do sprawdzenia, a nie pewnym dowodem duplikatu.
- [ ] **9.3. Potwierdzać import atomowo.** Stosować identyfikatory zewnętrzne
  i idempotencję partii; zapobiec powieleniu pozycji istniejących ręcznie.
  Niepełna historia wymaga jawnego stanu początkowego z kosztem i datą.
  Uzgodnić saldo gotówki i ilości z dokumentem brokera; raportować różnice.
- [ ] **9.4. Dodać eksport.** Historia operacji, pozycje i wyniki z walutami
  oraz datą wyceny. Zdefiniować bezpieczne kodowanie komórek CSV i retencję
  przesłanych plików; korekta importu zachowuje historię operacji.

**Ukończenie:** ponowny import tego samego pliku nie zmienia wyniku; przerwany
import można bezpiecznie wznowić. Testy pokrywają duplikat, częściową historię,
split, ułamkowe ilości, błędną walutę, format dat i izolację kont.

## Etap 10. Strategie i bot generujący sygnały

**Cel:** uruchamiać powtarzalne reguły na danych rynkowych.

- [ ] **10.1. Zdefiniować interfejs strategii.** Wejście: dane dostępne do chwili
  decyzji, stan portfela i parametry. Wyjście: sygnał z instrumentem,
  uzasadnieniem, czasem, wymaganą świeżością i terminem ważności.
  Rozpocząć od jednej prostej reguły, np. przecięcia średnich dziennych.
- [ ] **10.2. Dodać wersjonowanie.** `Strategy`, `StrategyVersion`, `StrategyRun`
  i `Signal`; zapisywać parametry, wersję kodu i identyfikatory danych wejściowych.
  Zmiana parametrów tworzy nową wersję. Reguła ma ograniczony katalog ustawień.
- [ ] **10.3. Zintegrować harmonogram i alerty.** Uruchomienie po aktualizacji
  kompletnego zestawu danych. Deduplikacja sygnałów i możliwość wysłania ich
  przez istniejący kanał powiadomień. Historia pokazuje również brak sygnału i błędy.
- [ ] **10.4. Dodać panel strategii.** Włączanie, wyłączanie, zakres instrumentów,
  wyniki uruchomień i odtworzenie decyzji na zapisanym wejściu.

**Ukończenie:** identyczne wejście i wersja dają identyczny sygnał; brakujące
lub zbyt stare dane zatrzymują obliczenie. Test potwierdza, że dodanie danych
z przyszłości nie zmienia historycznego sygnału dla wcześniejszej chwili.
Strategie na tym etapie zapisują sygnały i powiadomienia.

## Etap 11. Backtesting, czyli testy historyczne

**Cel:** sprawdzić zachowanie strategii w określonym modelu rynku i kosztów.

- [ ] **11.1. Zbudować odtwarzanie historii.** Ten sam interfejs strategii
  otrzymuje kolejne obserwacje. Sygnał po zamknięciu sesji może być wykonany
  najwcześniej na kolejnej dostępnej sesji. Model jawnie opisuje kolejność
  zdarzeń, ceny wykonania, limity płynności i brak notowania.
- [ ] **11.2. Dodać koszty i zdarzenia.** Prowizje, spread/poślizg, FX, splity,
  dywidendy, dni wolne i dostępność gotówki. Wycena i księgowanie korzystają
  ze wspólnego silnika portfela. Użycie cen skorygowanych ma oddzielną politykę,
  która zapobiega ponownemu naliczeniu dywidend i splitów.
- [ ] **11.3. Dodać ocenę wyników.** Krzywa kapitału, wynik po kosztach,
  obsunięcie, ekspozycja, obrót i liczba transakcji; porównanie z jawnym
  benchmarkiem. Rozdzielić okres doboru parametrów i test poza tym okresem;
  zachować rejestr wszystkich prób, także nieudanych.
- [ ] **11.4. Utrwalać wersje danych.** `BacktestRun` zapisuje zakres, strategię,
  konfigurację wykonania i snapshot wejścia. Uwzględnić wycofane spółki przy
  testowaniu historycznego uniwersum. Strategie fundamentalne wymagają danych
  faktycznie opublikowanych do chwili decyzji, wraz z wersjami raportów.

**Ukończenie:** wynik można odtworzyć; ręczny scenariusz potwierdza prowizje,
split i moment wykonania. Testy wykrywają użycie przyszłej ceny lub raportu.
Uruchomienie bez wymaganej historii kończy się jawnym brakiem danych.
Raport opisuje ograniczenia symulacji; stopa zwrotu nie jest kryterium
poprawności implementacji ani gwarancją przyszłego wyniku.

## Etap 12. Integracja brokera w trybie symulowanym — wersja D

**Cel:** sprawdzić cały cykl zlecenia i odporność integracji.

- [ ] **12.1. Wybrać adapter na podstawie macierzy z etapu 0.** Potwierdzić
  dostępność API i rachunku paper dla użytkownika, rynku, danych i typów zleceń.
  Dla USA kandydatem jest Alpaca Paper. GPW wymaga osobnego potwierdzenia
  możliwości wybranego brokera; lokalny symulator jest wyraźnie oznaczonym
  zastępstwem i nie potwierdza gotowości integracji z brokerem GPW.
- [ ] **12.2. Dodać `BrokerConnection`, `Order`, `OrderEvent` i `Fill`.** Rozdzielić
  intencję, wysłanie, potwierdzenie przyjęcia, częściowe wykonanie, pełne wykonanie,
  odrzucenie i anulowanie. Wykonania tworzą wpisy rejestru dokładnie raz
  według unikalnego identyfikatora wykonania. Zdarzenia mogą przyjść poza kolejnością.
- [ ] **12.3. Dodać uzgadnianie.** Odczytywać otwarte zlecenia, wykonania,
  pozycje, gotówkę i środki dostępne według brokera. Po timeout sprawdzić
  wynik przez trwałe `clientOrderId` albo mechanizm równoważny dostawcy;
  niepewny wynik ma stan `unknown` i blokuje ślepe ponowienie.
- [ ] **12.4. Przeprowadzić próbę ciągłą.** Sprawdzić restart w trakcie wysyłki,
  wygaśnięcie sesji brokera, częściowe wykonania, anulowanie, odrzucenia,
  duplikaty zdarzeń i utratę połączenia. Zapisać ograniczenia symulatora
  oraz różnice między źródłem sygnałów a źródłem cen wykonania.

**Ukończenie:** pełny przepływ sygnał → zlecenie paper → wykonanie → pozycja
→ uzgodnienie jest sprawdzony dla każdego rynku planowanego do live.
Nieuzgodniona różnica zatrzymuje dalsze wykonywanie danej strategii.
Przejście dalej opiera się na poprawności cyklu i odporności na awarie,
a nie wyłącznie na dodatnim wyniku symulacji.

## Etap 13. Rzeczywisty rachunek i zlecenia zatwierdzane przez użytkownika

**Cel:** wdrożyć rzeczywisty adapter ze świadomym zatwierdzaniem każdej operacji.

- [ ] **13.1. Podłączyć rachunek w trybie odczytu.** Szyfrować poświadczenia,
  zapewnić ich rotację i odłączenie; logi ukrywają sekrety. Zweryfikować
  identyfikatory rachunku, uprawnienia, instrumenty i wymagane subskrypcje danych.
  Uzgodnić portfel aplikacji z brokerem przed włączeniem zapisu.
- [ ] **13.2. Dodać podgląd zlecenia i zatwierdzenie.** Instrument, rachunek,
  kierunek, ilość, limit ceny, termin ważności i szacowane koszty. Zatwierdzenie
  dotyczy dokładnie tej wersji propozycji, wygasa i wymaga ponownej autoryzacji.
  API samodzielnie sprawdza wszystkie warunki.
- [ ] **13.3. Dodać kontrolę przed wysłaniem.** Dostępne środki według brokera,
  zarezerwowane środki dla innych zleceń, limit pozycji i wartości operacji,
  świeżość danych, sesja rynku i brak nierozstrzygniętych zleceń.
  Pierwsze obsługiwane zlecenia mają limit ceny i zakres long-only.
- [ ] **13.4. Dodać zatrzymanie i audyt.** Zatrzymanie blokuje nowe zlecenia;
  anulowanie otwartych śledzi odpowiedź brokera i możliwe wykonania w trakcie.
  Zamknięcie posiadanych pozycji jest odrębną operacją. Zapisać użytkownika,
  uzasadnienie, limity, dane wejściowe i wszystkie statusy zlecenia.

**Ukończenie:** testy adaptera i scenariusze paper potwierdzają odrzucanie
nieaktualnej zgody, duplikatów, braku środków i przekroczenia limitów.
Aktywacja live i ewentualna próba rzeczywistego zlecenia są osobnymi,
jawnie zainicjowanymi działaniami użytkownika; samo wykonanie tego planu
nie obejmuje wysłania zlecenia ani użycia realnych środków.

## Etap 14. Automatyczny bot — wersja E

**Cel:** wykonywać konkretną, wcześniej zweryfikowaną strategię w ustalonych granicach.

- [ ] **14.1. Dodać konfigurację aktywacji.** Użytkownik wskazuje rachunek,
  dokładną wersję strategii, listę instrumentów, budżet, wielkość pozycji,
  dozwolone godziny, limity dzienne oraz datę wygaśnięcia aktywacji.
  Zmiana strategii wymaga nowej aktywacji tej wersji.
- [ ] **14.2. Połączyć silnik ryzyka ze zleceniami.** Transakcyjna rezerwacja
  środków i limitów chroni przed konkurującymi workerami i strategiami.
  Zdefiniować wynik dzienny, punkt odniesienia i walutę limitu straty.
  Osiągnięcie limitu wstrzymuje nowe operacje zgodnie z jawną polityką.
- [ ] **14.3. Obsłużyć awarie i odzyskiwanie.** Nieaktualne dane, awaria brokera,
  rozjazd portfela, nieznany wynik wysłania lub brak możliwości sprawdzenia
  limitów wstrzymują wykonywanie. Restart zaczyna się od uzgodnienia stanu;
  operator dostaje powiadomienie i kontrolowany sposób wznowienia.
- [ ] **14.4. Uruchamiać stopniowo i monitorować.** Najpierw tryb obserwacyjny
  generujący propozycje, następnie zatwierdzane zlecenia, potem aktywacja
  automatyczna w ustalonym zakresie. Monitorować różnice względem symulacji,
  koszty, poślizg, błędy i skuteczność mechanizmu zatrzymania.

**Ukończenie:** można odtworzyć każdą decyzję i jej wykonanie. Testy awarii
potwierdzają zatrzymanie i bezpieczne uzgodnienie po restarcie; równoległe
strategie nie przekraczają wspólnego budżetu. Automatyzacja jest aktywowana
osobno dla konkretnego rachunku, rynku i wersji strategii.

## 4. Proponowany podział kodu i kontraktów

Nowe moduły backendu, tworzone wraz z odpowiednim etapem:

| Moduł | Odpowiedzialność |
| --- | --- |
| `investments/` | Portfele, rachunki, rejestr operacji, pozycje i koszt FIFO. |
| `instruments/` | Katalog instrumentów, emitenci i mapowanie dostawców. |
| `market-data/` | Ceny, FX, kalendarze, zdarzenia korporacyjne i jakość danych. |
| `portfolio-analytics/` | Wycena, snapshoty, wyniki i stopy zwrotu. |
| `watchlists/`, `alerts/` | Obserwowane instrumenty i reguły. |
| `notifications/` | Połączenia kanałów, outbox i historia dostarczenia. |
| `fundamentals/` | Raporty, fakty, wskaźniki, notatki i porównania. |
| `imports/` | Parsowanie, podgląd, zatwierdzanie i uzgadnianie importu. |
| `strategies/`, `backtesting/` | Wspólny interfejs strategii i wykonanie symulacji. |
| `brokers/`, `trading/` | Adaptery, zlecenia, wykonania, limity i uzgadnianie. |
| `jobs/`, `worker.ts` | Trwałe zadania i osobny proces wykonawczy. |

Proponowane ścieżki frontendu:

- `/dashboard/investments` — przegląd portfeli i wyników.
- `/dashboard/investments/[portfolioId]` — rachunki, pozycje i alokacja.
- `/dashboard/investments/[portfolioId]/accounts/[accountId]` — operacje rachunku.
- `/dashboard/companies/[instrumentId]` — notowania i analiza emitenta.
- `/dashboard/watchlists` oraz `/dashboard/alerts` — obserwacja rynku.
- `/dashboard/settings/notifications` — kanały powiadomień.
- `/dashboard/imports` — podgląd i zatwierdzanie historii.
- `/dashboard/strategies` i `/dashboard/backtests` — sygnały i symulacje.
- `/dashboard/trading` — połączenia brokerów, propozycje i statusy zleceń.

Grupy endpointów API mają odpowiadać tym modułom, np.
`/investments/portfolios`, `/investments/accounts/:id/events`, `/instruments`,
`/instruments/:id/prices`, `/alerts`, `/notification-channels`, `/imports`,
`/strategies`, `/backtests`, `/broker-connections` i `/orders`.
Ostateczny kontrakt DTO, statusów, paginacji i błędów powstaje przed
implementacją każdego modułu w osobnym dokumencie `docs/*-api.md`.

## 5. Kryteria ukończenia każdego zadania

- Migracja, walidacja DTO i dokument kontraktu odpowiadają faktycznej zmianie.
- Obsługa kwot, czasu, właściciela i ponowień jest spójna między API i workerem.
- Nowa logika finansowa ma testy z jawnie obliczonym wynikiem; ograniczenia
  i współbieżność sprawdzają testy PostgreSQL.
- Zewnętrzne API ma fixture i adapter testowy; zwykłe CI działa bez płatnych
  kluczy, wiadomości do prawdziwych odbiorców i rzeczywistych zleceń.
- Istotne przepływy użytkownika mają scenariusze Playwright, także dla
  drugiego konta, wygaśnięcia sesji, błędu sieci i ekranu mobilnego.
- Przechodzą kontrole właściwe dla zmiany; dokumentacyjna zmiana wymaga
  sprawdzenia treści i odnośników, a nie ponownego uruchamiania całego zestawu.
- Dane testowe i infrastruktura są odseparowane od kont oraz portfeli użytkownika.
- Zadanie kończy się działającym fragmentem funkcji, dokumentacją i krótkim
  scenariuszem odbioru; kolejne etapy zaczynają się po spełnieniu kryteriów poprzednich.

## 6. Rozszerzenia po podstawowej ścieżce

1. Notowania w trakcie sesji i alerty o mniejszym opóźnieniu, po sprawdzeniu
   pokrycia obu rynków, licencji i potrzebnej przepustowości.
2. Powiadomienia Web Push/PWA, obok istniejącego adaptera Telegrama.
3. Dodatkowe formaty importu, ETF-y i kolejne waluty z osobnymi testami.
4. Kalendarz raportów i zdarzeń, powiadomienia o publikacjach oraz zaawansowany screener.
5. Podsumowania raportów przez AI z odnośnikami do źródeł; wartości liczbowe
   pochodzą z zapisanych danych, a wykonanie zleceń z jawnych reguł strategii.
6. Rozliczenia podatkowe jako oddzielny projekt z aktualnymi regułami i weryfikacją.

## 7. Źródła do decyzji integracyjnych

Sprawdzone podczas przygotowania planu 13 listopada 2026 r. Dostępność,
plany i warunki należy ponownie zweryfikować przed zakupem lub integracją.

- [EODHD — giełdy i katalog instrumentów](https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours)
  opisuje symbole dostawcy dla GPW i USA.
- [EODHD — zakres planów](https://eodhd.com/help/plans) rozdziela m.in.
  dane dzienne, intraday i fundamenty; pokrycie trzeba potwierdzić na próbce.
- [NBP Web API](https://api.nbp.pl/) udostępnia aktualne i historyczne
  referencyjne kursy walut. Te dane nie zastępują rzeczywistego kursu brokera.
- [SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
  udostępnia historię zgłoszeń i dane XBRL; integracja wymaga przestrzegania zasad dostępu.
- [NestJS — kolejki](https://docs.nestjs.com/techniques/queues) opisuje integrację
  BullMQ i pracę zadań w osobnych procesach.
- [Telegram Bot API — sendMessage](https://core.telegram.org/bots/api#sendmessage)
  jest podstawą pierwszego adaptera wysyłki powiadomień.
- [Alpaca — paper trading](https://docs.alpaca.markets/us/docs/paper-trading)
  opisuje środowisko symulowane i jego ograniczenia; dotyczy kandydata do
  integracji USA, a nie potwierdzenia obsługi GPW.
- [IBKR — Trading Web API](https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/)
  jest punktem wyjścia do sprawdzenia uprawnień, sesji, notowań i możliwości
  brokera dla docelowego rachunku. Wybór API wymaga potwierdzenia instrumentów.
