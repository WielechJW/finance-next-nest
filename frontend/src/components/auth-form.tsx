"use client";

import Link from "next/link";
import { useState, type SyntheticEvent, type SubmitEvent } from "react";
import styles from "./auth-form.module.css";

type FieldName = "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isValid, setIsValid] = useState(false);

  function handleChange(event: SyntheticEvent<HTMLFormElement>) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;

    setIsValid(false);
    setErrors((current) => ({
      ...current,
      [field.name]: undefined,
      ...(field.name === "password" ? { confirmPassword: undefined } : {}),
    }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.namedItem("email") as HTMLInputElement;
    const formData = new FormData(form);
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");
    const nextErrors: FieldErrors = {};

    if (!email.value.trim()) {
      nextErrors.email = "Podaj adres e-mail.";
    } else if (email.validity.typeMismatch) {
      nextErrors.email = "Podaj poprawny adres e-mail, np. anna@example.com.";
    }

    if (!password) {
      nextErrors.password = "Podaj hasło.";
    }

    if (isRegister) {
      if (!confirmPassword) {
        nextErrors.confirmPassword = "Powtórz hasło.";
      } else if (password !== confirmPassword) {
        nextErrors.confirmPassword = "Hasła nie są zgodne.";
      }
    }

    setErrors(nextErrors);
    const firstInvalidField = (Object.keys(nextErrors) as FieldName[])[0];
    setIsValid(!firstInvalidField);

    if (firstInvalidField) {
      requestAnimationFrame(() => {
        (form.elements.namedItem(firstInvalidField) as HTMLInputElement).focus();
      });
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-heading">
        <p className={styles.brand}>Finance</p>
        <h1 id="auth-heading">{isRegister ? "Rejestracja" : "Logowanie"}</h1>
        <p className={styles.intro}>
          {isRegister
            ? "Utwórz konto, aby prowadzić swój portfel."
            : "Zaloguj się do swojego portfela."}
        </p>

        <form
          className={styles.form}
          method="post"
          noValidate
          onSubmit={handleSubmit}
          onChange={handleChange}
        >
          <div className={styles.field}>
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
            {errors.email && (
              <p id="email-error" className={styles.error}>{errors.email}</p>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="password">Hasło</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
            />
            {errors.password && (
              <p id="password-error" className={styles.error}>{errors.password}</p>
            )}
          </div>

          {isRegister && (
            <div className={styles.field}>
              <label htmlFor="confirmPassword">Powtórz hasło</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
              />
              {errors.confirmPassword && (
                <p id="confirm-password-error" className={styles.error}>
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          )}

          <div role="alert" aria-atomic="true">
            {Object.values(errors).some(Boolean) && (
              <p className={styles.error}>Popraw zaznaczone pola.</p>
            )}
          </div>

          <button type="submit">{isRegister ? "Zarejestruj się" : "Zaloguj się"}</button>

          <div role="status" aria-atomic="true">
            {isValid && (
              <p className={styles.success}>
                Formularz wypełniony poprawnie.{" "}
                {isRegister
                  ? "Rejestracja kont będzie dostępna wkrótce."
                  : "Logowanie będzie dostępne wkrótce."}
              </p>
            )}
          </div>
        </form>

        <p className={styles.footer}>
          {isRegister ? "Masz już konto? " : "Nie masz konta? "}
          <Link href={isRegister ? "/login" : "/register"}>
            {isRegister ? "Zaloguj się" : "Zarejestruj się"}
          </Link>
        </p>
      </section>
    </main>
  );
}
