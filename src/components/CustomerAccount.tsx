"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import { Brand } from "@/components/Brand";
import { PaymentMethods } from "@/components/PaymentMethods";
import { formatEuro, formatDateTime } from "@/lib/format";
import { TRACKING_LABEL } from "@/lib/status";
import type { MapMarker } from "@/components/Map";

const MiniMap = dynamicImport(() => import("@/components/Map"), { ssr: false });

type Tab = "login" | "register";

export function CustomerAccount() {
  const [me, setMe] = useState<any | null | undefined>(undefined); // undefined = lädt
  const [tab, setTab] = useState<Tab>("login");
  const [bookings, setBookings] = useState<any[]>([]);
  const [recurring, setRecurring] = useState<any[]>([]);
  const [profile, setProfile] = useState<any | null>(null);
  const [favorites, setFavorites] = useState<any[]>([]);

  const loadMe = useCallback(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setMe(d.customer ?? null))
      .catch(() => setMe(null));
  }, []);
  useEffect(() => loadMe(), [loadMe]);

  const loadRecurring = useCallback(() => {
    fetch("/api/recurring")
      .then((r) => (r.ok ? r.json() : { recurring: [] }))
      .then((d) => setRecurring(d.recurring ?? []))
      .catch(() => {});
  }, []);
  const loadFavorites = useCallback(() => {
    fetch("/api/favorites")
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((d) => setFavorites(d.favorites ?? []))
      .catch(() => {});
  }, []);
  const loadProfile = useCallback(() => {
    fetch("/api/customer/profile")
      .then((r) => (r.ok ? r.json() : { profile: null }))
      .then((d) => setProfile(d.profile ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (me?.role === "CUSTOMER") {
      fetch("/api/customer/bookings")
        .then((r) => (r.ok ? r.json() : { bookings: [] }))
        .then((d) => setBookings(d.bookings ?? []))
        .catch(() => {});
      loadRecurring();
      loadFavorites();
      loadProfile();
    }
  }, [me, loadRecurring, loadFavorites, loadProfile]);

  async function addFavorite(driverId: string) {
    await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driverId }) });
    loadFavorites();
  }
  async function removeFavorite(driverId: string) {
    await fetch(`/api/favorites?driverId=${driverId}`, { method: "DELETE" });
    loadFavorites();
  }
  async function saveEmergency(name: string, phone: string) {
    const r = await fetch("/api/customer/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emergencyContactName: name || null, emergencyContactPhone: phone || null }),
    });
    if (r.ok) setProfile((await r.json()).profile);
  }

  async function cancelRecurring(id: string) {
    await fetch(`/api/recurring/${id}`, { method: "DELETE" });
    loadRecurring();
  }

  async function logout() {
    await fetch("/api/auth/logout?scope=customer", { method: "POST" });
    setMe(null);
    setBookings([]);
    setRecurring([]);
    setFavorites([]);
    setProfile(null);
  }

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand href="/" subtitle="Mein Konto" />
          <Link href="/" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Startseite</Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        {me === undefined ? (
          <p className="text-center text-ink-500">Lädt …</p>
        ) : me?.role === "CUSTOMER" ? (
          <LoggedIn
            name={me.name}
            bookings={bookings}
            recurring={recurring}
            profile={profile}
            favorites={favorites}
            onLogout={logout}
            onCancelRecurring={cancelRecurring}
            onAddFavorite={addFavorite}
            onRemoveFavorite={removeFavorite}
            onSaveEmergency={saveEmergency}
          />
        ) : (
          <div className="card p-6" data-testid="customer-auth">
            <div className="mb-5 flex gap-2">
              <TabBtn active={tab === "login"} onClick={() => setTab("login")} testid="tab-login">Anmelden</TabBtn>
              <TabBtn active={tab === "register"} onClick={() => setTab("register")} testid="tab-register">Konto erstellen</TabBtn>
            </div>
            {tab === "login" ? <LoginForm onDone={loadMe} /> : <RegisterForm onDone={loadMe} />}
          </div>
        )}
      </div>
    </main>
  );
}

