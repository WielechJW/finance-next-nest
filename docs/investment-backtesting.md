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
