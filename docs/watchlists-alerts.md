# Watchlisty i alerty — etap 6

Zakładka „Rynek i alerty” wyszukuje lokalny katalog, prowadzi własne watchlisty,
pokazuje datę i świeżość ceny oraz prowadzi do historii instrumentu. Listy i
reguły mają właściciela; każda modyfikacja sprawdza go ponownie w zapytaniu.
Limit to 10 list, 50 instrumentów na listę i 100 aktywnych/wyłączonych reguł.
Powtórne dodanie instrumentu do tej samej listy jest idempotentne.

API sesyjne: `GET/POST /watchlists`, `PATCH/DELETE /watchlists/:id`,
`POST /watchlists/:id/items`, `DELETE /watchlists/:id/items/:instrumentId`.
`GET/POST /price-alerts`, `PATCH /price-alerts/:id` z `active`,
`DELETE /price-alerts/:id` oraz `GET /price-alerts/events?page=1`.
Usunięcie reguły ją wyłącza i zachowuje historię zdarzeń. Usunięcie watchlisty
nie usuwa niezależnie utworzonych reguł alertów.

Reguła ma dodatni próg w walucie instrumentu, kierunek ABOVE/BELOW, tryb
ONCE/REARM i cooldown. Dotknięcie progu liczy się jako przekroczenie. Pierwsza
obserwacja jest bazą i nie wywołuje alarmu; przy aktualnej cenie baza jest
ustalana przy tworzeniu reguły. REARM wymaga powrotu na drugą stronę progu.
Przekroczenie podczas cooldown nie jest później wysyłane bez nowego uzbrojenia.
Włączenie wyłączonej reguły ustala nową bazę.

Silnik przyjmuje tylko świeży close ostatniej oczekiwanej sesji. Powtórzony
odczyt, stara cena i rewizja w tej samej sesji nie tworzą kolejnego alertu.
Blokada reguły i unikalność reguła/sesja chronią przed konkurującymi workerami.
`AlertEvent` i outbox `MarketJob` dla powiadomienia powstają w jednej transakcji.
Kolejka powiadomień pozostaje niewykonywana do skonfigurowania kanału dostarczenia.

Harmonogram obejmuje pozycje, watchlisty i instrumenty z aktywnymi alertami.
Najpierw odświeża posiadane akcje, potem najstarsze obserwacje. Przy limicie
Free nie wszystkie rozbudowane listy muszą być aktualizowane codziennie:
status ceny pozostaje jawny. Zaległe automatyczne zadanie dla nieaktualnej
sesji jest pomijane, aby nie zużywać budżetu na zastąpione odczyty.
Alerty są sprawdzane po sesji i nie są powiadomieniami intraday.
