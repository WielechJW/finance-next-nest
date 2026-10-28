import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";

export const metadata: Metadata = {
  title: "Rejestracja — Finance",
};

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
