# Decyzje domenowe platformy inwestycyjnej — GPW i USA

Data: 15 listopada 2026 r. Zakres: INV 0.1.

Dokument ustala reguły dla implementacji opisanej w
[roadmapie inwestycyjnej](investment-roadmap.md). Modele, API i interfejs
inwestycji powstaną w kolejnych zadaniach; obecna aplikacja obsługuje portfel
finansów osobistych. Zmiana poniższych reguł wymaga aktualizacji dokumentu,
przykładów oraz zależnych testów.

## 1. Zakres i granice domeny

| Obszar | Decyzja |
| --- | --- |
| Instrumenty | Akcje GPW i USA; wyłącznie pozycje długie finansowane własną gotówką. |
| Waluty | PLN i USD. Waluta instrumentu jest jawna; rachunek przechowuje osobne salda gotówki dla każdej waluty. |
| Prezentacja | Łączna wycena w PLN, szczegóły także w walucie instrumentu. Wersja A pokazuje ilości, koszt i gotówkę; wycena rynkowa powstaje w etapie 5. |
| Portfele i rachunki | Użytkownik może mieć wiele portfeli i rachunków. Historia oraz gotówka należą do konkretnego rachunku. |
| Ilości | Model dopuszcza ilości ułamkowe do 10 miejsc po przecinku. Dostępność takich transakcji u konkretnego brokera wymaga potwierdzenia przed integracją. |
| Dane | Najpierw notowania dzienne po sesji. Każda cena i kurs wyceny mają datę, źródło i status kompletności. |
| Pierwsze operacje | Ręczny rejestr. Import, dane rynkowe, alerty, strategie i integracje powstają według kolejności w roadmapie. |
| Poza pierwszą ścieżką | Shorty, dźwignia, opcje, ETF-y, inne waluty, deklaracje podatkowe, intraday i aplikacja natywna. |

