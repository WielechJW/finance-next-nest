"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
  type SubmitEvent,
} from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import { authApi } from "@/lib/auth-api";
import { useSession } from "./session-provider";
import styles from "./auth-form.module.css";

type FieldName = "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

export default function AuthForm({
  mode,
  registered = false,
}: {
  mode: "login" | "register";
  registered?: boolean;
}) {
  const isRegister = mode === "register";
  const router = useRouter();
  const { store } = useSession();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  function handleChange(event: SyntheticEvent<HTMLFormElement>) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;

    setFormError("");
    setErrors((current) => ({
      ...current,
      [field.name]: undefined,
      ...(field.name === "password" ? { confirmPassword: undefined } : {}),
    }));
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const email = form.elements.namedItem("email") as HTMLInputElement;
    const formData = new FormData(form);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const nextErrors: FieldErrors = {};

    if (!email.value.trim()) {
      nextErrors.email = "Podaj adres e-mail.";
    } else if (email.validity.typeMismatch) {
      nextErrors.email = "Podaj poprawny adres e-mail, np. anna@example.com.";
    } else if (email.value.trim().length > 254) {
      nextErrors.email = "Adres e-mail może mieć najwyżej 254 znaki.";
    }

    if (!password) {
      nextErrors.password = "Podaj hasło.";
    } else if (isRegister && Array.from(password).length < 15) {
      nextErrors.password = "Hasło musi mieć co najmniej 15 znaków.";
    } else if (Array.from(password).length > 128) {
      nextErrors.password = "Hasło może mieć najwyżej 128 znaków.";
    }

    if (isRegister) {
      if (!confirmPassword) {
        nextErrors.confirmPassword = "Powtórz hasło.";
      } else if (password !== confirmPassword) {
        nextErrors.confirmPassword = "Hasła nie są zgodne.";
      }
    }

    setErrors(nextErrors);
    setFormError("");
    const firstInvalidField = (Object.keys(nextErrors) as FieldName[])[0];

    if (firstInvalidField) {
      requestAnimationFrame(() => {
        (
          form.elements.namedItem(firstInvalidField) as HTMLInputElement
        ).focus();
      });
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const data = { email: email.value.trim(), password };
      if (isRegister) {
        await authApi.register(data, requestController.signal);
        form.reset();
        router.replace("/login?registered=1");
      } else {
        await store.login(data, requestController.signal);
        form.reset();
        router.replace("/dashboard");
        router.refresh();
      }
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof ApiError && error.status === 409 && isRegister) {
        setErrors({ email: "Ten adres e-mail jest już zajęty." });
        requestAnimationFrame(() => email.focus());
      } else {
        setFormError(
          error instanceof ApiError
            ? error.message
            : "Nie udało się wysłać formularza. Spróbuj ponownie.",
        );
      }
    } finally {
      submitting.current = false;
      if (!requestController.signal.aborted) setIsSubmitting(false);
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
          aria-busy={isSubmitting}
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
              maxLength={254}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
            {errors.email && (
              <p id="email-error" className={styles.error}>
                {errors.email}
              </p>
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
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                [
                  isRegister ? "password-help" : "",
                  errors.password ? "password-error" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            {isRegister && (
              <p id="password-help" className={styles.hint}>
                Od 15 do 128 znaków. Możesz użyć spacji.
              </p>
            )}
            {errors.password && (
              <p id="password-error" className={styles.error}>
                {errors.password}
              </p>
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
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={
                  errors.confirmPassword ? "confirm-password-error" : undefined
                }
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
            {formError && <p className={styles.error}>{formError}</p>}
          </div>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isRegister
                ? "Tworzenie konta…"
                : "Logowanie…"
              : isRegister
                ? "Zarejestruj się"
                : "Zaloguj się"}
          </button>

          <div role="status" aria-atomic="true">
            {registered && !isRegister && (
              <p className={styles.success}>
                Konto zostało utworzone. Możesz się zalogować.
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