function TabBtn({ active, onClick, children, testid }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${active ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600"}`}
    >
      {children}
    </button>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role: "CUSTOMER" }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Anmeldung fehlgeschlagen.");
      else onDone();
    } catch {
      setErr("Netzwerkfehler.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="customer-login">
      <div>
        <label className="label">E-Mail</label>
        <input className="field" type="email" data-testid="login-email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label">Passwort</label>
        <input className="field" type="password" data-testid="login-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {err && <p className="text-sm font-bold text-red-600" data-testid="login-error">{err}</p>}
      <button className="btn-primary" disabled={busy} data-testid="login-submit">{busy ? "Anmelden …" : "Anmelden"}</button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [vState, setVState] = useState<"idle" | "sent" | "ok">("idle");
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true); setErr(null); setDevCode(null);
    try {
      const r = await fetch("/api/verify/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "SMS", target: phone }) });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Code konnte nicht gesendet werden.");
      else { setVState("sent"); if (d.devCode) setDevCode(d.devCode); }
    } catch { setErr("Netzwerkfehler."); } finally { setBusy(false); }
  }
  async function confirmCode() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/verify/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "SMS", target: phone, code: code.trim() }) });
      const d = await r.json();
      if (!r.ok || !d.token) setErr(d.error ?? "Code falsch.");
      else { setToken(d.token); setVState("ok"); }
    } catch { setErr("Netzwerkfehler."); } finally { setBusy(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/customer/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password, verificationToken: token }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Registrierung fehlgeschlagen.");
      else onDone();
    } catch { setErr("Netzwerkfehler."); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="customer-register">
      <div><label className="label">Name</label><input className="field" data-testid="reg-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div><label className="label">E-Mail</label><input className="field" type="email" data-testid="reg-email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div>
        <label className="label">Telefonnummer</label>
        <input className="field" type="tel" data-testid="reg-phone" value={phone} onChange={(e) => { setPhone(e.target.value); setVState("idle"); setToken(null); }} required />
      </div>

      {/* Telefon bestätigen */}
      {vState !== "ok" ? (
        <div className="rounded-xl border border-ink-200 p-3">
          {vState === "idle" ? (
            <button type="button" onClick={sendCode} disabled={busy || !phone.trim()} data-testid="reg-send-code" className="btn-ghost text-sm disabled:opacity-50">SMS-Code senden</button>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm font-semibold text-ink-800">
                Code aus der SMS eingeben und auf <b>Bestätigen</b> tippen.
              </p>
              {devCode && (
                <p className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800" data-testid="reg-devcode">
                  Kein SMS-Versand eingerichtet – Code zum Testen: <span className="font-mono font-bold">{devCode}</span>
                </p>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className="field text-center font-mono" inputMode="numeric" maxLength={6} placeholder="Code" data-testid="reg-code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} />
                <button type="button" onClick={confirmCode} disabled={busy || code.length < 4} data-testid="reg-confirm" className="btn-primary">Bestätigen</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm font-bold text-green-700" data-testid="reg-verified">✓ Telefon bestätigt</p>
      )}

      <div><label className="label">Passwort (min. 6)</label><input className="field" type="password" data-testid="reg-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
      {err && <p className="text-sm font-bold text-red-600" data-testid="reg-error">{err}</p>}
      <button className="btn-primary disabled:opacity-50" disabled={busy || !token} data-testid="reg-submit">{busy ? "Erstelle …" : "Konto erstellen"}</button>
      {!token && (
        <p className="text-center text-xs text-ink-400">
          {vState === "sent"
            ? "Noch ein Schritt: Code oben eingeben und bestätigen."
            : "Bitte zuerst die Telefonnummer bestätigen."}
        </p>
      )}
    </form>
  );
}

const NEXT_TIER = 500; // Punkte bis zum nächsten Bonus

function LoggedIn({
  name,
  bookings,
  recurring,
  profile,
  favorites,
  onLogout,
  onCancelRecurring,
  onAddFavorite,
  onRemoveFavorite,
  onSaveEmergency,
}: {
  name: string;
  bookings: any[];
  recurring: any[];
  profile: any | null;
  favorites: any[];
  onLogout: () => void;
  onCancelRecurring: (id: string) => void;
  onAddFavorite: (driverId: string) => void;
  onRemoveFavorite: (driverId: string) => void;
  onSaveEmergency: (name: string, phone: string) => void;
}) {
  const points = profile?.points ?? 0;
  const favIds = new Set(favorites.map((f) => f.driverId));
  const firstName = name.split(" ")[0];
  const [tab, setTab] = useState<"rides" | "recurring" | "favorites" | "payment" | "profile">("rides");
  const activeRecurring = recurring.filter((r) => r.active).length;
  const tabs = [
    { key: "rides" as const, label: "Fahrten", count: bookings.length },
    { key: "recurring" as const, label: "Regelmäßig", count: activeRecurring },
    { key: "favorites" as const, label: "Favoriten", count: favorites.length },
    { key: "payment" as const, label: "Zahlung", count: 0 },
    { key: "profile" as const, label: "Profil", count: 0 },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* Übersicht: Begrüßung, Punkte, Schnellaktionen */}
      <div className="card overflow-hidden p-0" data-testid="account-overview">
        <div className="flex items-center justify-between gap-3 bg-ink-900 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/60">Mein Konto</p>
            <p className="truncate font-display text-xl font-extrabold" data-testid="account-name">Guten Tag, {firstName}</p>
          </div>
          <button onClick={onLogout} data-testid="account-logout" className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-sm font-bold text-white hover:bg-white/20">Abmelden</button>
        </div>

        {/* Mini-Statistiken */}
        <div className="grid grid-cols-3 divide-x divide-ink-100 border-b border-ink-100" data-testid="account-points">
          <Stat value={String(points)} label="Punkte" testid="points-balance" />
          <Stat value={String(bookings.length)} label="Fahrten" />
          <Stat value={String(favorites.length)} label="Favoriten" />
        </div>

        {/* Punkte-Fortschritt */}
        <div className="px-5 py-3">
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, ((points % NEXT_TIER) / NEXT_TIER) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-ink-500">Noch {Math.max(0, NEXT_TIER - (points % NEXT_TIER))} Punkte bis zum nächsten Bonus-Gutschein.</p>
        </div>

        {/* Schnellaktionen */}
        <div className="flex flex-wrap gap-2 border-t border-ink-100 px-5 py-3">
          <Link href="/buchen" className="btn-primary text-sm" data-testid="quick-book">Taxi bestellen</Link>
          <Link href="/taxis" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-2 text-sm font-bold text-ink-700 hover:border-ink-900">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" strokeWidth="2"/></svg>
            Live-Karte
          </Link>
          <Link href="/buchen/krankenfahrt" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-2 text-sm font-bold text-ink-700 hover:border-ink-900">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><path d="M9 12h6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="2"/></svg>
            Krankenfahrt
          </Link>
        </div>
      </div>

      {/* Uber-Style: "Wohin?" Hero mit Mini-Live-Karte */}
      <WhereToHero />

      {/* Tabs */}
      <div className="flex gap-1 rounded-2xl bg-ink-100 p-1" data-testid="account-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-testid={`account-tab-${t.key}`}
            className={`flex-1 rounded-xl px-2 py-2 text-sm font-bold transition ${tab === t.key ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"}`}
          >
            {t.label}{t.count > 0 ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* Tab: Meine Fahrten */}
      {tab === "rides" && (
        <div className="card p-5" data-testid="account-bookings">
          {bookings.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-ink-400">Noch keine Fahrten.</p>
              <Link href="/buchen" className="btn-primary mt-3 inline-block">Erste Fahrt bestellen</Link>
            </div>
          ) : (
            <div className="grid gap-2">
              {bookings.map((b) => (
                <div key={b.id} className="rounded-xl border border-ink-100 p-3 text-sm">
                  <Link href={`/verfolgen/${b.trackingRef ?? b.id}`} className="flex items-center justify-between gap-3 hover:opacity-80">
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-semibold text-ink-900">{b.pickupAddress} → {b.destAddress}</p>
                      <p className="text-xs text-ink-500">{formatDateTime(b.createdAt)} · {TRACKING_LABEL[b.trackingStatus] ?? b.trackingStatus}</p>
                    </div>
                    <span className="shrink-0 font-bold text-ink-900">{formatEuro(b.fare ?? b.priceExact ?? b.priceApprox)}</span>
                  </Link>
                  {(b.driverId || b.trackingStatus === "BEENDET") && (
                    <div className="mt-2 flex flex-wrap gap-2 border-t border-ink-100 pt-2">
                      {b.driverId && (
                        favIds.has(b.driverId) ? (
                          <button onClick={() => onRemoveFavorite(b.driverId)} data-testid={`fav-toggle-${b.id}`} className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-ink-900">★ Favorit</button>
                        ) : (
                          <button onClick={() => onAddFavorite(b.driverId)} data-testid={`fav-toggle-${b.id}`} className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-bold text-ink-600 hover:border-brand-500">☆ Fahrer favorisieren</button>
                        )
                      )}
                      {b.trackingStatus === "BEENDET" && (
                        <a href={`/api/bookings/${b.id}/invoice`} target="_blank" rel="noopener noreferrer" data-testid={`receipt-${b.id}`} className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-bold text-ink-600 hover:border-ink-900">🧾 Beleg (PDF)</a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Regelmäßige Fahrten */}
      {tab === "recurring" && (
        <div className="card p-5" data-testid="account-recurring">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="eyebrow text-ink-500">Regelmäßige Fahrten</h2>
            <Link href="/buchen/krankenfahrt" className="text-sm font-bold text-ink-900 underline">+ Planen</Link>
          </div>
          {recurring.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-400">Keine wiederkehrenden Fahrten. Planen Sie z. B. eine Dialyse-Serie.</p>
          ) : (
            <div className="grid gap-2">
              {recurring.map((r) => (
                <div key={r.id} data-testid={`recurring-${r.id}`} className={`rounded-xl border p-3 ${r.active ? "border-ink-100" : "border-ink-100 bg-ink-50 opacity-70"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-semibold text-ink-900">
                        {r.medicalLabel ? `${r.medicalLabel} · ` : ""}{r.pickupAddress} → {r.destAddress}
                      </p>
                      <p className="text-xs text-ink-500">
                        {r.dayLabels?.join(", ")} · {r.timeOfDay}{r.returnTrip && r.returnTimeOfDay ? ` / zurück ${r.returnTimeOfDay}` : ""} · {r.vehicleClassLabel}
                      </p>
                      {r.upcoming?.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-ink-400">Nächste: {formatDateTime(r.upcoming[0].scheduledAt)}</p>
                      )}
                    </div>
                    {r.active ? (
                      <button onClick={() => onCancelRecurring(r.id)} data-testid={`recurring-cancel-${r.id}`} className="shrink-0 text-xs font-bold text-red-600 hover:text-red-700">Beenden</button>
                    ) : (
                      <span className="shrink-0 rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-bold text-ink-600">beendet</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Favoriten */}
      {tab === "favorites" && (
        <div className="card p-5" data-testid="account-favorites">
          <h2 className="mb-3 eyebrow text-ink-500">Lieblingsfahrer</h2>
          {favorites.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-400">Noch keine Favoriten. In „Fahrten" können Sie Fahrer als Favorit markieren.</p>
          ) : (
            <div className="grid gap-2">
              {favorites.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-900">{f.vehicleClassIcon} {f.name}</p>
                    <p className="text-xs text-ink-500">{[f.company, f.vehicleClassLabel, f.vehiclePlate].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button onClick={() => onRemoveFavorite(f.driverId)} data-testid={`unfav-${f.driverId}`} className="shrink-0 text-xs font-bold text-red-600 hover:text-red-700">Entfernen</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Profil (Notfallkontakt) */}
      {tab === "payment" && <PaymentMethods />}
      {tab === "profile" && <EmergencyCard profile={profile} onSave={onSaveEmergency} />}
    </div>
  );
}

function Stat({ value, label, testid }: { value: string; label: string; testid?: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <p className="font-display text-2xl font-extrabold text-ink-900" data-testid={testid}>{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
    </div>
  );
}

function EmergencyCard({ profile, onSave }: { profile: any | null; onSave: (name: string, phone: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (profile) {
      setName(profile.emergencyContactName ?? "");
      setPhone(profile.emergencyContactPhone ?? "");
    }
  }, [profile]);
  return (
    <div className="card p-5" data-testid="account-emergency">
      <h2 className="mb-1 eyebrow text-ink-500">Notfallkontakt (SOS)</h2>
      <p className="mb-3 text-xs text-ink-400">Wird bei einem SOS während der Fahrt automatisch benachrichtigt.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="field" data-testid="emergency-name" placeholder="Name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        <input className="field" data-testid="emergency-phone" type="tel" placeholder="Telefon" value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} />
      </div>
      <button
        onClick={() => { onSave(name, phone); setSaved(true); }}
        data-testid="emergency-save"
        className="btn-ghost mt-3"
      >
        {saved ? "✓ Gespeichert" : "Notfallkontakt speichern"}
      </button>
    </div>
  );
}


function WhereToHero() {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [taxis, setTaxis] = useState<any[]>([]);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/taxis/live")
        .then((r) => r.json())
        .then((d) => {
          if (stop) return;
          setTaxis(d.taxis ?? []);
          setAvailable(d.available ?? 0);
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  const markers: MapMarker[] = taxis.map((t) => ({
    id: t.id,
    lat: t.lat,
    lng: t.lng,
    kind: "car" as const,
    color: t.status === "FREI" ? "#10B981" : "#9CA3AF",
  }));
  const center: [number, number] = taxis[0] ? [taxis[0].lat, taxis[0].lng] : [52.3759, 9.732];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = to.trim();
    router.push(q ? `/buchen?to=${encodeURIComponent(q)}` : "/buchen");
  }

  return (
    <div className="card overflow-hidden p-0" data-testid="where-to-hero">
      {/* Mini-Live-Karte */}
      <div className="relative h-44">
        <MiniMap center={center} markers={markers} fit />
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 shadow-soft ring-1 ring-ink-200">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="text-[11px] font-extrabold text-ink-900" data-testid="hero-available">{available} frei</span>
        </div>
        <Link
          href="/taxis"
          data-testid="hero-open-map"
          className="absolute bottom-3 right-3 rounded-full bg-ink-900/90 px-3 py-1.5 text-[11px] font-extrabold text-white shadow-soft hover:bg-ink-900"
        >
          Vollbild-Karte →
        </Link>
      </div>

      {/* Wohin? Eingabe */}
      <form onSubmit={submit} className="grid gap-2.5 p-4" data-testid="where-to-form">
        <div className="flex items-center gap-3 rounded-2xl border-2 border-ink-200 bg-white p-3 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-200">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-brand-500">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
              <path d="M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13Z" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          <input
            data-testid="where-to-input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Wohin möchten Sie?"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="where-to-submit"
            className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-extrabold text-ink-900 shadow-glow transition hover:bg-brand-400"
          >
            Los
          </button>
        </div>
        <p className="text-[11px] text-ink-400">Tipp: Adresse hier eingeben → wir öffnen direkt das Buchungsformular.</p>
      </form>
    </div>
  );
}
