# Finance — nauka TypeScript, NestJS i Next.js

Jeden projekt, dwie aplikacje napisane w TypeScript:

- `frontend/` — Next.js z Reactem i App Routerem: strony i interfejs użytkownika.
- `backend/` — NestJS: API, logika aplikacji, a później komunikacja z bazą danych.

Na początek każda aplikacja ma własny `package.json` i `package-lock.json`.
`package.json` opisuje zależności i komendy, a `package-lock.json` zapisuje ich
dokładne wersje. Pliki lock należy dodawać do Gita.

## Wymagania

Node.js 24 LTS, npm i Git. Jeśli korzystasz z nvm, uruchom w tym folderze:

```bash
nvm install
nvm use
```

TypeScript i narzędzia frameworków są instalowane lokalnie z zależnościami.

## Instalacja po sklonowaniu repozytorium

W głównym katalogu projektu:

```bash
npm --prefix frontend ci
npm --prefix backend ci
```

## Uruchomienie podczas nauki

Otwórz dwa terminale w głównym katalogu projektu.

Terminal 1 — frontend:

```bash
npm --prefix frontend run dev
```

Otwórz http://localhost:3000. Zmień tekst w `frontend/src/app/page.tsx`, zapisz
plik i zobacz zmianę w przeglądarce.

Terminal 2 — backend:

```bash
npm --prefix backend run start:dev
```

Otwórz http://localhost:3001 — API odpowiada `Hello World!`.
Możesz też sprawdzić je komendą `curl http://localhost:3001`.
Zmiany w kodzie automatycznie restartują backend. `Ctrl+C` zatrzymuje aplikację.

Obie aplikacje uruchamiasz osobno. Połączenie frontendu z API będzie kolejnym
ćwiczeniem.

## Od których plików zacząć

| Plik | Za co odpowiada |
| --- | --- |
| `frontend/src/app/page.tsx` | Strona główna i komponent Reacta. |
| `frontend/src/app/layout.tsx` | Wspólny układ stron i metadane. |
| `backend/src/main.ts` | Uruchomienie serwera NestJS na porcie 3001. |
| `backend/src/app.module.ts` | Rejestracja kontrolerów i serwisów. |
| `backend/src/app.controller.ts` | Obsługa adresów API i metod HTTP. |
| `backend/src/app.service.ts` | Logika wywoływana przez kontroler. |

## Sprawdzenie projektu

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run test:e2e
npm --prefix backend run build
```

## Codzienna praca z Gitem

```bash
git status
git add frontend/src/app/page.tsx
git commit -m "Change home page text"
git push
```

Nie dodawaj `node_modules`, wyników kompilacji ani lokalnych plików `.env` —
chroni przed tym główny `.gitignore`.

## Proponowana kolejność nauki

1. TypeScript: typy, obiekty, tablice, funkcje, interfejsy i `async/await`.
2. NestJS: prześledź żądanie od kontrolera do serwisu. Dodaj `GET /transactions`
   zwracające tablicę kilku przykładowych transakcji z pamięci.
3. Next.js i React: komponenty, propsy, stan i pobieranie danych z API.
4. Dodaj tworzenie transakcji, walidację danych i obsługę błędów.
5. Gdy API działa, dołącz PostgreSQL i zapis danych.

## Dokumentacja

- [TypeScript — podstawy](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
- [NestJS — pierwsze kroki](https://docs.nestjs.com/first-steps)
- [Next.js — instalacja i start](https://nextjs.org/docs/app/getting-started/installation)
