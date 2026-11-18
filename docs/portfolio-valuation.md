# Wycena i wynik portfela — etap 5

`GET /investments/portfolios/:id/valuation` wymaga sesji i właściciela. Wycena
sumuje wszystkie rachunki, w tym zarchiwizowane, według ich rejestru operacji.
Do akcji używa surowego close ostatniej oczekiwanej sesji, do gotówki USD i sumy
w PLN — tabeli A NBP dostępnej na dzień wyceny. Kurs starszy niż siedem dni
oznacza brak aktualnego FX. Brak ceny lub stara cena oznacza niepełny wynik;
pełna suma jest `null`, a `knownValuePln` jest tylko znaną częścią oszacowania.
Odpowiedź zawiera daty, źródła, ID rewizji, gotówkę, ilości, koszty FIFO,
wynik zrealizowany i niezrealizowany według walut oraz alokację spółek, rynków
i walut. `CASH` w alokacji rynków oznacza gotówkę.

Wynik PLN = wartość portfela − wpłaty + wypłaty − koszt pozycji otwarcia.
Przepływy USD przeliczamy kursem historycznym z dnia przepływu (lub ostatnim
dostępnym do siedmiu dni wcześniej). Brak takiego kursu pozostawia wynik pusty,
nawet gdy bieżąca wartość jest znana. Dywidendy, prowizje i podatki wpływają
już na gotówkę; nie odejmujemy ich drugi raz. Przykład kontrolny: gotówka 733,
6 akcji po 70 = 420, koszt 303, wynik niezrealizowany 117, wartość 1153,
wkład 1000, wynik 153 PLN. Sama wpłata nie daje zysku.

`GET /investments/portfolios/:id/valuations?from=2026-11-01&to=2026-11-18`
odtwarza do 93 dni z aktualnych rewizji historii i danych rynkowych. Każda luka
pozostaje widoczna. TWR stosuje jawną konwencję przepływów na początek dnia:
`NAV_koniec / (NAV_poprzedni + przepływ_dnia)`. Pierwszy dodatni wkład tworzy
bazę; zerowy pusty portfel ma mnożnik 1. Niepełna wycena, niedodatnia baza
lub partia otwarcia w dniu obliczenia przerywa TWR, zamiast wymyślać zwrot.
Opcjonalne `benchmarkId` porównuje skorygowany close wybranej spółki w PLN,
z uwzględnieniem FX i dywidend/splitów zgodnie z definicją adjusted close dostawcy.

Worker zapisuje niezmienne snapshoty danych i hash wejścia. Nowa rewizja
rejestru lub notowań tworzy kolejną wersję; identyczna kalkulacja nie mnoży
snapshotów. Historia użytkownika jest przeliczana z aktualnych wejść, więc
korekta starego zakupu nie pozostawia starego wyniku w raporcie. Snapshoty
służą audytowi wcześniejszych kalkulacji, a nie jako źródło prawdy dla pozycji.

## Dywidendy i splity

`GET .../accounts/:accountId/corporate-actions` pokazuje propozycje dla akcji
posiadanych przed ex-date. `POST .../corporate-actions/:actionId/confirm`
wymaga aktualnej rewizji, jawnego potwierdzenia rzeczywistego zdarzenia,
daty, kolejności i klucza idempotencji. Dla dywidendy użytkownik podaje rzeczywistą
kwotę brutto, podatek i opcjonalną opłatę; sama prognoza nie księguje gotówki.
Brak paymentDate nie jest zastępowany ex-date. Stały identyfikator źródłowy
chroni przed ponownym zaksięgowaniem po retry lub rewizji dostawcy.

Split ma osobny zapis proporcji w rejestrze. Replay zmienia ilości partii i
koszt jednostkowy, zachowując pozostały łączny koszt. Sprzedaż po splicie dalej
korzysta z FIFO. Korekta wcześniejszej ilości odtwarza także późniejsze splity.
Wynik wymagający ponad 10 miejsc ilości jest odrzucany i wymaga rozliczenia
ułamka/cash-in-lieu, którego ta wersja nie zgaduje. Kolejność w dniu musi
odpowiadać rzeczywistemu przebiegowi; konflikt wymaga korekty historii.

Zmiana zdarzenia przez dostawcę po jego potwierdzeniu jest oznaczana w panelu.
Nie powoduje drugiej wypłaty ani automatycznej zmiany rachunku. Użytkownik
sprawdza rzeczywiste rozliczenie i korzysta z istniejącego audytu korekt.
