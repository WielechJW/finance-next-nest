# Zakładka analityki — etap 4.4 (#25)

`/dashboard/analytics` łączy [trzy endpointy analityki](analytics-api.md)
w chroniony widok. Link **Analityka** w nawigacji wskazuje aktywną zakładkę.

## Okres i podział trendu

Domyślny okres to cały bieżący miesiąc według `Europe/Warsaw`. Przyciski
**Bieżący miesiąc** i **Poprzedni miesiąc** stosują zakres od razu.
**Własny zakres** udostępnia obie daty; szkic dat i podział **Dziennie** lub
**Miesięcznie** zatwierdza przycisk **Zastosuj**. Wszystkie raporty otrzymują
te same wliczane granice `from` i `to`.

Nieistniejące lub odwrócone daty oraz więcej niż 366 dni albo 120 miesięcy
są odrzucane przed pobieraniem raportów. Błąd zachowuje poprzedni poprawny
raport i pokazuje komunikat przy filtrach. Powyżej 366 dni można wybrać
podział miesięczny.

Zatwierdzony zakres i podział trafiają do parametrów adresu. Odświeżenie
strony, powrót przyciskiem Wstecz i ponowne sprawdzenie sesji zachowują
ten wybór, ale ponownie pobierają dane. Nieprawidłowy zakres z ręcznie
zmienionego adresu wybiera domyślny miesiąc, widoczny nad raportem.

## Karty i wykresy

Trzy karty pokazują przychody, wydatki i wynik okresu w PLN. Wynik to
przychody minus wydatki; nie obejmuje salda początkowego ani operacji
spoza okresu. Globalne saldo pozostaje w zakładce Portfel.

Poziomy wykres słupkowy pokazuje kategorie wydatków, a dwie linie —
przychody i wydatki w czasie. Legenda rozróżnia je tekstem, kolorem
i stylem linii. Dymki zachowują oryginalne kwoty. Pod wykresami są
rozwijane tabele **Pokaż dane kategorii** i **Pokaż dane trendu**,
dostępne również z klawiatury. Tabele mają podpisy, nagłówki i wartości
PLN; szeroką tabelę można przewijać w jej własnym obszarze.

Wykresy korzystają z Recharts 3.10.1 oraz react-is 19.3.0, zgodnego z wersją
Reacta w projekcie. Kwoty z API pozostają stringami. Karty, tabele i dymki
używają dokładnego `formatPLN`, a walidacja sum korzysta z całkowitych
groszy `BigInt`. Tylko geometria wykresu korzysta ze skończonych,
znormalizowanych współrzędnych liczbowych. Nie wyliczamy z nich kwot.

Pusty okres daje zerowe karty, komunikat o braku wydatków i pełny trend
zerowy. Okres bez wydatków, ale z przychodami, nadal pokazuje przychody.
Procenty kategorii są prezentacyjne i mogą sumować się do wartości
różnej od 100% ze względu na zaokrąglenie.

## Pobieranie, błędy i sesja

Podsumowanie, kategorie i trend są pobierane równolegle, z niezależnymi
stanami ładowania i błędów. Przycisk ponowienia odczytuje tylko błędną
sekcję. Pozostałe poprawne sekcje pozostają dostępne.

Nowy zatwierdzony filtr natychmiast ukrywa poprzednie wartości i anuluje
stare zapytania. Numer kolejnego wyboru oraz kontrola anulowania chronią
również sekwencję A → B → A i spóźnione odpowiedzi. Klient sprawdza
rzeczywiście zwrócone granice, walutę, kwoty i kompletną serię trendu.

Zmiana użytkownika usuwa stan raportów i anuluje żądania starego konta.
Odpowiedź `401` korzysta ze wspólnej obsługi sesji i przekierowania do
logowania. Istniejący mechanizm sesji sprawdza ją po zmianie trasy,
odzyskaniu fokusu i przywróceniu strony; raporty są wtedy pobierane ponownie.
Powrót z Transakcji uwzględnia zapisaną edycję i usunięcie operacji.

## Weryfikacja

```bash
npm --prefix frontend run lint
npm --prefix frontend test -- --maxWorkers=2
npm --prefix frontend run build
npm --prefix backend run test:browser:typecheck
npm --prefix backend run test:browser -- analytics.pw.ts transaction-mutations.pw.ts auth-session.pw.ts
```

Testy klienta i komponentów pokrywają wspólne filtry, walidację odpowiedzi,
duże dokładne kwoty, puste dane, częściowe błędy, ponowienie jednej sekcji,
wyścigi żądań, odtworzenie zakresu i zmianę konta. Scenariusze Chromium
korzystają z prawdziwego Next.js, NestJS i oddzielnej bazy przeglądarkowej.
Sprawdzają oba wykresy, tabele, presety, zakres własny, opóźnioną odpowiedź,
powrót po mutacji, wygaśnięcie sesji oraz ekran 375 px i klawiaturę.

Ręcznie dodaj w bieżącym miesiącu przychód `50.20` i wydatek `20.10`,
a saldo początkowe ustaw na `100.00`. Analityka pokaże wynik `30.10`,
a Portfel saldo `130.10`. Zmień wydatek na `30.10` i wróć do analityki:
wynik wyniesie `20.10`. Po usunięciu wydatku wynik wyniesie `50.20`.
