"use client";

import Link from "next/link";
import { useState, type SubmitEvent } from "react";

export default function RegisterPage() {
    const [error, setError] = useState("");

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");

        const formData = new FormData(event.currentTarget);
        const password = formData.get("password");
        const confirmPassword = formData.get("confirmPassword");

        if (password !== confirmPassword) {
            setError("Hasła nie są zgodne.");
            return;
        }
    }

    return (
        <main>
            <h1>Rejestracja</h1>
            <p>Utwórz konto, aby prowadzić swój portfel.</p>

            <form
                method="post"
                onSubmit={handleSubmit}
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
                        autoComplete="new-password"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="confirmPassword">Powtórz hasło</label>
                    <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? "confirm-password-error" : undefined}
                    />
                </div>
                <p id="confirm-password-error" role="alert">
                    {error}
                </p>
                <button type="submit">Zarejestruj się</button>
            </form>

            <p>
                Masz już konto? <Link href="/login">Zaloguj się</Link>
            </p>
        </main>
    );
}