"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import type { GeocodeResult } from "@/lib/geo";
import { VEHICLE_CLASSES } from "@/lib/vehicleClasses";
import { formatEuro } from "@/lib/format";

interface Hotel { id: string; name: string; email: string }
interface Addr { address: string; lat?: number; lng?: number }

export function HotelPortal() {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/hotels/me").then((r) => (r.ok ? r.json() : { hotel: null })).then((d) => setHotel(d.hotel)).catch(() => {}).finally(() => setReady(true));
  }, []);

  if (!ready) return <main className="grid min-h-screen place-items-center bg-ink-50 text-ink-500">Lädt …</main>;
  if (!hotel) return <AuthScreen onAuthed={setHotel} />;
  return <Dashboard hotel={hotel} onLogout={() => setHotel(null)} />;
}

function AuthScreen({ onAuthed }: { onAuthed: (h: Hotel) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", address: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/hotels/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(d.error ?? "Fehlgeschlagen.");
    const me = await fetch("/api/hotels/me").then((r) => r.json());
    if (me.hotel) onAuthed(me.hotel);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ink-50 px-5">
      <div className="card w-full max-w-md p-6">
        <Brand subtitle="Hotel-Portal" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setMode("login")} className={`rounded-xl border-2 p-2 font-bold ${mode === "login" ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}>Anmelden</button>
          <button onClick={() => setMode("register")} className={`rounded-xl border-2 p-2 font-bold ${mode === "register" ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}>Registrieren</button>
        </div>
        <div className="mt-4 grid gap-2">
          {mode === "register" && <input className="field" placeholder="Hotelname" data-testid="hotel-name" value={form.name} onChange={(e) => set("name", e.target.value)} />}
          <input className="field" type="email" placeholder="E-Mail" data-testid="hotel-email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input className="field" type="password" placeholder="Passwort" data-testid="hotel-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          {mode === "register" && <input className="field" placeholder="Telefon (optional)" value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
          {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="hotel-auth-error">{err}</p>}
          <button onClick={submit} disabled={busy} data-testid="hotel-auth-submit" className="btn-primary disabled:opacity-60">{busy ? "…" : mode === "login" ? "Anmelden" : "Hotel registrieren"}</button>
        </div>
      </div>
    </main>
  );
}

function Dashboard({ hotel, onLogout }: { hotel: Hotel; onLogout: () => void }) {
  const [rides, setRides] = useState<any[]>([]);
  const [guests, setGuests] = useState<any[]>([]);
  const loadRides = useCallback(() => fetch("/api/hotels/rides").then((r) => r.json()).then((d) => setRides(d.rides ?? [])).catch(() => {}), []);
  const loadGuests = useCallback(() => fetch("/api/hotels/guests").then((r) => r.json()).then((d) => setGuests(d.guests ?? [])).catch(() => {}), []);
  useEffect(() => { loadRides(); loadGuests(); const iv = setInterval(loadRides, 8000); return () => clearInterval(iv); }, [loadRides, loadGuests]);

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Brand subtitle={`Hotel · ${hotel.name}`} />
          <button onClick={async () => { await fetch("/api/auth/logout?scope=hotel", { method: "POST" }).catch(() => {}); onLogout(); }} className="text-sm font-bold text-ink-500 hover:text-ink-900">Abmelden</button>
        </div>
      </header>
      <div className="mx-auto grid max-w-3xl gap-4 px-5 py-6">
        <OverviewCard rides={rides} />
        <NewGuestRideCard onCreated={loadRides} guests={guests} />
        <GuestBookCard guests={guests} onChanged={loadGuests} />
        <RidesCard rides={rides} />
        <FleetWhitelistCard />
        <ChargeRoomCard />
      </div>
    </main>
  );
}

