# Strategie sygnałowe

Reguła `daily-sma-crossover` w wersji kodu `1` porównuje dwie średnie proste
z końcowych cen sesji tego samego instrumentu. W `fastSessions` podaj co najmniej
2 sesje. `slowSessions` ma być większe od szybkiego okna i nie większe niż 250.
`validForMinutes` określa ważność sygnału od 1 do 1440 minut.

Do wyniku potrzeba `slowSessions + 1` kolejnych sesji z ceny surowej. Dodatkowa
sesja pozwala policzyć obie średnie również dla poprzedniego dnia. Reguła
wybiera ostatnią rewizję, którą system znał w chwili decyzji, i oczekuje ceny
z ostatniej wymaganej sesji. Sesje są ustalane według kalendarza giełdowego.

| Warunek | Wynik |
| --- | --- |
| Szybka średnia przechodzi ponad długą, brak pozycji i jest gotówka w walucie instrumentu | `BUY` |
| Szybka średnia przechodzi poniżej długiej, rachunek posiada akcje | `SELL` |
| Średnie są po tej samej stronie lub stan rachunku wyklucza sygnał | Brak sygnału |
| Kurs jest opóźniony, brakuje sesji, kalendarza lub cena jest niepoprawna | Brak sygnału z przyczyną |
| W oknie surowych cen wypada znany split | Brak sygnału do czasu przesunięcia okna |

Sygnał podaje instrument, kierunek, datę decyzji, ostatnią wymaganą sesję,
przyczynę, termin ważności, średnie i identyfikatory użytych rewizji cen.
Posiadana ilość i dostępna gotówka pochodzą ze stanu rachunku w chwili decyzji.

## Wersje i historia decyzji

Zapis strategii wyznacza rachunek i instrument. Zmiana parametrów tworzy
kolejny numer wersji. Wersja użyta do uruchomienia zachowuje ustawienia
oraz identyfikator kodu. Uruchomienie zapisuje gotówkę, ilość, identyfikatory
operacji, ceny i rewizje dostępne do podanego czasu. Dla chwil historycznych
aplikacja wybiera zapisy według czasu ich pozyskania i uwzględnia starsze
wersje rejestru sprzed późniejszych korekt.

Ponowienie uruchomienia dla tej samej wersji i chwili zwraca zapisany wynik.
Operacja odtworzenia używa poprzedniego zestawu danych i jego parametrów.
Identyfikator uruchomienia i ewentualnego sygnału są widoczne na koncie
właściciela rachunku.

## Harmonogram i powiadomienia

Włączona strategia otrzymuje jedno zadanie na wersję i sesję. Worker oczekuje
kompletnego okna cen i zakończonej synchronizacji splitów. Zadanie ponawia się
co pięć minut, gdy brakuje danych. Jeśli nadejdzie kolejna sesja, poprzednie
zadanie zapisuje brak decyzji z przyczyną. Blokada rachunku i strategii oraz
identyfikator wersji i sesji chronią przed powtórzeniem.

Powiadomienia o sygnałach można włączyć dla wybranej strategii. Kanał Telegram
korzysta z istniejącej kolejki i zasad ponawiania. Po utracie połączenia,
wyłączeniu strategii lub wygaśnięciu sygnału powiadomienie zostaje anulowane.
