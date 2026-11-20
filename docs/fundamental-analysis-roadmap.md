# Plan rozwoju analizy fundamentalnej wspieranej przez lokalny model

Pierwsza wersja użytkowa ma zamieniać PDF w podsumowanie, które można
sprawdzić bezpośrednio w raporcie. Dopiero na sprawdzonych danych oprzemy
wskaźniki, porównania okresów i ocenę atrakcyjności ceny.

Obecne MVP odpowiada po polsku przez Qwen 3.5 w LM Studio lub Bionic. Obsługuje
jeden tekstowy PDF do 15 MB i 250 stron. Przy długim raporcie backend wybiera
fragmenty, a do kolejnego pytania dołącza trzy ostatnie tury rozmowy. Raport
i rozmowa są dostępne do odświeżenia lub opuszczenia strony. Na obecnym
stanowisku z WSL połączenie z Bionic korzysta z tymczasowego mostu.

Plan rozwija etap 8 platformy inwestycyjnej i wykorzystuje istniejący katalog
instrumentów oraz notowania po sesji. [Mapa rozwoju inwestycji](investment-roadmap.md#etap-8-analiza-fundamentalna-i-porównywanie-spółek), [API danych rynkowych](market-data-api.md)

## 1. Stabilne połączenie i zestaw raportów do testów

- Ustalić trwały sposób połączenia WSL z Bionic i sprawdzić go po restarcie.
  Dodać w zakładce **Analiza spółek** test połączenia z poziomu backendu oraz
  informację o wykrytym modelu.
- Rozróżnić niedostępny serwer, brak modelu, nieczytelny PDF, brak gotowej
  odpowiedzi i przekroczenie limitu czasu. Zbierać czas odczytu PDF i czas
  generacji oraz kody błędów. Treść raportów i rozmów trzymać poza logami.
- Przygotować 10 publicznych raportów tekstowych, po pięć z GPW i USA.
  Dobrać krótkie i długie dokumenty, tabele oraz raporty ze skalą „w tys.”
  i „w mln”. Dla każdego ręcznie zapisać 3–5 wartości, ich okresy i strony PDF.

**Etap jest ukończony, gdy** czat po restarcie WSL działa bez ręcznego
uruchamiania tymczasowego mostu, testy odtwarzają pustą odpowiedź Qwen
i najważniejsze błędy, a próbka raportów pozwala mierzyć trafność odczytu.

## 2. Podsumowanie ze sprawdzalnymi źródłami

- Pokazać kartę raportu z okresem, najważniejszymi liczbami, ryzykami i brakami
  danych. Zacząć od przychodów, EBIT, zysku netto, przepływów operacyjnych
  i zadłużenia. Osobno oznaczać dane skonsolidowane i jednostkowe.
- Przy każdej liczbie zapisać wartość, walutę, skalę, okres i stronę PDF.
  Odsyłacz powinien otwierać daną stronę. Backend sprawdza, czy wskazany
  fragment istnieje i potwierdza wartość. Rozbieżności między tabelą a opisem
  pokazywać do weryfikacji.
- Dla długich raportów najpierw dobierać strony zawierające sprawozdania
  i fragmenty związane z pytaniem. Pokazać użytkownikowi zakres stron użytych
  w analizie i umożliwić wskazanie stron do kolejnego pytania.

**Etap jest ukończony, gdy** każda główna liczba w karcie ma źródło do otwarcia.
Testy raportów sprawdzają zarówno poprawność pokazanych liczb, jak i to,
które dostępne wartości aplikacja pominęła. Brak danych ma osobny stan.

## 3. Wskaźniki i cena z istniejącego katalogu

- Użytkownik przypisuje raport do instrumentu po tickerze i giełdzie.
  W karcie pokazać kurs zamknięcia z istniejącego API, jego sesję, walutę,
  źródło i stan świeżości. Rozbieżność waluty raportu i notowania wymaga
  jawnego przeliczenia przed użyciem ich we wspólnym wskaźniku.
- Liczyć marżę EBIT i zmianę przychodów rok do roku w NestJS z wartości
  dziesiętnych. Dodać C/Z po uzyskaniu porównywalnego EPS z ostatnich
  12 miesięcy. Przy brakującym lub niedodatnim EPS pokazać powód braku C/Z.
- W odpowiedzi inwestycyjnej pokazywać kondycję spółki, argumenty dotyczące
  ceny i dane, które mogłyby zmienić ocenę. Qwen opisuje wnioski na podstawie
  faktów, obliczeń i daty kursu przekazanych przez backend.

**Etap jest ukończony, gdy** użytkownik może odtworzyć wynik ze źródłowych liczb.
Testy obejmują inną walutę notowania, brak kursu, nieaktualną cenę, ujemny zysk
i porównanie okresów o różnej długości.

## 4. Historia i porównanie raportów

- Przypisać zapisane raporty, analizy i notatki do konta użytkownika. Zapisane
  dokumenty mają informację o wersji i okresie. Usunięcie dokumentu usuwa
  również zapisany tekst służący do analizy.
- Przetwarzać PDF przy imporcie i wykorzystywać zapisany tekst w kolejnych
  pytaniach. Odpowiedź może cytować kilka dokumentów, podając nazwę raportu
  i numer strony przy każdym odsyłaczu.
- Zacząć od porównania tego samego okresu rok do roku dla jednej spółki.
  Pokazywać zmiany przychodów, marży, przepływów i zadłużenia wraz z oznaczeniem
  korekt raportu i nieporównywalnych okresów.

**Etap jest ukończony, gdy** po odświeżeniu można wrócić do zapisanej analizy
i porównać dwa raporty. Testy sprawdzają izolację kont, usuwanie dokumentu
oraz pochodzenie wartości używanych w porównaniu.

## 5. Rozszerzenia po weryfikacji jakości

| Rozszerzenie | Warunek i zakres |
| --- | --- |
| Lokalny OCR dla skanów | W zestawie prób są skany, których nie da się przeanalizować z warstwy tekstowej. Przy kwotach z OCR użytkownik może sprawdzić fragment oryginału. |
| Odpowiedź wyświetlana w trakcie generowania | Pomiar czasu pokazuje, że oczekiwanie utrudnia używanie długich raportów. Anulowanie kończy żądanie modelu. |
| Karta spółki, watchlista i portfel | Analiza jest przypisana do instrumentu. Z karty można otworzyć ostatnią analizę i sprawdzić udział pozycji w istniejącym portfelu. |
| Import raportów z oficjalnych źródeł | Ręczny import i wersjonowanie działają. Dla każdego źródła potwierdzono pokrycie rynku, limity i warunki wykorzystania. |
| Porównanie wielu spółek i scenariusze wyceny | Fakty i wskaźniki mają zweryfikowane okresy, źródła i jednostki. Założenia scenariuszy można zmienić i odtworzyć wynik. |

## Pierwsza iteracja

1. Sprawdzić trwałą konfigurację WSL i dodać status **Połączenie z modelem**.
2. Zebrać pierwsze cztery raporty wzorcowe i ręcznie opisać strony z wynikami.
3. Dostarczyć kartę jednego raportu z przychodami, EBIT, zyskiem netto
   i klikalnymi odsyłaczami do PDF. Sprawdzić pełny przepływ na Qwen 3.5.
