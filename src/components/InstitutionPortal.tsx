"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import type { GeocodeResult } from "@/lib/geo";
import { MEDICAL_TYPES, MOBILITY_OPTIONS, mobilityLabel } from "@/lib/medical";
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
    <div className="mx-auto grid max-w-3xl gap-3 px-4 py-4">
      <div>
        <h1 className="font-display text-xl font-extrabold tracking-tight text-ink-900" data-testid="inst-dashboard">{inst.name}</h1>
        <p className="text-xs text-ink-500">Krankenfahrten-Portal · {inst.type}</p>
      </div>

      <NewRideCard patients={patients} onCreated={loadRides} />
      <PatientsCard patients={patients} onCreated={loadPatients} />
      <RidesCard rides={rides} patients={patients} onChanged={loadRides} />
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
    <div className="card p-4" data-testid="inst-invoice">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-extrabold text-ink-900">Abrechnung</h2>
        <div className="flex items-center gap-2">
          <input className="field-sm max-w-[150px]" type="month" data-testid="invoice-month" value={month} onChange={(e) => setMonth(e.target.value)} />
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
  const [quickOrder, setQuickOrder] = useState(false);
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
        quickOrder,
        scheduledAt: quickOrder ? null : when ? new Date(when).toISOString() : null,
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setError(d.error ?? "Fahrt konnte nicht angelegt werden."); return; }
    setMsg(quickOrder ? "⚡ Schnellauftrag angelegt – wird an freie Fahrer disponiert." : "Vorbestellung angelegt – wartet auf Zuweisung durch eine Taxi-Zentrale.");
    setPickup({ address: "" }); setDest({ address: "" }); setPatientName(""); setPatientId(""); setWhen("");
    onCreated();
  }

  return (
    <div className="card p-4">
      <h2 className="mb-2 font-display text-base font-extrabold text-ink-900">Neue Krankenfahrt</h2>
      <div className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          {patients.length > 0 ? (
            <select className="field-sm" data-testid="ride-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">— Neuer Patient —</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <div className="hidden sm:block" />}
          {!patientId
            ? <input className="field-sm" data-testid="ride-patient-name" placeholder="Patientenname" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
            : <div className="hidden sm:block" />}
        </div>
        <AddressInput compact label="Abholung" placeholder="Abholadresse" value={pickup.address} onChange={(t) => setPickup({ address: t })} onSelect={(r: GeocodeResult) => setPickup({ address: r.label, lat: r.lat, lng: r.lng })} required />
        <AddressInput compact label="Ziel" placeholder="z. B. Dialysezentrum" value={dest.address} onChange={(t) => setDest({ address: t })} onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })} required />
        <div className="grid gap-2 sm:grid-cols-2">
          <select className="field-sm" data-testid="ride-type" value={medicalType} onChange={(e) => setMedicalType(e.target.value)}>
            {MEDICAL_TYPES.map((m) => <option key={m.key} value={m.key}>{m.icon} {m.label}</option>)}
          </select>
          <select className="field-sm" data-testid="ride-vclass" value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
            {VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" data-testid="ride-ramp" checked={requiresRamp} onChange={(e) => setRequiresRamp(e.target.checked)} /> 🦽 Rollstuhlrampe
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" data-testid="ride-stretcher" checked={requiresStretcher} onChange={(e) => setRequiresStretcher(e.target.checked)} /> 🛏️ Tragestuhl
          </label>
        </div>
        <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${quickOrder ? "border-brand-400 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-700"}`}>
          <input type="checkbox" className="h-4 w-4 accent-brand-500" data-testid="ride-quick" checked={quickOrder} onChange={(e) => setQuickOrder(e.target.checked)} />
          <span>⚡ Schnellauftrag (sofort) – geht direkt an einen freien Fahrer</span>
        </label>
        {!quickOrder && (
          <label className="grid gap-1">
            <span className="label-sm">Zeitpunkt (leer = sofort/asap)</span>
            <input className="field-sm" type="datetime-local" data-testid="ride-when" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        )}
        <p className="text-[11px] text-ink-400">
          {quickOrder
            ? "Sofort-Disposition: der nächste freie Taxifahrer nimmt die Fahrt an."
            : "Vorbestellung: erscheint im Zuweisungs-Pool der Taxi-Zentralen. Eine Zentrale weist die Fahrt einem Fahrer zu."}
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700" data-testid="ride-error">{error}</p>}
        {msg && <p className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700" data-testid="ride-msg">{msg}</p>}
        <button onClick={submit} disabled={!ready || busy} data-testid="ride-submit" className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-extrabold text-ink-900 transition hover:bg-brand-400 disabled:opacity-60">
          {busy ? "Wird angelegt …" : "Fahrt anlegen"}
        </button>
      </div>
    </div>
  );
}

const EMPTY_PATIENT = { name: "", birthDate: "", gender: "", phone: "", email: "", address: "", mobility: "", payerType: "", insuranceName: "", insuranceNumber: "", kostentraegerNummer: "", befreiungUntil: "" };

function statusShort(s: string): string {
  return ({ OFFEN: "offen", ZUGEWIESEN: "zugewiesen", AKTIV: "unterwegs", ABGESCHLOSSEN: "erledigt", STORNIERT: "storniert" } as Record<string, string>)[s] ?? s;
}

function PatientsCard({ patients, onCreated }: { patients: any[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_PATIENT);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function add() {
    setBusy(true);
    const res = await fetch("/api/institutions/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (res.ok) { setForm(EMPTY_PATIENT); setOpen(false); onCreated(); }
  }

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? patients.filter((p) => [p.name, p.phone, p.insuranceName, p.insuranceNumber].some((v) => (v ?? "").toLowerCase().includes(ql)))
    : patients;

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-extrabold text-ink-900">Stammpatienten ({patients.length})</h2>
        <button onClick={() => setOpen((o) => !o)} data-testid="patient-toggle" className="text-sm font-bold text-ink-600 hover:text-ink-900">{open ? "Schließen" : "+ Patient"}</button>
      </div>

      {open && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <input className="field-sm" data-testid="patient-name" placeholder="Name *" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input className="field-sm" type="date" data-testid="patient-birth" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
          <select className="field-sm" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Geschlecht …</option><option value="M">männlich</option><option value="F">weiblich</option><option value="D">divers</option>
          </select>
          <input className="field-sm" placeholder="Telefon" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <input className="field-sm" placeholder="E-Mail" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input className="field-sm" placeholder="Anschrift" value={form.address} onChange={(e) => set("address", e.target.value)} />
          <select className="field-sm" data-testid="patient-mobility" value={form.mobility} onChange={(e) => set("mobility", e.target.value)}>
            <option value="">Mobilität …</option>
            {MOBILITY_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.icon} {m.label}</option>)}
          </select>
          <select className="field-sm" value={form.payerType} onChange={(e) => set("payerType", e.target.value)}>
            <option value="">Kostenträger …</option><option value="SELF">Privatzahler</option><option value="INSURANCE">Krankenkasse</option>
          </select>
          <input className="field-sm" placeholder="Krankenkasse" value={form.insuranceName} onChange={(e) => set("insuranceName", e.target.value)} />
          <input className="field-sm" placeholder="Versicherungsnummer" value={form.insuranceNumber} onChange={(e) => set("insuranceNumber", e.target.value)} />
          <input className="field-sm" placeholder="Kostenträger-Nr. (IK)" value={form.kostentraegerNummer} onChange={(e) => set("kostentraegerNummer", e.target.value)} />
          <label className="grid gap-0.5 text-[11px] text-ink-500">Befreiungsausweis gültig bis<input className="field-sm" type="date" value={form.befreiungUntil} onChange={(e) => set("befreiungUntil", e.target.value)} /></label>
          <button onClick={add} disabled={busy || !form.name.trim()} data-testid="patient-save" className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-extrabold text-ink-900 hover:bg-brand-400 sm:col-span-2 disabled:opacity-60">{busy ? "Speichern …" : "Patient speichern"}</button>
        </div>
      )}

      {patients.length > 3 && (
        <input className="field-sm mb-3" data-testid="patient-search" placeholder="Suche: Name, Telefon, Kasse, Vers.-Nr." value={q} onChange={(e) => setQ(e.target.value)} />
      )}

      <div className="grid gap-2">
        {filtered.map((p) => (
          <div key={p.id} data-testid={`patient-${p.id}`}>
            <button onClick={() => setOpenId((id) => (id === p.id ? null : p.id))} className="flex w-full items-center justify-between rounded-xl bg-ink-50 px-3 py-2 text-left text-sm transition hover:bg-ink-100">
              <span className="min-w-0 truncate"><span className="font-bold text-ink-900">{p.name}</span>{p.insuranceName ? <span className="text-ink-500"> · {p.insuranceName}</span> : null}</span>
              <span className="shrink-0 text-ink-400">{p.birthDate ?? ""} {openId === p.id ? "▲" : "▼"}</span>
            </button>
            {openId === p.id && <PatientAkte id={p.id} />}
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-ink-400">{patients.length === 0 ? "Noch keine Patienten angelegt." : "Kein Treffer."}</p>}
      </div>
    </div>
  );
}

function PatientAkte({ id }: { id: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    fetch(`/api/institutions/patients/${id}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, [id]);
  if (!data) return <div className="px-3 py-2 text-xs text-ink-400">Lädt Akte …</div>;
  const p = data.patient;
  const F = ({ label, val }: { label: string; val: any }) =>
    val ? (
      <div>
        <dt className="text-[10px] uppercase tracking-wide text-ink-400">{label}</dt>
        <dd className="font-semibold text-ink-800">{val}</dd>
      </div>
    ) : null;
  return (
    <div className="mt-1 rounded-xl border border-ink-100 bg-white p-3" data-testid={`akte-${id}`}>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <F label="Geburtsdatum" val={p.birthDate} />
        <F label="Geschlecht" val={p.gender === "M" ? "männlich" : p.gender === "F" ? "weiblich" : p.gender === "D" ? "divers" : null} />
        <F label="Telefon" val={p.phone} />
        <F label="E-Mail" val={p.email} />
        <F label="Anschrift" val={p.address} />
        <F label="Mobilität" val={mobilityLabel(p.mobility)} />
        <F label="Kostenträger" val={p.payerType === "INSURANCE" ? (p.insuranceName ?? "Krankenkasse") : p.payerType === "SELF" ? "Privatzahler" : null} />
        <F label="Vers.-Nr." val={p.insuranceNumber} />
        <F label="Kostenträger-Nr." val={p.kostentraegerNummer} />
        <F label="Befreiung bis" val={p.befreiungUntil} />
      </dl>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">Fahrtenhistorie ({data.stats.totalRides})</p>
          <div className="grid gap-1">
            {data.rides.slice(0, 8).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2 py-1 text-xs">
                <span className="min-w-0 truncate text-ink-700">{new Date(r.scheduledAt ?? r.createdAt).toLocaleDateString("de-DE")} · {r.medicalLabel ?? "Fahrt"}</span>
                <span className="shrink-0 font-semibold text-ink-900">{statusShort(r.status)}</span>
              </div>
            ))}
            {data.rides.length === 0 && <p className="text-xs text-ink-400">Noch keine Fahrten.</p>}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">Dokumente ({data.documents.length})</p>
          <div className="grid gap-1">
            {data.documents.slice(0, 8).map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2 py-1 text-xs">
                <span className="min-w-0 truncate text-ink-700">{d.kind} · {d.fileName}</span>
                <span className="shrink-0 font-semibold text-ink-500">{d.reviewStatus}</span>
              </div>
            ))}
            {data.documents.length === 0 && <p className="text-xs text-ink-400">Keine Dokumente.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Eine Fahrt ist nachträglich änderbar/stornierbar, solange sie noch nicht
// gestartet wurde (kein Fahrer unterwegs/angekommen/laufend/abgeschlossen).
const EDITABLE_STATUS = new Set(["OFFEN", "ZUGEWIESEN", "SUCHE", "GEPLANT", "RESERVIERT_FAHRER"]);
function isEditable(r: any): boolean {
  if (["ABGESCHLOSSEN", "STORNIERT"].includes(r.status)) return false;
  return EDITABLE_STATUS.has(r.status) || EDITABLE_STATUS.has(r.trackingStatus);
}

function RidesCard({ rides, patients, onChanged }: { rides: any[]; patients: any[]; onChanged: () => void }) {
  const [editId, setEditId] = useState<string | null>(null);
  return (
    <div className="card p-4">
      <h2 className="mb-2 font-display text-base font-extrabold text-ink-900">Fahrten ({rides.length})</h2>
      <div className="grid gap-1.5">
        {rides.map((r) => (
          <div key={r.id} data-testid={`inst-ride-${r.id}`}>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm">
              <Link href={`/verfolgen/${r.trackingRef ?? r.id}`} className="min-w-0 flex-1 transition hover:opacity-70">
                <span className="block truncate font-bold text-ink-900">
                  {r.patientName ?? r.customerName} · {r.medicalLabel ?? "Fahrt"}
                  {r.scheduledAt ? <span className="ml-1 font-normal text-ink-500">· {new Date(r.scheduledAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> : null}
                </span>
                <span className="block truncate text-xs text-ink-500">{r.pickupAddress} → {r.destAddress}</span>
              </Link>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[10px] font-extrabold text-brand-500">{r.trackingStatus}</span>
                {isEditable(r) && (
                  <button onClick={() => setEditId((id) => (id === r.id ? null : r.id))} data-testid={`ride-edit-${r.id}`} className="rounded-lg border border-ink-200 px-2 py-1 text-[11px] font-bold text-ink-700 hover:border-ink-900">
                    {editId === r.id ? "Schließen" : "Ändern"}
                  </button>
                )}
              </span>
            </div>
            {editId === r.id && <EditRideRow ride={r} onDone={() => { setEditId(null); onChanged(); }} />}
          </div>
        ))}
        {rides.length === 0 && <p className="text-sm text-ink-400">Noch keine Fahrten.</p>}
      </div>
    </div>
  );
}

function EditRideRow({ ride, onDone }: { ride: any; onDone: () => void }) {
  const toLocal = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [pickup, setPickup] = useState<Addr>({ address: ride.pickupAddress, lat: ride.pickupLat, lng: ride.pickupLng });
  const [dest, setDest] = useState<Addr>({ address: ride.destAddress, lat: ride.destLat, lng: ride.destLng });
  const [medicalType, setMedicalType] = useState(ride.medicalType ?? "DIALYSE");
  const [vehicleClass, setVehicleClass] = useState(ride.vehicleClass ?? "WHEELCHAIR");
  const [requiresRamp, setRequiresRamp] = useState(!!ride.requiresRamp);
  const [requiresStretcher, setRequiresStretcher] = useState(!!ride.requiresStretcher);
  const [when, setWhen] = useState(toLocal(ride.scheduledAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/institutions/rides/${ride.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pickup: pickup.lat != null ? pickup : undefined,
        dest: dest.lat != null ? dest : undefined,
        medicalType, vehicleClass, requiresRamp, requiresStretcher,
        scheduledAt: when ? new Date(when).toISOString() : null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(d.error ?? "Änderung fehlgeschlagen."); return; }
    onDone();
  }
  async function cancelRide() {
    if (!window.confirm("Diese Fahrt stornieren?")) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/institutions/rides/${ride.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Stornierung fehlgeschlagen."); return; }
    onDone();
  }

  return (
    <div className="mt-1 grid gap-2 rounded-xl border border-ink-200 bg-white p-3" data-testid={`ride-edit-form-${ride.id}`}>
      <AddressInput compact label="Abholung" placeholder="Abholadresse" value={pickup.address} onChange={(t) => setPickup({ address: t })} onSelect={(r: GeocodeResult) => setPickup({ address: r.label, lat: r.lat, lng: r.lng })} />
      <AddressInput compact label="Ziel" placeholder="Zieladresse" value={dest.address} onChange={(t) => setDest({ address: t })} onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="field-sm" value={medicalType} onChange={(e) => setMedicalType(e.target.value)}>
          {MEDICAL_TYPES.map((m) => <option key={m.key} value={m.key}>{m.icon} {m.label}</option>)}
        </select>
        <select className="field-sm" value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
          {VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={requiresRamp} onChange={(e) => setRequiresRamp(e.target.checked)} /> 🦽 Rollstuhlrampe</label>
        <label className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={requiresStretcher} onChange={(e) => setRequiresStretcher(e.target.checked)} /> 🛏️ Tragestuhl</label>
      </div>
      <label className="grid gap-1"><span className="label-sm">Zeitpunkt (leer = sofort)</span><input className="field-sm" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button onClick={cancelRide} disabled={busy} data-testid={`ride-cancel-${ride.id}`} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Stornieren</button>
        <button onClick={save} disabled={busy} data-testid={`ride-save-${ride.id}`} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-extrabold text-ink-900 hover:bg-brand-400 disabled:opacity-60">{busy ? "Speichert …" : "Änderung speichern"}</button>
      </div>
    </div>
  );
}
