"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import type { GeocodeResult } from "@/lib/geo";
import { MEDICAL_TYPES, MOBILITY_OPTIONS } from "@/lib/medical";
import { VEHICLE_CLASSES } from "@/lib/vehicleClasses";

interface Inst { id: string; name: string; type: string; email: string }
interface Addr { address: string; lat?: number; lng?: number }

export function InstitutionPortal() {
  const [inst, setInst] = useState<Inst | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refreshMe = () =>
    fetch("/api/institutions/me").then((r) => r.json()).then((d) => { setInst(d.institution ?? null); setLoaded(true); }).catch(() => setLoaded(true));

  useEffect(() => { refreshMe(); }, []);

  if (!loaded) return <main className="grid min-h-screen place-items-center bg-ink-50 text-ink-500">Lädt …</main>;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Brand href="/" subtitle="Einrichtungs-Portal" />
          {inst ? (
            <button
              data-testid="inst-logout"
              onClick={() => fetch("/api/institutions/me", { method: "DELETE" }).then(() => { setInst(null); })}
              className="text-sm font-bold text-ink-500 hover:text-ink-900"
            >
              Abmelden
            </button>
          ) : (
            <Link href="/" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Start</Link>
          )}
        </div>
      </header>

      {inst ? <Dashboard inst={inst} /> : <AuthCard onAuthed={refreshMe} />}
    </main>
  );
}

