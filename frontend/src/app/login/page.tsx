"use client";

import Link from "next/link";

export default function LoginPage() {
    return (
        <main>
            <h1>Logowanie</h1>
            <p>Zaloguj się do swojego portfela.</p>

            <form
                method="post"
                onSubmit={(event) => {
                    event.preventDefault();
                }}
            >
                <div>
                    <label htmlFor="email">E-mail</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="password">Hasło</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                    />
                </div>

                <button type="submit">Zaloguj się</button>
            </form>

            <p>
                Nie masz konta? <Link href="/register">Zarejestruj się</Link>
            </p>
        </main>
    );
}