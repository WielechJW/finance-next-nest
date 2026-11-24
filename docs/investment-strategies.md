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
