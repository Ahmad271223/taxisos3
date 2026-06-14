"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Brand } from "@/components/Brand";

interface Props {
  role: "DRIVER" | "ADMIN";
  redirectTo: string;
  title: string;
  hint?: string;
  identifierLabel?: string;
  identifierType?: string;
  showRegister?: boolean;
}

export function LoginForm({
  role,
  redirectTo,
  title,
  hint,
  identifierLabel = "Benutzername",
  identifierType = "text",
  showRegister,
}: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Anmeldung fehlgeschlagen.");
        setLoading(false);
        return;
      }
      // Super-Admin landet auf eigener Seite.
      if (data.role === "SUPER_ADMIN") {
        router.replace("/super-admin");
      } else {
        router.replace(redirectTo);
      }
    } catch {
      setError("Netzwerkfehler.");
      setLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-white p-5">
      <div className="pointer-events-none absolute inset-0 bg-hero-yellow" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-brand-200 opacity-40 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand subtitle={title} />
        </div>
        <form
          onSubmit={submit}
          data-testid={role === "ADMIN" ? "admin-login-form" : "driver-login-form"}
          className="grid gap-4 rounded-3xl border border-ink-100 bg-white p-7 shadow-card"
        >
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-900">
            Willkommen zurück
          </h1>
          <div>
            <label className="label">{identifierLabel}</label>
            <input
              className="field"
              data-testid="login-identifier"
              type={identifierType}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">Passwort</label>
            <input
              className="field"
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p data-testid="login-error" className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          <button data-testid="login-submit" className="btn-primary mt-1" disabled={loading}>
            {loading ? "Anmelden …" : "Anmelden"}
          </button>
          {hint && <p className="text-center text-xs text-ink-400">{hint}</p>}
          {showRegister && (
            <p className="text-center text-sm text-ink-500">
              Noch kein Account?{" "}
              <Link href="/registrieren" className="font-bold text-brand-700 hover:underline">
                Firma registrieren
              </Link>
            </p>
          )}
        </form>
        <p className="mt-6 text-center text-xs text-ink-400">
          <Link href="/" className="hover:text-ink-700">← Zurück zur Startseite</Link>
        </p>
      </div>
    </main>
  );
}