// Übersicht: Kennzahlen aus den Fahrten + Schnellbuttons.
function OverviewCard({ rides }: { rides: any[] }) {
  const today = new Date().toDateString();
  const isToday = (r: any) => r.createdAt && new Date(r.createdAt).toDateString() === today;
  const open = (s: string) => !["BEENDET", "STORNIERT"].includes(s);
  const todayCount = rides.filter(isToday).length;
  const upcoming = rides.filter((r) => r.trackingStatus === "GEPLANT").length;
  const enRoute = rides.filter((r) => ["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"].includes(r.trackingStatus)).length;
  const openCount = rides.filter((r) => open(r.trackingStatus)).length;
  return (
    <div className="card p-6" data-testid="hotel-overview">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Übersicht</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Fahrten heute" value={todayCount} testid="ov-today" />
        <Stat label="Kommende Abholungen" value={upcoming} testid="ov-upcoming" />
        <Stat label="Fahrer unterwegs" value={enRoute} testid="ov-enroute" />
        <Stat label="Offene Fahrten" value={openCount} testid="ov-open" />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <a href="#hotel-book" className="rounded-xl bg-brand-500 px-3 py-2.5 text-center text-sm font-extrabold text-ink-900 hover:bg-brand-400">🚕 Gast-Taxi</a>
        <Link href="/buchen/flughafen" className="rounded-xl border-2 border-ink-200 bg-white px-3 py-2.5 text-center text-sm font-extrabold text-ink-900 hover:border-ink-900">✈️ Flughafentransfer</Link>
        <Link href="/buchen/gruppe" className="rounded-xl border-2 border-ink-200 bg-white px-3 py-2.5 text-center text-sm font-extrabold text-ink-900 hover:border-ink-900">👥 Gruppenfahrt</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: any; testid?: string }) {
  return (
    <div className="rounded-xl bg-ink-50 p-3 text-center" data-testid={testid}>
      <p className="font-display text-2xl font-extrabold text-ink-900">{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-ink-500">{label}</p>
    </div>
  );
}

function NewGuestRideCard({ onCreated, guests }: { onCreated: () => void; guests: any[] }) {
  const empty = { guestName: "", guestPhone: "", roomNumber: "", hotelPayment: "ROOM", vehicleClass: "STANDARD", scheduledAt: "", isVip: false };
  const [form, setForm] = useState(empty);
  const [pickup, setPickup] = useState<Addr>({ address: "" });
  const [dest, setDest] = useState<Addr>({ address: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const ok = form.guestName.trim() && pickup.lat != null && dest.lat != null && !busy;

  // Stammgast übernehmen: Profil + Stammziel automatisch ausfüllen.
  function fillFromGuest(g: any) {
    setForm((f) => ({ ...f, guestName: g.name, guestPhone: g.phone ?? "", roomNumber: g.roomNumber ?? "", vehicleClass: g.preferredVehicleClass || f.vehicleClass, isVip: !!g.isVip }));
    if (g.defaultDestAddress && g.defaultDestLat != null) setDest({ address: g.defaultDestAddress, lat: g.defaultDestLat, lng: g.defaultDestLng ?? undefined });
  }

  async function book() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/hotels/rides", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestName: form.guestName, guestPhone: form.guestPhone || null, roomNumber: form.roomNumber || null,
        hotelPayment: form.hotelPayment, vehicleClass: form.vehicleClass, isVip: form.isVip,
        pickup: { address: pickup.address, lat: pickup.lat, lng: pickup.lng },
        dest: { address: dest.address, lat: dest.lat, lng: dest.lng },
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Buchung fehlgeschlagen.");
    setMsg(d.smsSent ? "✓ Fahrt gebucht – Tracking-Link per SMS an den Gast gesendet." : "✓ Fahrt gebucht.");
    setForm(empty); setPickup({ address: "" }); setDest({ address: "" });
    onCreated();
  }

  return (
    <div className="card p-6" id="hotel-book">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Gast-Fahrt buchen</h2>
      {guests.length > 0 && (
        <select className="field mb-2" data-testid="hotel-guest-picker" defaultValue="" onChange={(e) => { const g = guests.find((x) => x.id === e.target.value); if (g) fillFromGuest(g); e.currentTarget.value = ""; }}>
          <option value="">⭐ Stammgast wählen (automatisch ausfüllen) …</option>
          {guests.map((g) => <option key={g.id} value={g.id}>{g.name}{g.roomNumber ? ` · Zi. ${g.roomNumber}` : ""}{g.isVip ? " · VIP" : ""}</option>)}
        </select>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="field" data-testid="hotel-guest" placeholder="Gastname *" value={form.guestName} onChange={(e) => set("guestName", e.target.value)} />
        <input className="field" data-testid="hotel-guest-phone" placeholder="Gast-Handy (für SMS)" value={form.guestPhone} onChange={(e) => set("guestPhone", e.target.value)} />
        <input className="field" placeholder="Zimmernummer" value={form.roomNumber} onChange={(e) => set("roomNumber", e.target.value)} />
        <select className="field" data-testid="hotel-payment" value={form.hotelPayment} onChange={(e) => set("hotelPayment", e.target.value)}>
          <option value="DIRECT">Gast zahlt selbst</option>
          <option value="ROOM">Auf Zimmer (Charge to Room)</option>
          <option value="CORPORATE">Firmenkonto</option>
        </select>
      </div>
      <div className="mt-2 grid gap-2">
        <AddressInput label="Abholung" placeholder="Abholadresse" value={pickup.address} onChange={(t) => setPickup({ address: t })} onSelect={(r: GeocodeResult) => setPickup({ address: r.label, lat: r.lat, lng: r.lng })} />
        <AddressInput label="Ziel" placeholder="Zieladresse" value={dest.address} onChange={(t) => setDest({ address: t })} onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })} />
        <div className="grid gap-2 sm:grid-cols-2">
          <select className="field disabled:opacity-50" disabled={form.isVip} value={form.isVip ? "VIP" : form.vehicleClass} onChange={(e) => set("vehicleClass", e.target.value)}>
            {VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
          </select>
          <input className="field" type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
        </div>
        <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
          <input type="checkbox" className="h-5 w-5 accent-brand-500" data-testid="hotel-vip" checked={form.isVip} onChange={(e) => set("isVip", e.target.checked)} />
          <span>⭐ VIP-Fahrt (Luxusklasse, priorisiert)</span>
        </label>
      </div>
      {msg && <p className="mt-2 text-sm font-semibold text-ink-700" data-testid="hotel-ride-msg">{msg}</p>}
      <button onClick={book} disabled={!ok} data-testid="hotel-book" className="btn-primary mt-3 disabled:opacity-60">{busy ? "Bucht …" : "Fahrt buchen"}</button>
    </div>
  );
}

// Stammgäste verwalten (Profil + Stammziel + VIP) für die 30-Sekunden-Buchung.
function GuestBookCard({ guests, onChanged }: { guests: any[]; onChanged: () => void }) {
  const empty = { name: "", phone: "", roomNumber: "", language: "", preferredVehicleClass: "", isVip: false, notes: "" };
  const [form, setForm] = useState<any>(empty);
  const [dest, setDest] = useState<Addr>({ address: "" });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/hotels/guests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, phone: form.phone || null, roomNumber: form.roomNumber || null,
        language: form.language || null, preferredVehicleClass: form.preferredVehicleClass || null,
        isVip: !!form.isVip, notes: form.notes || null,
        defaultDestAddress: dest.lat != null ? dest.address : null, defaultDestLat: dest.lat ?? null, defaultDestLng: dest.lng ?? null,
      }),
    });
    setBusy(false);
    if (res.ok) { setForm(empty); setDest({ address: "" }); setOpen(false); onChanged(); }
  }
  async function remove(g: any) {
    if (!window.confirm(`Stammgast „${g.name}" löschen?`)) return;
    await fetch(`/api/hotels/guests/${g.id}`, { method: "DELETE" }).catch(() => {});
    onChanged();
  }

  return (
    <div className="card p-6" data-testid="hotel-guests">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Stammgäste ({guests.length})</h2>
        <button onClick={() => setOpen((o) => !o)} className="text-sm font-bold text-brand-700 hover:underline">{open ? "Schließen" : "+ Neuer Stammgast"}</button>
      </div>
      {open && (
        <div className="mb-4 grid gap-2 rounded-2xl border border-ink-100 p-3 sm:grid-cols-2">
          <input className="field" data-testid="guest-name" placeholder="Name *" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input className="field" placeholder="Telefon" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <input className="field" placeholder="Zimmer (Standard)" value={form.roomNumber} onChange={(e) => set("roomNumber", e.target.value)} />
          <input className="field" placeholder="Sprache (z. B. Englisch)" value={form.language} onChange={(e) => set("language", e.target.value)} />
          <select className="field" value={form.preferredVehicleClass} onChange={(e) => set("preferredVehicleClass", e.target.value)}>
            <option value="">Bevorzugtes Fahrzeug …</option>
            {VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
          </select>
          <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700"><input type="checkbox" className="h-5 w-5 accent-brand-500" checked={form.isVip} onChange={(e) => set("isVip", e.target.checked)} />⭐ VIP-Status</label>
          <div className="sm:col-span-2"><AddressInput label="Stammziel (optional, z. B. Flughafen)" placeholder="Zieladresse" value={dest.address} onChange={(t) => setDest({ address: t })} onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })} /></div>
          <input className="field sm:col-span-2" placeholder="Besondere Hinweise" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          <button onClick={add} disabled={busy || !form.name.trim()} data-testid="guest-save" className="btn-primary sm:col-span-2 disabled:opacity-60">{busy ? "…" : "Stammgast speichern"}</button>
        </div>
      )}
      <div className="grid gap-2">
        {guests.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2 text-sm" data-testid={`guest-${g.id}`}>
            <span className="min-w-0">
              <span className="font-bold text-ink-900">{g.name}</span>
              {g.isVip && <span className="ml-1">⭐</span>}
              <span className="block truncate text-xs text-ink-500">{[g.roomNumber && `Zi. ${g.roomNumber}`, g.preferredVehicleClass, g.language, g.defaultDestAddress && `→ ${g.defaultDestAddress}`].filter(Boolean).join(" · ")}</span>
            </span>
            <button onClick={() => remove(g)} className="shrink-0 text-xs font-bold text-red-600 hover:underline">Löschen</button>
          </div>
        ))}
        {guests.length === 0 && <p className="text-sm text-ink-400">Noch keine Stammgäste.</p>}
      </div>
    </div>
  );
}