// ── Login / Registrierung ──────────────────────────────────────────────────
function AuthCard({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", type: "KLINIK", email: "", password: "", phone: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true); setError(null);
    const url = mode === "login" ? "/api/institutions/login" : "/api/institutions/register";
    const body = mode === "login" ? { email: form.email, password: form.password } : form;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setError(d.error ?? "Fehlgeschlagen."); return; }
    onAuthed();
  }

  return (
    <div className="mx-auto max-w-md px-5 py-10">
      <div className="card p-6">
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button data-testid="inst-mode-login" onClick={() => setMode("login")} className={`rounded-xl border-2 p-2.5 font-bold transition ${mode === "login" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>Anmelden</button>
          <button data-testid="inst-mode-register" onClick={() => setMode("register")} className={`rounded-xl border-2 p-2.5 font-bold transition ${mode === "register" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>Registrieren</button>
        </div>
        <div className="grid gap-3">
          {mode === "register" && (
            <>
              <input className="field" data-testid="inst-name" placeholder="Name der Einrichtung" value={form.name} onChange={(e) => set("name", e.target.value)} />
              <select className="field" data-testid="inst-type" value={form.type} onChange={(e) => set("type", e.target.value)}>
                <option value="KLINIK">Klinik / Krankenhaus</option>
                <option value="PFLEGEHEIM">Pflegeheim</option>
                <option value="DIALYSE">Dialysezentrum</option>
                <option value="REHA">Reha-Zentrum</option>
              </select>
            </>
          )}
          <input className="field" data-testid="inst-email" type="email" placeholder="E-Mail" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input className="field" data-testid="inst-password" type="password" placeholder="Passwort" value={form.password} onChange={(e) => set("password", e.target.value)} />
          {mode === "register" && <input className="field" placeholder="Telefon (optional)" value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="inst-auth-error">{error}</p>}
          <button onClick={submit} disabled={busy} data-testid="inst-auth-submit" className="btn-primary disabled:opacity-60">
            {busy ? "Bitte warten …" : mode === "login" ? "Anmelden" : "Konto erstellen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ inst }: { inst: Inst }) {
  const [patients, setPatients] = useState<any[]>([]);
  const [rides, setRides] = useState<any[]>([]);

  const loadPatients = () => fetch("/api/institutions/patients").then((r) => r.json()).then((d) => setPatients(d.patients ?? [])).catch(() => {});
  const loadRides = () => fetch("/api/institutions/rides").then((r) => r.json()).then((d) => setRides(d.rides ?? [])).catch(() => {});

  useEffect(() => { loadPatients(); loadRides(); }, []);

  return (
    <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-900" data-testid="inst-dashboard">{inst.name}</h1>
        <p className="text-sm text-ink-500">Krankenfahrten-Portal · {inst.type}</p>
      </div>

      <NewRideCard patients={patients} onCreated={loadRides} />
      <PatientsCard patients={patients} onCreated={loadPatients} />
      <RidesCard rides={rides} />
      <InvoiceCard />
    </div>
  );
}

function InvoiceCard() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetch(`/api/institutions/invoice?month=${month}`).then((r) => r.json()).then(setData).catch(() => setData(null));
  }, [month]);

  const euro = (n: number) => (n ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  return (
    <div className="card p-6" data-testid="inst-invoice">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Abrechnung</h2>
        <div className="flex items-center gap-2">
          <input className="field max-w-[160px]" type="month" data-testid="invoice-month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <a
            href={`/api/institutions/invoice/pdf?month=${month}`}
            target="_blank"
            rel="noreferrer"
            data-testid="invoice-pdf"
            className="shrink-0 rounded-xl bg-ink-900 px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-ink-800"
          >
            PDF
          </a>
        </div>
      </div>
      {data && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Fahrten</p><p className="font-display text-xl font-extrabold text-ink-900" data-testid="invoice-rides">{data.rides}</p></div>
            <div className="rounded-xl bg-ink-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Abgeschlossen</p><p className="font-display text-xl font-extrabold text-ink-900">{data.completed}</p></div>
            <div className="rounded-xl bg-ink-900 p-3 text-white"><p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Abrechenbar</p><p className="font-display text-xl font-extrabold text-brand-500" data-testid="invoice-total">{euro(data.totalBillable)}</p></div>
          </div>
          <div className="grid gap-1.5 text-sm">
            {(data.lines ?? []).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-1.5">
                <span className="min-w-0 truncate"><span className="font-bold text-ink-900">{l.patient}</span> <span className="text-ink-500">· {new Date(l.date).toLocaleDateString("de-DE")}</span></span>
                <span className={`shrink-0 font-bold ${l.billable ? "text-ink-900" : "text-ink-400"}`}>{euro(l.amount)}{l.billable ? "" : " (geplant)"}</span>
              </div>
            ))}
            {(data.lines ?? []).length === 0 && <p className="text-sm text-ink-400">Keine Fahrten in diesem Monat.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function NewRideCard({ patients, onCreated }: { patients: any[]; onCreated: () => void }) {
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [pickup, setPickup] = useState<Addr>({ address: "" });
  const [dest, setDest] = useState<Addr>({ address: "" });
  const [medicalType, setMedicalType] = useState("DIALYSE");
  const [vehicleClass, setVehicleClass] = useState("WHEELCHAIR");
  const [requiresRamp, setRequiresRamp] = useState(false);
  const [requiresStretcher, setRequiresStretcher] = useState(false);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = pickup.lat != null && dest.lat != null && (patientId || patientName.trim());

  async function submit() {
    setBusy(true); setError(null); setMsg(null);
    const res = await fetch("/api/institutions/rides", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: patientId || null,
        patientName: patientId ? null : patientName,
        pickup, dest, medicalType, vehicleClass,
        requiresRamp, requiresStretcher,
        scheduledAt: when ? new Date(when).toISOString() : null,
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setError(d.error ?? "Fahrt konnte nicht angelegt werden."); return; }
    setMsg("Fahrt angelegt und disponiert.");
    setPickup({ address: "" }); setDest({ address: "" }); setPatientName(""); setPatientId("");
    onCreated();
  }

  return (
    <div className="card p-6">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Neue Krankenfahrt</h2>
      <div className="grid gap-3">
        <div>
          <label className="label">Patient</label>
          {patients.length > 0 ? (
            <select className="field" data-testid="ride-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">— Neuer Patient (Name eingeben) —</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : null}
          {!patientId && <input className="field mt-2" data-testid="ride-patient-name" placeholder="Patientenname" value={patientName} onChange={(e) => setPatientName(e.target.value)} />}
        </div>
        <AddressInput label="Abholung" placeholder="Abholadresse" value={pickup.address} onChange={(t) => setPickup({ address: t })} onSelect={(r: GeocodeResult) => setPickup({ address: r.label, lat: r.lat, lng: r.lng })} required />
        <AddressInput label="Ziel" placeholder="z. B. Dialysezentrum" value={dest.address} onChange={(t) => setDest({ address: t })} onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })} required />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Art</label>
            <select className="field" data-testid="ride-type" value={medicalType} onChange={(e) => setMedicalType(e.target.value)}>
              {MEDICAL_TYPES.map((m) => <option key={m.key} value={m.key}>{m.icon} {m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Fahrzeug</label>
            <select className="field" data-testid="ride-vclass" value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
              {VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
            <input type="checkbox" className="h-5 w-5 accent-brand-500" data-testid="ride-ramp" checked={requiresRamp} onChange={(e) => setRequiresRamp(e.target.checked)} /> 🦽 Rollstuhlrampe nötig
          </label>
          <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
            <input type="checkbox" className="h-5 w-5 accent-brand-500" data-testid="ride-stretcher" checked={requiresStretcher} onChange={(e) => setRequiresStretcher(e.target.checked)} /> 🛏️ Tragestuhl nötig
          </label>
        </div>
        <div>
          <label className="label">Zeitpunkt (leer = sofort)</label>
          <input className="field" type="datetime-local" data-testid="ride-when" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="ride-error">{error}</p>}
        {msg && <p className="rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-700" data-testid="ride-msg">{msg}</p>}
        <button onClick={submit} disabled={!ready || busy} data-testid="ride-submit" className="btn-primary disabled:opacity-60">
          {busy ? "Wird angelegt …" : "Fahrt anlegen"}
        </button>
      </div>
    </div>
  );
}

function PatientsCard({ patients, onCreated }: { patients: any[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", birthDate: "", phone: "", mobility: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function add() {
    setBusy(true);
    const res = await fetch("/api/institutions/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (res.ok) { setForm({ name: "", birthDate: "", phone: "", mobility: "" }); setOpen(false); onCreated(); }
  }

  return (
    <div className="card p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Stammpatienten ({patients.length})</h2>
        <button onClick={() => setOpen((o) => !o)} data-testid="patient-toggle" className="text-sm font-bold text-ink-600 hover:text-ink-900">{open ? "Schließen" : "+ Patient"}</button>
      </div>
      {open && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <input className="field" data-testid="patient-name" placeholder="Name *" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input className="field" type="date" data-testid="patient-birth" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
          <input className="field" placeholder="Telefon" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <select className="field" data-testid="patient-mobility" value={form.mobility} onChange={(e) => set("mobility", e.target.value)}>
            <option value="">Mobilität …</option>
            {MOBILITY_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.icon} {m.label}</option>)}
          </select>
          <button onClick={add} disabled={busy || !form.name.trim()} data-testid="patient-save" className="btn-primary sm:col-span-2 disabled:opacity-60">{busy ? "Speichern …" : "Patient speichern"}</button>
        </div>
      )}
      <div className="grid gap-2">
        {patients.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2 text-sm">
            <span className="font-bold text-ink-900">{p.name}</span>
            <span className="text-ink-500">{p.birthDate ?? ""}</span>
          </div>
        ))}
        {patients.length === 0 && <p className="text-sm text-ink-400">Noch keine Patienten angelegt.</p>}
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
          <Link key={r.id} href={`/verfolgen/${r.id}`} className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2.5 text-sm transition hover:bg-ink-100" data-testid={`inst-ride-${r.id}`}>
            <span className="min-w-0">
              <span className="block truncate font-bold text-ink-900">{r.patientName ?? r.customerName} · {r.medicalLabel ?? "Fahrt"}</span>
              <span className="block truncate text-ink-500">{r.pickupAddress} → {r.destAddress}</span>
            </span>
            <span className="ml-2 shrink-0 rounded-full bg-ink-900 px-2 py-0.5 text-[10px] font-extrabold text-brand-500">{r.trackingStatus}</span>
          </Link>
        ))}
        {rides.length === 0 && <p className="text-sm text-ink-400">Noch keine Fahrten.</p>}
      </div>
    </div>
  );
}
