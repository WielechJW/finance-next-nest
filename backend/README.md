# Backend — NestJS

API w TypeScript. Projekt używa modułów ESM i Vitest do testów.

Z głównego katalogu projektu:

```bash
npm --prefix backend run start:dev
```

Otwórz http://localhost:3001. Domyślny endpoint `GET /` odpowiada `Hello World!`.
Port można zmienić zmienną środowiskową `PORT`.

Zacznij od `src/app.controller.ts` i `src/app.service.ts`.
Pliki importowane lokalnie mają rozszerzenie `.js` w importach — to konwencja
ESM używana przez TypeScript podczas kompilacji do JavaScript.

Pełna instrukcja instalacji i nauki: [główny README](../README.md).

[Dokumentacja NestJS](https://docs.nestjs.com/first-steps)
