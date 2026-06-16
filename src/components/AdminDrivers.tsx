"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { VEHICLE_CLASSES } from "@/lib/vehicleClasses";

export function AdminDrivers() {
  const router = useRouter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [authOk, setAuthOk] = useState(false);

  useEffect(() => {
    fetch("/api/admin/drivers")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/admin/login");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setDrivers(d.drivers);
          setAuthOk(true);
        }
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  if (!authOk) return <main className="grid min-h-screen place-items-center bg-ink-100">Lädt …</main>;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Fahrerverwaltung" />
          <Link href="/admin" data-testid="back-to-dashboard" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-4 px-5 py-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <NewDriverCard
            onCreated={(d) =>
              setDrivers((prev) => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)))
            }
          />
        </div>
        {drivers.map((d) => (
          <DriverCard
            key={d.id}
            driver={d}
            onDeleted={(id) => setDrivers((prev) => prev.filter((x) => x.id !== id))}
          />
        ))}
      </div>
    </main>
  );
}

function NewDriverCard({ onCreated }: { onCreated: (d: any) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    phone: "",
    vehicleModel: "",
    vehiclePlate: "",
    vehicleColor: "",
    vehicleSeats: 4,
    vehicleClass: "STANDARD",
    medicalAllowed: false,
    hasRamp: false,
    hasStretcher: false,
    pScheinUntil: "",
    wheelchairTrained: false,
    qualifications: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(k: string, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function create() {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/admin/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, vehicleSeats: Number(form.vehicleSeats) }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Anlegen fehlgeschlagen.");
      return;
    }
    onCreated(data.driver);
    setForm({ name: "", username: "", password: "", phone: "", vehicleModel: "", vehiclePlate: "", vehicleColor: "", vehicleSeats: 4, vehicleClass: "STANDARD", medicalAllowed: false, hasRamp: false, hasStretcher: false, pScheinUntil: "", wheelchairTrained: false, qualifications: "" });
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} data-testid="add-driver-btn" className="btn-primary w-full">
        + Neuen Fahrer anlegen
      </button>
    );
  }

  return (
    <div className="card p-5">
      <h2 className="mb-3 font-bold text-ink-900">Neuen Fahrer anlegen</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field testid="new-driver-name" label="Name *" value={form.name} onChange={(v) => set("name", v)} />
        <Field testid="new-driver-phone" label="Telefon" value={form.phone} onChange={(v) => set("phone", v)} />
        <Field testid="new-driver-username" label="Benutzername *" value={form.username} onChange={(v) => set("username", v)} />
        <Field testid="new-driver-password" label="Passwort *" value={form.password} onChange={(v) => set("password", v)} type="password" />
        <Field testid="new-driver-vehicle" label="Fahrzeug" value={form.vehicleModel} onChange={(v) => set("vehicleModel", v)} />
        <Field testid="new-driver-plate" label="Kennzeichen" value={form.vehiclePlate} onChange={(v) => set("vehiclePlate", v)} />
        <Field testid="new-driver-color" label="Farbe" value={form.vehicleColor} onChange={(v) => set("vehicleColor", v)} />
        <Field testid="new-driver-seats" label="Sitzplätze" type="number" value={String(form.vehicleSeats)} onChange={(v) => set("vehicleSeats", v)} />
        <ClassSelect testid="new-driver-class" value={form.vehicleClass} onChange={(v) => set("vehicleClass", v)} />
        <div className="sm:col-span-2"><MedicalToggles form={form} set={set} prefix="new-driver" /></div>
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700" data-testid="new-driver-error">{error}</p>}
      <div className="mt-4 flex gap-3">
        <button onClick={() => setOpen(false)} className="btn-ghost flex-1">Abbrechen</button>
        <button onClick={create} disabled={saving} data-testid="new-driver-submit" className="btn-primary flex-1">
          {saving ? "Anlegen …" : "Fahrer anlegen"}
        </button>
      </div>
    </div>
  );
}

