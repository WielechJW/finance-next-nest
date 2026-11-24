# Testy historyczne strategii

Symulator odtwarza kolejne sesje z kalendarza giełdy. Wejście zawiera datę
sesji, chwilę decyzji po publikacji kursu oraz surową cenę otwarcia i ilość
osiągalną po tej cenie. Brak otwarcia przekazuje się jako pustą obserwację.
Liczby opisują model wykonania i zachowują dokładność dziesiętną.

Najpierw symulator rozpatruje oczekujące zlecenie na otwarciu, a po zamknięciu
wywołuje tę samą strategię co analiza bieżąca. Przekazuje ceny i splity
znane do chwili decyzji. Wcześniejsze sesje mogą rozgrzać średnie. Stan
rachunku pochodzi z operacji wykonanych do tego momentu.

Sygnał w terminie ważności składa zlecenie testowe. Zlecenie oczekuje na
kolejną sesję, także po dniu wolnym. Model bierze podaną cenę otwarcia,
sprawdza płynność, gotówkę i posiadane akcje. Stała ilość jest wykonywana
w całości. Bez otwarcia zlecenie może oczekiwać określoną liczbę sesji,
a po jej upływie zapisuje odrzucenie. Po końcu zakresu pozostałe zlecenie
wygasa.

Przykład z gotówką 1000 USD. Przecięcie średnich po zamknięciu w czwartek
składa zlecenie kupna 2 akcji. Przy surowym otwarciu w piątek 130 USD i ilości
dostępnej co najmniej 2 model zapisuje 2 akcje i 740 USD gotówki. Jeśli piątek
nie ma notowania, a limit obejmuje dwie sesje, następna próba może przypaść
w poniedziałek.

## Koszty i rachunek testowy

W modelu można ustawić prowizję stałą, prowizję od wartości, spread i
poślizg w punktach bazowych. Kupno podwyższa cenę o połowę spreadu i poślizg.
Sprzedaż obniża cenę o tę samą korektę względną. Prowizja uwzględnia wartość
po tej zmianie. Gotówka i partie FIFO używają operacji z rejestru inwestycji.

Saldo początkowe może obejmować PLN i USD. FX jest jawnym zdarzeniem z
kwotami obu walut, datą i ewentualną opłatą. W dniu sesji FX jest księgowany
przed wykonaniem i może zasilić zakup. Do zakupu potrzeba gotówki w walucie
instrumentu również na prowizję.

Dla cen surowych split zmienia ilość przed otwarciem w dniu zdarzenia.
Informacja o splicie musi być dostępna przed początkiem tej daty UTC.
Dywidenda nalicza uprawnienie według stanu przed sesją bez prawa, a gotówka
jest dostępna od daty wypłaty i publikacji danych. Jeśli wypłata wypada
w dzień wolny, model dolicza ją na kolejnej sesji. Model cen skorygowanych
odrzuca jednoczesne księgowanie dywidend lub splitów. Cena otwarcia, zamknięcie
i ilości muszą pochodzić z wybranej bazy cen. Dla zlecenia po splicie model
stosuje stałą ilość jednostek z ustawień.

## Raport i próba poza okresem doboru

W panelu strategii wgraj plik JSON według przykładu **Pobierz próbkę JSON z
danymi testowymi**. Do jego ręcznego odtworzenia utwórz strategię dla
instrumentu XNAS w USD z oknami dwóch i trzech sesji. Zakup dwóch akcji po
130 USD z prowizją 2 USD pozostawia 738 USD. Przy zamknięciu 140 USD kapitał
wynosi 1018 USD, a przy następnym zamknięciu 100 USD spada do 938 USD. Wynik
wynosi −62 USD, a maksymalne obsunięcie 7,8585%.

Benchmark `same-instrument-buy-and-hold` składa jeden zakup tego samego
instrumentu po pierwszej sesji z kursem zamknięcia i gotówką. Używa takiej
samej ilości, warunków otwarcia, kosztów, waluty i polityki zdarzeń. Wykres
pokazuje kapitał obu prób na zakończenie sesji. Ekspozycja jest średnią
odsetka kapitału w akcjach. Obrót jest sumą wartości wykonanych transakcji
bez prowizji. FX wyceny pochodzi z informacji dostępnych do końca sesji i
może mieć do siedmiu dni kalendarzowych. Przy luce raport zaznacza brak
ceny lub przeliczenia i nie podaje maksymalnego obsunięcia ani średniej
ekspozycji całego okresu.

Użyj `"phase": "DEVELOPMENT"` przy doborze parametrów. Do późniejszego testu
ustaw `"phase": "OUT_OF_SAMPLE"`, dodaj `baselineId` wcześniejszej zakończonej
próby tej samej strategii i wybierz okres zaczynający się po jej zakończeniu.
Test użyje wersji parametrów z wcześniejszej próby. Nieudane obliczenia
zostają zapisane wraz z przyczyną oraz identyfikatorem zestawu wejściowego.
