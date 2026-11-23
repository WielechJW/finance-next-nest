# Raporty wzorcowe do analizy fundamentalnej

Zestaw obejmuje po pięć raportów z GPW i USA. W tabeli `wartość (strona)`
numery stron liczymy od początku pliku PDF. Kwoty zachowują skalę i symbol
waluty ze źródła. Dług długoterminowy pochodzi z bilansu na dzień wskazany
w ostatniej kolumnie. Kreska oznacza brak pozycji pasującej do definicji.
Zysk netto w raporcie PKO obejmuje udziały niesprawujące kontroli.

| Emitent, okres i zakres | Jednostka | Przychody | EBIT | Zysk netto | Przepływy operacyjne | Dług długoterminowy i dzień bilansowy |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Apple, 2026, skonsolidowany [apple.pdf](https://d18rn0p25nwr6d.cloudfront.net/CIK-0000320193/16fd0081-220e-4209-9531-d395a65dd3c7.pdf#page=35) | mln $ | 478 834 (35) | 158 063 (35) | 132 175 (35) | 145 097 (39) | 68 208 (37), 26.09.2026 |
| Amazon, 2025, skonsolidowany [amazon.pdf](https://s2.q4cdn.com/299287126/files/doc_financials/2026/ar/Amazon-2025-Annual-Report.pdf#page=48) | mln $ | 716 924 (48) | 79 975 (48) | 77 670 (48) | 139 514 (47) | 65 648 (50), 31.12.2025 |
| AMD, 2025, skonsolidowany [amd.pdf](https://ir.amd.com/financial-information/sec-filings/content/0000002488-26-000018/0000002488-26-000018.pdf#page=61) | mln $ | 34 639 (61) | 3 694 (61) | 4 335 (61) | 7 709 (65) | 2 348 (63), 27.12.2025 |
| Target, 2025, skonsolidowany [target.pdf](https://corporate.target.com/getmedia/79214b4b-6331-4b1c-b76f-acff121b40f9/2025-Annual-Report-Target-Corporation.pdf#page=51) | mln $ | 104 780 (51) | 5 117 (51) | 3 705 (51) | 6 562 (54) | 14 326 (53), 31.01.2026 |
| Target, 2024, skonsolidowany [target-2024.pdf](https://corporate.target.com/getmedia/c23bca62-1790-47bd-ad0e-6971aee4f78d/2024-Annual-Report-Target-Corporation.pdf#page=49) | mln $ | 106 566 (49) | 5 566 (49) | 4 091 (49) | 7 367 (52) | 14 304 (51), 01.02.2025 |
| Grupa Kęty, 2025, skonsolidowany [kety.pdf](https://grupakety.com/wp-content/uploads/2026/03/Grupa_Kety_skonsolidowane_sprawozdanie__finansowe_2025_dokumentnieoficjalny.pdf#page=5) | mln PLN | 5 494 (5) | 784 (5) | 569 (5) | 937 (11) | — |
| KGHM, 01.01.2025–31.12.2025, skonsolidowany [kghm.pdf](https://kghm.com/sites/default/files/2026-03/Skonsolidowane%20Sprawozdanie%20Finansowe%20KGHM%20SRR_2025.pdf#page=5) | mln PLN | 36 366 (5) | — | 3 688 (5) | 4 035 (7) | — |
| CD PROJEKT, 01.01.2025–31.12.2025, skonsolidowany [cdprojekt-group.pdf](https://www.cdprojekt.com/pl/wp-content/uploads-pl/2026/03/skonsolidowane-sprawozdanie-finansowe-grupy-cd-projekt-za-2025-r.pdf#page=5) | tys. PLN | 866 989 (5) | 470 648 (5) | 594 708 (5) | 590 880 (10) | — |
| CD PROJEKT, 01.01.2025–31.12.2025, jednostkowy [cdprojekt-company.pdf](https://www.cdprojekt.com/pl/wp-content/uploads-pl/2026/03/jednostkowe-sprawozdanie-finansowe-cd-projekt-za-2025-r.pdf#page=5) | tys. PLN | 866 989 (5) | 477 988 (5) | 635 209 (5) | 567 948 (9) | — |
| PKO BP, 2025, skonsolidowany [pko.pdf](https://www.pkobp.pl/api/public/9d7148e7-ddaf-4157-bb83-cb7956355adb.pdf#page=6) | mln PLN | — | — | 10 682 (6) | 11 852 (11) | — |

Testy domyślne sprawdzają odczyt tabel na krótkich, syntetycznych dokumentach.
Aby sprawdzić pełne raporty, pobierz PDF-y do jednego katalogu pod nazwami
z tabeli i podaj jego bezwzględną ścieżkę. Pliki pozostają lokalne.

~~~bash
FUNDAMENTAL_REPORT_FIXTURES_DIR=/ścieżka/do/raportów \
  npm --prefix backend test -- src/fundamental-analysis/report-summary.spec.ts
~~~

Testy porównują wartości, ich okresy, jednostki, zakres konsolidacji i strony.
Sprawdzają również dobór stron dla modelu oraz odczyt najnowszego roku przy
rosnącej i malejącej kolejności kolumn. Raporty CD PROJEKT mają ten sam okres
i pozwalają sprawdzić różnicę między danymi grupy i jednostki.