function DriverCard({ driver, onDeleted }: { driver: any; onDeleted: (id: string) => void }) {
  const [form, setForm] = useState({
    name: driver.name ?? "",
    phone: driver.phone ?? "",
    vehicleModel: driver.vehicleModel ?? "",
    vehiclePlate: driver.vehiclePlate ?? "",
    vehicleColor: driver.vehicleColor ?? "",
    vehicleSeats: driver.vehicleSeats ?? 4,
    vehicleClass: driver.vehicleClass ?? "STANDARD",
    medicalAllowed: driver.medicalAllowed ?? false,
    hasRamp: driver.hasRamp ?? false,
    hasStretcher: driver.hasStretcher ?? false,
    pScheinUntil: driver.pScheinUntil ?? "",
    wheelchairTrained: driver.wheelchairTrained ?? false,
    qualifications: driver.qualifications ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  function set(k: string, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/drivers/${driver.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, vehicleSeats: Number(form.vehicleSeats) }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function remove() {
    setDeleting(true);
    setDelErr(null);
    const res = await fetch(`/api/admin/drivers/${driver.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setDelErr(d?.error ?? "Löschen fehlgeschlagen.");
      return;
    }
    onDeleted(driver.id);
  }

  return (
    <div className="card p-5" data-testid={`driver-card-${driver.username}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">{driver.username}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
          style={{
            backgroundColor:
              driver.status === "FREI"
                ? "#10B981"
                : driver.status === "BESETZT"
                ? "#EF4444"
                : driver.status === "PAUSE"
                ? "#FFC400"
                : "#9CA3AF",
            color: driver.status === "PAUSE" ? "#111827" : "#fff",
          }}
        >
          {driver.status}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2"><PScheinChip driver={driver} /></div>
      <div className="grid gap-3">
        <Field testid={`driver-${driver.username}-name`} label="Name" value={form.name} onChange={(v) => set("name", v)} />
        <Field testid={`driver-${driver.username}-phone`} label="Telefon" value={form.phone} onChange={(v) => set("phone", v)} />
        <Field testid={`driver-${driver.username}-vehicle`} label="Fahrzeug" value={form.vehicleModel} onChange={(v) => set("vehicleModel", v)} />
        <div className="grid grid-cols-2 gap-3">
          <Field testid={`driver-${driver.username}-plate`} label="Kennzeichen" value={form.vehiclePlate} onChange={(v) => set("vehiclePlate", v)} />
          <Field testid={`driver-${driver.username}-color`} label="Farbe" value={form.vehicleColor} onChange={(v) => set("vehicleColor", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field testid={`driver-${driver.username}-seats`} label="Sitzplätze" type="number" value={String(form.vehicleSeats)} onChange={(v) => set("vehicleSeats", v)} />
          <ClassSelect testid={`driver-${driver.username}-class`} value={form.vehicleClass} onChange={(v) => set("vehicleClass", v)} />
        </div>
        <MedicalToggles form={form} set={set} prefix={`driver-${driver.username}`} />
      </div>
      {delErr && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{delErr}</p>}
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
        <button onClick={save} disabled={saving} data-testid={`driver-${driver.username}-save`} className="btn-primary">
          {saving ? "Speichern …" : saved ? "✓ Gespeichert" : "Speichern"}
        </button>
        {confirmDel ? (
          <button
            onClick={remove}
            disabled={deleting}
            data-testid={`driver-${driver.username}-confirm-delete`}
            className="btn-danger"
          >
            {deleting ? "…" : "Wirklich?"}
          </button>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            data-testid={`driver-${driver.username}-delete`}
            className="btn-ghost text-red-600"
            aria-label="Fahrer löschen"
          >
            Löschen
          </button>
        )}
      </div>
    </div>
  );
}

function ClassSelect({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid?: string }) {
  return (
    <div>
      <label className="label">Fahrzeugklasse</label>
      <select className="field" value={value} data-testid={testid} onChange={(e) => onChange(e.target.value)}>
        {VEHICLE_CLASSES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.icon} {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckToggle({ checked, onChange, testid, label }: { checked: boolean; onChange: (v: boolean) => void; testid?: string; label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border-2 border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
      <input
        type="checkbox"
        className="h-5 w-5 accent-brand-500"
        checked={checked}
        data-testid={testid}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

// Gruppe der Krankenfahrt-Eigenschaften eines Fahrers (Freigabe + Ausstattung).
function MedicalToggles({ form, set, prefix }: { form: any; set: (k: string, v: any) => void; prefix: string }) {
  return (
    <div className="grid gap-2">
      <CheckToggle testid={`${prefix}-medical`} label="🩺 Für Krankenfahrten freigegeben" checked={!!form.medicalAllowed} onChange={(v) => set("medicalAllowed", v)} />
      {form.medicalAllowed && (
        <div className="grid grid-cols-2 gap-2">
          <CheckToggle testid={`${prefix}-ramp`} label="🦽 Rollstuhlrampe/Lift" checked={!!form.hasRamp} onChange={(v) => set("hasRamp", v)} />
          <CheckToggle testid={`${prefix}-stretcher`} label="🛏️ Tragestuhl" checked={!!form.hasStretcher} onChange={(v) => set("hasStretcher", v)} />
        </div>
      )}
      <div className="grid gap-2 rounded-xl border-2 border-ink-200 bg-white p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Qualifikationen</p>
        <label className="grid gap-1 text-xs font-semibold text-ink-600">
          P-Schein gültig bis
          <input className="field" type="date" data-testid={`${prefix}-pschein`} value={form.pScheinUntil ?? ""} onChange={(e) => set("pScheinUntil", e.target.value)} />
        </label>
        <CheckToggle testid={`${prefix}-wheelchair-trained`} label="♿ Rollstuhlhilfe geschult" checked={!!form.wheelchairTrained} onChange={(v) => set("wheelchairTrained", v)} />
        <input className="field" data-testid={`${prefix}-quals`} placeholder="Sonderqualifikationen (optional)" value={form.qualifications ?? ""} onChange={(e) => set("qualifications", e.target.value)} />
      </div>
    </div>
  );
}

function PScheinChip({ driver }: { driver: any }) {
  if (!driver.pScheinUntil) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-500">P-Schein: fehlt</span>;
  }
  const s = driver.pSchein?.status;
  const cfg =
    s === "EXPIRED" ? { dot: "🔴", cls: "bg-red-100 text-red-700", txt: "P-Schein abgelaufen" }
    : s === "EXPIRING" ? { dot: "🟡", cls: "bg-amber-100 text-amber-800", txt: `P-Schein: ${driver.pSchein.days} T.` }
    : { dot: "🟢", cls: "bg-green-100 text-green-800", txt: "P-Schein gültig" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.cls}`}>{cfg.dot} {cfg.txt}</span>;
}

function Field({ label, value, onChange, type = "text", testid }: { label: string; value: string; onChange: (v: string) => void; type?: string; testid?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="field"
        type={type}
        value={value}
        data-testid={testid}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