FIFO w tym dokumencie służy analityce aplikacji. Reguły podatkowe są osobnym
zakresem prac. Wybór dostawcy danych należy do [#45](https://github.com/WielechJW/finance-next-nest/issues/45),
a porównanie brokerów do [#46](https://github.com/WielechJW/finance-next-nest/issues/46).

### Relacja z obecnym portfelem finansowym

Istniejące `Wallet`, `Transaction` i `Category` opisują budżet osobisty w PLN.
Inwestycje otrzymają własne `Portfolio`, `InvestmentAccount`, `InvestmentEvent`
oraz wpisy gotówkowe i ilościowe. Właściciela ustalamy przez relację
użytkownik → portfel inwestycyjny → rachunek → zdarzenie.

Zakup akcji zamienia gotówkę na instrument; sprzedaż wykonuje operację
odwrotną. Nie tworzą one automatycznie przychodu ani wydatku w obecnym
portfelu finansowym. Wpłata na rachunek inwestycyjny jest przepływem
kapitału, a nie zyskiem inwestycyjnym.

W wersji A obie domeny mają niezależne rejestry, bez automatycznej
synchronizacji. Przyszły transfer między nimi wymaga wspólnego identyfikatora,
zapisu obu stron atomowo i wyłączenia transferu wewnętrznego z przepływów
zewnętrznych łącznego portfela. Migracje inwestycyjne zachowują dane oraz
dotychczasowe reguły portfela osobistego, w tym jego osobne saldo początkowe.

## 2. Zdarzenia, gotówka i pozycje

Źródłem prawdy jest rejestr wykonanych zdarzeń. Salda, partie FIFO i wyniki
są projekcjami, które można odtworzyć. Każde zdarzenie zapisuje wszystkie
swoje wpisy w jednej transakcji bazodanowej.

| Zdarzenie | Wpływ na rachunek i wynik |
| --- | --- |
| Wpłata / wypłata | Zmienia gotówkę wskazanej waluty i kapitał zewnętrzny. Sama nie tworzy zysku ani straty. |
| Kupno | Gotówka maleje o wartość zakupu i prowizję; ilość rośnie. Wartość zakupu wraz z prowizją tworzy koszt nowej partii. |
| Sprzedaż | Ilość maleje; gotówka zmienia się o wpływ brutto pomniejszony o prowizję. Wynik zrealizowany to wpływ netto minus zużyty koszt FIFO. |
| Dywidenda | Gotówka rośnie o rzeczywiście wypłaconą kwotę netto. Kwotę brutto, potrącony podatek i opłatę przechowujemy oddzielnie, jeśli są znane. |
| Opłata | Zmniejsza gotówkę i wynik w swojej walucie. Prowizji zawartej w kupnie lub sprzedaży nie zapisujemy ponownie jako samodzielnej opłaty. |
| Wymiana walut | Atomowo odejmuje sprzedaną walutę, dodaje kupioną i pobiera jawną prowizję. Nie zmienia liczby akcji ani kosztu ich partii. |
| Split | Zmienia ilość i koszt jednostkowy, zachowując łączny koszt partii. Obsługa zdarzeń korporacyjnych powstaje w etapie 5. |
| Otwarcie istniejącej pozycji | Jawna partia otwarcia zawiera ilość, łączny koszt i datę odniesienia. Nie udaje historycznej transakcji gotówkowej. |

Obowiązują następujące ograniczenia:

- Gotówka w każdej walucie i ilość każdego instrumentu są nieujemne po
  każdym zdarzeniu w porządku ewidencji, także przy dopisywaniu historii.
  Późniejsza wpłata nie naprawia ujemnej gotówki we wcześniejszym dniu.
- Kupno akcji w USD wymaga gotówki w USD. Nie uruchamia automatycznej
  wymiany z PLN ani pożyczki. Prowizja kupna i sprzedaży jest w wersji A
  rozliczana w walucie instrumentu; inną walutę prowizji odrzucamy do czasu
  zdefiniowania i implementacji jej odrębnej reguły.
- Nie można sprzedać więcej akcji, niż wynosi pozycja na danym rachunku
  w chwili zdarzenia. Akcje na innym rachunku nie pokrywają tej sprzedaży.
- Wersja A pokazuje gotówkę według wykonanych operacji. `settledOn` jest
  informacją o rozrachunku; dostępność środków do wysłania rzeczywistego
  zlecenia zostanie uzgodniona z brokerem w etapach paper/live.
- Partie otwarcia wymagają dodatniej ilości, nieujemnego znanego kosztu
  oraz daty odniesienia. Brak kosztu nie jest zastępowany zerem. Stan
  otwarcia nie pozwala pokazywać stopy zwrotu za okres sprzed tej daty.
- W rejestrze każde zdarzenie ma właściciela, źródło i klucz idempotencji
  w zakresie rachunku. Powtórzenie tej samej operacji zwraca zapisany wynik;
  ten sam klucz z inną treścią jest konfliktem.

## 3. Koszt FIFO i prowizje

FIFO liczymy osobno dla pary **rachunek + instrument**, w walucie instrumentu.
Partie różnych rachunków ani różnych instrumentów nie są łączone.
Każde kupno tworzy partię z ilością i kosztem zawierającym prowizję zakupu.
Sprzedaż zużywa najstarsze dostępne partie według kolejności z sekcji 5.

```text
koszt partii = rozliczona wartość zakupu + prowizja zakupu
wpływ netto ze sprzedaży = rozliczona wartość sprzedaży - prowizja sprzedaży
wynik zrealizowany = wpływ netto ze sprzedaży - zużyty koszt FIFO
```

Przy częściowym zużyciu partii wyliczamy jej skumulowany koszt zużycia:
`ROUND_HALF_UP(pierwotny koszt × łączna zużyta ilość / pierwotna ilość, 8)`.
Koszt bieżącej sprzedaży to różnica między nowym kosztem skumulowanym
a kosztem przydzielonym poprzednim sprzedażom. Ostatnie zużycie otrzymuje
cały pozostały koszt tej partii, dzięki czemu przydziały są nieujemne,
ich suma jest równa kosztowi wejściowemu, a zamknięta partia ma dokładnie
zerowy koszt i ilość.

Przykład reszty: partia `3` akcji kosztuje `1.00000000` PLN. Przy trzech
kolejnych sprzedażach po `1` akcji przydzielamy koszty `0.33333333`,
`0.33333334` i `0.33333333` PLN. Nie zaokrąglamy kosztu każdej akcji do groszy.
Prowizję sprzedaży odejmujemy raz od całego wpływu, także gdy sprzedaż
zużywa kilka partii.

Wynik transakcji w USD pozostaje wynikiem w USD. Do przeliczenia wyceny
na PLN potrzebne będą jawne kursy referencyjne z datą i źródłem. Faktyczna
wymiana walut korzysta z kwot swojej operacji; nie przepisujemy jej według
późniejszego kursu wyceny. Samo przewalutowanie nie tworzy wyniku ze sprzedaży
akcji. Rozdzielenie wyniku cenowego i walutowego powstanie w etapie 5.

## 4. Precyzja, API i zaokrąglanie

| Wartość | Zapis docelowy | Reguła |
| --- | --- | --- |
| Ilość i cena jednostkowa | `Decimal(28,10)` | Do 18 cyfr całkowitych i 10 ułamkowych. Ilość i cena kupna/sprzedaży muszą być dodatnie. |
| Kwoty, koszt partii i wynik | `Decimal(28,8)` | Do 20 cyfr całkowitych i 8 ułamkowych; znak wyniku lub wpisu wynika z rodzaju zdarzenia. |
| Kurs PLN za 1 USD | `Decimal(28,8)` | Kurs dodatni; kierunek zapisujemy jawnie jako PLN za USD. |
| Rozliczana gotówka PLN/USD i prowizje | Kwota z dokładnością do 2 miejsc | Wpis gotówkowy jest wielokrotnością `0.01`, także jeśli przechowuje go kolumna ze skalą 8. |

Powyższe typy dotyczą nowych modeli inwestycyjnych. Dotychczasowy
`Decimal(14,2)` i kontrakt API portfela finansowego mają własny zakres.

1. API przyjmuje i zwraca liczby finansowe jako stringi dziesiętne z kropką,
   bez notacji wykładniczej, separatorów tysięcy, spacji, `NaN` i nieskończoności.
   Formularz może zamienić polski przecinek przed wysłaniem danych.
2. Dane wejściowe przekraczające skalę lub zakres pola są odrzucane przed
   zapisem, także gdy PostgreSQL mógłby je zaokrąglić. Wartości ujemne
   są dopuszczane tylko tam, gdzie przewiduje je typ wpisu lub wynik;
   ilości transakcji są dodatnie, prowizje nieujemne, zero jest normalizowane.
3. Wszystkie obliczenia korzystają z Decimal tworzonych ze stringów.
   Dla inwestycji stosujemy odrębny kontekst Decimal z precyzją co najmniej
   80 cyfr znaczących, bez zmiany globalnej konfiguracji obecnego portfela.
   `Number` służy wyłącznie geometrii wykresów.
4. Obowiązuje `ROUND_HALF_UP`: połowa zaokrąglana od zera, np. `1.005`
   do `1.01` i `-1.005` do `-1.01` przy skali 2. Wartość transakcji
   `ilość × cena` rozliczamy do groszy raz dla całego wykonania, nie osobno
   dla każdej akcji. Prowizja jest osobną rzeczywiście pobraną kwotą.
5. Wartość brutto kupna/sprzedaży po zaokrągleniu musi być większa od zera.
   Wyliczony zapis nie może przekroczyć zakresu kolumny, nawet gdy każde
   pole wejściowe osobno mieści się w swoim limicie.
6. Koszt FIFO i wynik zachowują 8 miejsc. Ich wyświetlenie w PLN/USD do
   2 miejsc nie zmienia wartości rejestru. Sumujemy wartości z pełną
   zachowaną precyzją, a dopiero potem zaokrąglamy prezentowaną sumę.
7. Kwoty gotówki są serializowane z 2 miejscami, ilości i ceny z 10,
   a koszt, wynik i kurs z 8. Agregaty obliczamy bez ograniczenia do rozmiaru
   pojedynczego wpisu; ewentualny zapis agregatu wymaga osobnej kontroli zakresu.

Kontrakt przyszłego API inwestycji przyjmuje wyłącznie kanoniczne stringi
dziesiętne z kropką, bez wiodących zer (poza samym `0`), spacji i notacji
wykładniczej. `backend/src/investments/precision.ts` odrzuca nadmiarową skalę
przed przekazaniem wartości do Prisma; serializacja zwraca dokładnie 2 miejsca
dla rozliczanej gotówki i brutto transakcji, 10 dla ilości/ceny oraz 8 dla
kursu i wyników. `CashEntry.amount` i `Trade.grossAmount` mają dodatkowy
warunek PostgreSQL wymuszający wielokrotność `0.01`. Migracja nie zaokrągla
wcześniejszych wpisów z ułamkiem grosza: wymaga uprzedniego wyjaśnienia
takich danych.

### Kwoty wymiany walut

Rejestr FX przechowuje obie rzeczywiście rozliczone kwoty, ich waluty oraz
prowizję w walucie sprzedawanej. Kwota sprzedawana nie obejmuje prowizji;
łączne obciążenie to **kwota sprzedawana + prowizja**. Kwota kupowana jest
faktycznie otrzymaną kwotą, bez kolejnej ukrytej prowizji.

Kurs efektywny **PLN za 1 USD** wyznaczamy jako kwota PLN bez prowizji
podzielona przez kwotę USD i zapisujemy do 8 miejsc. Obie kwoty pozostają
źródłem prawdy: nie odtwarzamy ich później z zaokrąglonego kursu.
Obie strony i prowizja muszą zostać zapisane atomowo. Zmiana źródłowych
kwot przez korektę wymaga ponownego wyznaczenia kursu efektywnego.

## 5. Daty, strefy i kolejność zdarzeń

Strefą ewidencji rachunku w wersji A jest `Europe/Warsaw`. Zachowujemy
również strefę źródła: dla sesji GPW `Europe/Warsaw`, dla sesji rynku USA
`America/New_York`. Konwersje używają nazw IANA, a nie stałego przesunięcia
UTC, ponieważ zmiany czasu na obu rynkach mogą wystąpić w inne dni.

| Pole / informacja | Znaczenie |
| --- | --- |
| `occurredOn` | Data ewidencyjna `YYYY-MM-DD` w strefie rachunku. Wyznacza dzień historii i raportów. |
| `executedAt` | Rzeczywisty czas wykonania, jeśli jest znany, zapisywany jako moment UTC. Zachowujemy też źródłową strefę i dokładność czasu. |
| Dokładność daty/czasu | Jawne `DATE` albo `INSTANT`. Ręczny zapis z samą datą nie otrzymuje fikcyjnego czasu wykonania o północy. |
| Data sesji | Data w kalendarzu giełdy, odrębna od daty ewidencyjnej; szczególnie istotna dla wieczornych operacji USA. |
| `settledOn` | Opcjonalna data rozrachunku według źródła; może być przyszła względem wykonania. Brak pozostaje brakiem. |
| `recordedAt` | Czas rejestracji wersji zdarzenia, nadawany przez serwer w UTC. Nie rozstrzyga kolejności ekonomicznej operacji. |
| Kolejność w dniu | Utrwalony, jednoznaczny porządek zdarzeń danego rachunku w tej samej dacie ewidencyjnej. |

Przy znanym czasie wyznaczamy `occurredOn` przez konwersję `executedAt`
do strefy rachunku, a datę sesji do strefy giełdy. Np. moment
`2026-01-15T23:30:00-05:00` to `2026-01-16T04:30:00Z`: data ewidencyjna
w Warszawie wynosi `2026-01-16`, a data w strefie Nowego Jorku `2026-01-15`.
Ten przykład opisuje konwersję czasu, nie harmonogram sesji giełdowej.

Dla wpisu znanego tylko co do daty użytkownik podaje datę ewidencyjną
rachunku. Import musi wskazać znaczenie daty i jej strefę; daty źródłowej
nie zamieniamy na moment UTC przez dopisanie północy. Niejednoznaczny
czas lokalny przy zmianie czasu wymaga offsetu, a nieistniejący czas
lokalny jest odrzucany.

Rejestr przeliczamy po dacie ewidencyjnej i utrwalonej kolejności w dniu.
Znane czasy wykonania muszą zachowywać swój porządek. Remisy oraz wpisy
z samą datą mają jawną kolejność wynikającą ze źródła lub wyboru użytkownika;
przy braku takiej informacji wymagamy jej ustalenia przed zapisem.
Nie sortujemy historii ekonomicznej po losowym UUID ani `recordedAt`.

Przykład: wpłata i kupno z tego samego dnia, bez znanych godzin, wymagają
ustalenia kolejności. Wpłata przed kupnem może zapewniać środki; odwrotna
kolejność jest odrzucana, jeśli powoduje ujemną gotówkę. Ten sam czas
dwóch zakupów również wymaga stabilnego rozstrzygnięcia dla późniejszego FIFO.

`InvestmentEvent.daySequence` jest dodatnią, unikalną pozycją w ramach rachunku
i daty ewidencyjnej. Nadający ją zapis musi uwzględnić znane czasy wykonania;
remisy i zdarzenia znane tylko co do daty wymagają jawnej pozycji. Zdarzenia
sprzed migracji 1.3 otrzymują techniczny porządek oraz
`orderingSource=MIGRATED_UNVERIFIED`: przed księgowaniem lub odtwarzaniem
historii trzeba potwierdzić ich faktyczną kolejność. `timePrecision=DATE`
oznacza `executedAt=NULL`; dla `INSTANT` wymagane są `executedAt` i strefa
źródłowa IANA. `marketSessionOn` i `settledOn` mogą pozostać puste.

Zdarzenia wykonane mogą być historyczne lub bieżące. `occurredOn` nie może
przekraczać dzisiejszej daty w strefie rachunku, a znany `executedAt`
nie może być późniejszy od czasu serwera. Przyszła operacja jest planem
lub zleceniem i nie wpływa na gotówkę, pozycję ani wynik. Dopiero
potwierdzone wykonanie tworzy zdarzenie rejestru. To osobna reguła względem
obecnych transakcji budżetu osobistego, które dopuszczają przyszłe daty.

## 6. Korekty i współbieżność

Korekta tworzy nową wersję zdarzenia z powiązaniem do oryginału, autorem,
czasem zapisu i powodem. Pierwotna treść pozostaje w audycie. Anulowanie
wykonanej operacji jest jawną rewizją wyłączającą ją z aktywnego rejestru.
Nie usuwamy historii fizycznie ani nie księgujemy korekty jako dodatkowej
niepowiązanej transakcji w dniu jej wprowadzenia.

Zmiana daty lub kolejności, dopisanie operacji historycznej oraz anulowanie
wymagają ponownego przeliczenia kolejnych zdarzeń od najwcześniejszego
zmienionego miejsca. Dotyczy to gotówki, partii FIFO, wyników oraz późniejszych
snapshotów. Jeśli którykolwiek stan stałby się ujemny, cała zmiana jest
odrzucana, a poprzednia aktywna historia pozostaje ważna.

Zapisy i korekty blokują właściwy rachunek w transakcji bazodanowej.
Dwie równoczesne sprzedaże nie mogą zużyć tej samej ilości. Kontrola wersji
zdarzenia wykrywa równoczesne edycje. Ponowienie po utracie odpowiedzi
korzysta z klucza idempotencji i nie zapisuje drugiego wykonania.
Izolację właściciela sprawdzamy również w imporcie i zadaniach tła.

## 7. Policzone przykłady odbioru

Kwoty i kursy poniżej są umownymi danymi obliczeniowymi. Przykłady zakładają
właściwą kolejność wykonania i gotówkę rozliczaną do 2 miejsc.

### A. Kupno i częściowa sprzedaż z prowizją

| Krok | Obliczenie | Gotówka PLN | Akcje | Pozostały koszt PLN | Zrealizowany wynik PLN |
| --- | --- | --- | --- | --- | --- |
| Wpłata | `1000.00` | `1000.00` | `0` | `0.00000000` | `0.00000000` |
| Kupno | `10 × 50.00 + 5.00 = 505.00` | `495.00` | `10` | `505.00000000` | `0.00000000` |
| Sprzedaż | `4 × 60.00 - 2.00 = 238.00` netto | `733.00` | `6` | `303.00000000` | `36.00000000` |

Koszt sprzedanych akcji: `505.00 × 4 / 10 = 202.00000000` PLN.
Wynik sprzedaży: `238.00 - 202.00 = 36.00000000` PLN.
Przy hipotetycznej cenie wyceny `70.00` PLN pozostałe akcje są warte
`420.00` PLN, wynik niezrealizowany wynosi `117.00` PLN, a wartość rachunku
`733.00 + 420.00 = 1153.00` PLN. Wynik po odjęciu wpłaty to `153.00` PLN,
równy `36.00 + 117.00`. Ten scenariusz odpowiada etapom 2 i 5 roadmapy.

### B. Sprzedaż obejmująca dwie partie FIFO

Wpłata `2000.00` PLN. Kupno `10 × 50.00` z prowizją `5.00` tworzy
partię A za `505.00000000` PLN. Następne kupno `5 × 60.00` z prowizją
`3.00` tworzy partię B za `303.00000000` PLN. Gotówka wynosi `1192.00` PLN.

Sprzedaż `12 × 70.00` z prowizją `6.00` daje `834.00` PLN netto.
Zużywa całe A oraz `2/5` partii B:

```text
zużyty koszt = 505.00000000 + 303.00000000 × 2 / 5 = 626.20000000 PLN
wynik sprzedaży = 834.00 - 626.20000000 = 207.80000000 PLN
pozostała ilość = 3 akcje z partii B
pozostały koszt = 303.00000000 × 3 / 5 = 181.80000000 PLN
gotówka = 1192.00 + 834.00 = 2026.00 PLN
```

### C. Wymiana PLN na USD i kupno akcji za USD

Rachunek zaczyna od wpłaty `1000.00` PLN i `0.00` USD. Zapisujemy wymianę
`400.00` PLN na `100.00` USD oraz prowizję `2.00` PLN. Kurs efektywny
wynosi `400.00 / 100.00 = 4.00000000` PLN za USD. Łączne obciążenie PLN
to `402.00`, więc po operacji jest `598.00` PLN i `100.00` USD.

Kupno `2` akcji po `40.00` USD z prowizją `1.00` USD daje:

```text
obciążenie USD = 2 × 40.00 + 1.00 = 81.00 USD
gotówka po kupnie = 598.00 PLN i 19.00 USD
pozycja = 2 akcje; koszt partii = 81.00000000 USD
wynik zrealizowany ze sprzedaży akcji = 0.00000000 USD
```

Prowizja FX `2.00` PLN jest osobnym kosztem rachunku; nie dodajemy jej
ponownie do partii akcji w USD. Próba wykonania kupna przed wymianą jest
odrzucana z braku USD, mimo dodatniego salda PLN.

### D. Korekta zmieniająca późniejszy stan

W przykładzie A próba zmniejszenia ilości kupna z `10` do `3` zostaje
odrzucona, ponieważ późniejsza sprzedaż `4` akcji tworzyłaby krótką pozycję.
Próba anulowania wpłaty również zostaje odrzucona, bo kupno wymaga środków.
Audyt i aktywna wersja pozostają spójne; saldo i wynik z przykładu A
nie zmieniają się po odrzuceniu korekty.

## 8. Zależne zadania i odbiór INV 0.1

| Kryterium INV 0.1 | Miejsce w dokumencie |
| --- | --- |
| Zakres, PLN/USD, FIFO, precyzja i odrębne domeny | Sekcje 1–4. |
| Daty, czas zapisu, strefy, plany i korekty | Sekcje 5–6 oraz przykład D. |
| Policzone kupno, sprzedaż z prowizją i FX | Przykłady A–C oraz reszta zaokrąglenia w sekcji 3. |

Kolejne zadania wykorzystują ten dokument jako kontrakt:

- [#45](https://github.com/WielechJW/finance-next-nest/issues/45) i
  [#46](https://github.com/WielechJW/finance-next-nest/issues/46): próbka danych,
  koszty i warunki dostawców oraz możliwości brokerów.
- [#47](https://github.com/WielechJW/finance-next-nest/issues/47): automatyczna
  weryfikacja istniejącej aplikacji w CI.
- [#48](https://github.com/WielechJW/finance-next-nest/issues/48)–[#51](https://github.com/WielechJW/finance-next-nest/issues/51): modele,
  migracje, konkretne pola czasu i porządku, ograniczenia oraz idempotencja.
- [#52](https://github.com/WielechJW/finance-next-nest/issues/52)–[#55](https://github.com/WielechJW/finance-next-nest/issues/55): silnik
  zapisu i FIFO z testami przykładów A–D, wielu rachunków, ułamków i granic.
- [#56](https://github.com/WielechJW/finance-next-nest/issues/56)–[#59](https://github.com/WielechJW/finance-next-nest/issues/59): kontrakt
  API i panel ręcznego portfela.

Odbiór tej zmiany dokumentacyjnej obejmuje zgodność z roadmapą, kontrolę
rachunków w przykładach oraz odnośników. Migracje, CI i testy funkcjonalne
inwestycji są częścią wymienionych zadań implementacyjnych.
