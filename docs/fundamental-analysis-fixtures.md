# Raporty wzorcowe do analizy fundamentalnej

Zestaw obejmuje dwa raporty z GPW i dwa z USA. Numery stron oznaczają pozycję
strony w pliku PDF, liczoną od 1. W raportach z USA jednostka zachowuje symbol
dolara widoczny na stronie rachunku wyników.

| Emitent i okres | Strona PDF | Jednostka | Przychody | EBIT | Zysk netto | Plik testowy |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Apple, rok obrotowy 2026 | 35 | mln $ | 478 834 | 158 063 | 132 175 | [apple.pdf](https://d18rn0p25nwr6d.cloudfront.net/CIK-0000320193/16fd0081-220e-4209-9531-d395a65dd3c7.pdf#page=35) |
| Amazon, rok obrotowy 2025 | 48 | mln $ | 716 924 | 79 975 | 77 670 | [amazon.pdf](https://s2.q4cdn.com/299287126/files/doc_financials/2026/ar/Amazon-2025-Annual-Report.pdf#page=48) |
| Grupa Kęty, rok obrotowy 2025 | 5 | mln PLN | 5 494 | 784 | 569 | [kety.pdf](https://grupakety.com/wp-content/uploads/2026/03/Grupa_Kety_skonsolidowane_sprawozdanie__finansowe_2025_dokumentnieoficjalny.pdf#page=5) |
| KGHM, 01.01.2025–31.12.2025 | 5 | mln PLN | 36 366 | Brak pozycji w tabeli | 3 688 | [kghm.pdf](https://kghm.com/sites/default/files/2026-03/Skonsolidowane%20Sprawozdanie%20Finansowe%20KGHM%20SRR_2025.pdf#page=5) |

Testy domyślne sprawdzają odczyt tabel na krótkich, syntetycznych dokumentach.
Aby sprawdzić pełne raporty, pobierz PDF-y do jednego katalogu pod nazwami
z tabeli i podaj jego bezwzględną ścieżkę. Pliki pozostają lokalne.

~~~bash
FUNDAMENTAL_REPORT_FIXTURES_DIR=/ścieżka/do/raportów \
  npm --prefix backend test -- src/fundamental-analysis/report-summary.spec.ts
~~~

Testy porównują trzy wartości, ich okresy, jednostki i numery stron.
Zestaw sprawdza również wybór najnowszego roku przy rosnącej i malejącej
kolejności kolumn oraz zachowanie przy braku osobnej pozycji EBIT.
