"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Brand } from "@/components/Brand";

export function CompanyRegister() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", address: "", phone: "", email: "", password: "", cityTier: "SMALL" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/companies/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registrierung fehlgeschlagen.");
        setLoading(false);
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Netzwerkfehler.");
      setLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-white p-5">
      <div className="pointer-events-none absolute inset-0 bg-hero-yellow" />
      <div className="pointer-events-none absolute -right-32 -top-10 h-80 w-80 rounded-full bg-brand-300 opacity-30 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Brand subtitle="Taxiunternehmen registrieren" />
        </div>
        <form
          onSubmit={submit}
          data-testid="company-register-form"
          className="grid gap-4 rounded-3xl border border-ink-100 bg-white p-7 shadow-card"
        >
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-900">
            Firma kostenlos anlegen
          </h1>
          <p className="-mt-2 text-sm text-ink-500">
            In 60 Sekunden startklar – sofort eigener Kunden-Buchungslink.
          </p>

          <div>
            <label className="label">Firmenname *</label>
            <input
              className="field"
              data-testid="register-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input
              className="field"
              data-testid="register-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Straße, PLZ Ort"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Telefon</label>
              <input
                className="field"
                data-testid="register-phone"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
            <div>
              <label className="label">E-Mail *</label>
              <input
                className="field"
                data-testid="register-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">Passwort * (min. 6 Zeichen)</label>
            <input
              className="field"
              data-testid="register-password"
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div>
            <label className="label">Einsatzgebiet *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="register-citytier-small"
                onClick={() => set("cityTier", "SMALL")}
                className={`rounded-2xl border p-3 text-left transition ${
                  form.cityTier === "SMALL"
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                }`}
              >
                <p className="font-display text-base font-extrabold">Klein­stadt / Land</p>
                <p className="mt-0.5 text-xs opacity-80">5 % Vermittlungsgebühr</p>
              </button>
              <button
                type="button"
                data-testid="register-citytier-big"
                onClick={() => set("cityTier", "BIG")}
                className={`rounded-2xl border p-3 text-left transition ${
                  form.cityTier === "BIG"
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                }`}
              >
                <p className="font-display text-base font-extrabold">Großstadt</p>
                <p className="mt-0.5 text-xs opacity-80">7 % Vermittlungsgebühr</p>
              </button>
            </div>
          </div>
          {error && (
            <p data-testid="register-error" className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          <button data-testid="register-submit" className="btn-primary mt-2" disabled={loading}>
            {loading ? "Wird erstellt …" : "Account erstellen"}
          </button>
          <p className="text-center text-sm text-ink-500">
            Bereits registriert?{" "}
            <Link href="/admin/login" className="font-bold text-brand-700 hover:underline">Anmelden</Link>
          </p>
        </form>
        <p className="mt-6 text-center text-xs text-ink-400">
          <Link href="/" className="hover:text-ink-700">← Zurück zur Startseite</Link>
        </p>
      </div>
    </main>
  );
}
