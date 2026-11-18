# Dane rynkowe — wersja B

Backend przechowuje wspólny katalog GPW/USA i mapowania EODHD. Prywatne
portfele odwołują się do trwałego ID instrumentu. Zmiana symbolu po zgodnym
ISIN zachowuje ID; niejednoznaczna tożsamość lub zmiana waluty wymaga sprawdzenia.
Import obejmuje akcje PLN na GPW i akcje USD na rozpoznanych giełdach USA;
OTC, inne waluty i nieznane MIC są pomijane, a nie zgadywane.

`GET /market-data/instruments?q=PKO&mic=XWAR&page=1&pageSize=25` wymaga sesji.
Zwraca `items`, `total`, `page`, `pageSize`. Wyszukiwanie obejmuje symbol,
nazwę i ISIN, a dane pochodzą wyłącznie z PostgreSQL. Maksymalna strona ma
100 pozycji. Endpoint nie udostępnia tokenu ani mapowań dostawcy.

Po migracji i buildzie katalog synchronizuje operator:

```bash
npm --prefix backend run prisma:deploy
npm --prefix backend run build
npm --prefix backend run market-data:catalog -- --execute
```

`EODHD_API_TOKEN` ustawiamy w ignorowanym `backend/.env`. Opcjonalne
`EODHD_DAILY_BUDGET` ma zakres 1–20 i domyślnie wynosi 20. Każdy odczyt
danych sprawdza bezpłatny endpoint użycia, a PostgreSQL atomowo rezerwuje
jednostkę dla klucza i dnia UTC. Licznik nie cofa się po błędzie ani restarcie.
Uwzględniamy także zużycie poza aplikacją. Nie korzystamy z bonusowych jednostek.
Rezerwacje utrzymują odstęp 3,2 s, a 402/429 blokuje kolejne próby na czas
ochłonięcia. Brak klucza nie uniemożliwia działania ręcznego portfela.

Synchronizacja katalogów kosztuje dwie jednostki. Nie jest wykonywana przy
starcie API ani przy otwarciu panelu. Testy używają wymyślonych danych.
JSON dostawcy parsujemy z zachowaniem oryginalnych cyfr liczb (Node 24),
a liczby rynkowe przechodzą walidację Decimal przed zapisem.