function RidesCard({ rides }: { rides: any[] }) {
  return (
    <div className="card p-6">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Fahrten ({rides.length})</h2>
      <div className="grid gap-2">
        {rides.map((r) => (
          <Link key={r.id} href={`/verfolgen/${r.trackingRef ?? r.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5 text-sm transition hover:bg-ink-100" data-testid={`hotel-ride-${r.id}`}>
            <span className="min-w-0">
              <span className="block truncate font-bold text-ink-900">{r.customerName}{r.roomNumber ? ` · Zi. ${r.roomNumber}` : ""}</span>
              <span className="block truncate text-ink-500">{r.pickupAddress} → {r.destAddress}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-xs font-bold text-ink-700">{r.trackingStatus}</span>
              {r.driver?.vehiclePlate && <span className="block text-[11px] text-ink-500">{r.driver.vehiclePlate}</span>}
            </span>
          </Link>
        ))}
        {rides.length === 0 && <p className="text-sm text-ink-400">Noch keine Fahrten gebucht.</p>}
      </div>
    </div>
  );
}

function FleetWhitelistCard() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/hotels/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
    fetch("/api/hotels/settings").then((r) => r.json()).then((d) => setSelected(new Set(d.preferredCompanyIds ?? []))).catch(() => {});
  }, []);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function save() {
    await fetch("/api/hotels/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferredCompanyIds: Array.from(selected) }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  return (
    <div className="card p-6" data-testid="hotel-fleet">
      <h2 className="mb-1 font-display text-lg font-extrabold text-ink-900">Bevorzugte Flotte</h2>
      <p className="mb-3 text-xs text-ink-500">Markierte Firmen werden bei Hotel-Fahrten zuerst angefragt. Ist keine im Umkreis frei, wird automatisch der nächste verfügbare Wagen vermittelt (Open-Marketplace-Fallback).</p>
      <div className="grid gap-1.5">
        {companies.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-1.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={selected.has(c.id)} onChange={() => toggle(c.id)} data-testid={`fleet-${c.id}`} />
            <span className="font-semibold text-ink-800">{c.name}</span>
          </label>
        ))}
        {companies.length === 0 && <p className="text-sm text-ink-400">Keine Firmen verfügbar.</p>}
      </div>
      {companies.length > 0 && <button onClick={save} data-testid="fleet-save" className="btn-primary mt-3">{saved ? "✓ Gespeichert" : "Whitelist speichern"}</button>}
    </div>
  );
}

function ChargeRoomCard() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { fetch(`/api/hotels/invoice?month=${month}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}); }, [month]);

  return (
    <div className="card p-6" data-testid="hotel-invoice">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Charge-to-Room Abrechnung</h2>
        <div className="flex items-center gap-2">
          <input className="field max-w-[160px]" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <a href={`/api/hotels/invoice?month=${month}&format=csv`} className="shrink-0 rounded-xl bg-ink-900 px-3 py-2.5 text-sm font-extrabold text-white hover:bg-ink-800">CSV</a>
        </div>
      </div>
      {data && (
        <>
          <div className="grid gap-1.5">
            {(data.lines ?? []).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate"><span className="font-bold text-ink-900">{l.guest}</span>{l.room ? ` · Zi. ${l.room}` : ""} <span className="text-ink-400">({l.mode})</span></span>
                <span className="shrink-0 font-bold text-ink-900">{formatEuro(l.fare)}</span>
              </div>
            ))}
            {(data.lines ?? []).length === 0 && <p className="text-sm text-ink-400">Keine aufs Zimmer/Firmenkonto gebuchten Fahrten in {data.periodLabel}.</p>}
          </div>
          {data.total?.count > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-ink-200 pt-3 text-sm">
              <span className="font-bold text-ink-900">Gesamt · {data.periodLabel}</span>
              <span className="font-display text-lg font-extrabold text-ink-900">{formatEuro(data.total.fare)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
