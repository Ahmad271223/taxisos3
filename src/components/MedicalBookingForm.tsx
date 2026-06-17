"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { formatEuro } from "@/lib/format";
import type { GeocodeResult } from "@/lib/geo";
import type { MapMarker } from "@/components/Map";
import { MEDICAL_TYPES, MOBILITY_OPTIONS, EQUIPMENT_OPTIONS, PAYER_TYPES } from "@/lib/medical";
import { VEHICLE_CLASSES } from "@/lib/vehicleClasses";

// Datei -> Base64 (ohne data:-Prefix) für den Dokumenten-Upload (Phase C).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

type Mode = "single" | "recurring";
interface Addr {
  address: string;
  lat?: number;
  lng?: number;
}

// Mo..So -> JS-Wochentag (0=So)
const WEEKDAYS: { label: string; value: number }[] = [
  { label: "Mo", value: 1 },
  { label: "Di", value: 2 },
  { label: "Mi", value: 3 },
  { label: "Do", value: 4 },
  { label: "Fr", value: 5 },
  { label: "Sa", value: 6 },
  { label: "So", value: 0 },
];

export function MedicalBookingForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("single");
  const [medicalType, setMedicalType] = useState("DIALYSE");
  const [vehicleClass, setVehicleClass] = useState("WHEELCHAIR");
  const [pickup, setPickup] = useState<Addr>({ address: "" });
  const [dest, setDest] = useState<Addr>({ address: "" });
  const [notes, setNotes] = useState("");

  // Phase B: Patient (falls abweichend), Mobilität, Begleitung, Ausstattung, Kostenträger.
  const [patientDifferent, setPatientDifferent] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientBirthDate, setPatientBirthDate] = useState("");
  const [mobility, setMobility] = useState("WALK");
  const [companions, setCompanions] = useState(0);
  const [equipment, setEquipment] = useState<Set<string>>(new Set());
  const [requiresRamp, setRequiresRamp] = useState(false);
  const [requiresStretcher, setRequiresStretcher] = useState(false);
  const [payerType, setPayerType] = useState("SELF");
  const [insuranceName, setInsuranceName] = useState("");
  const [insuranceNumber, setInsuranceNumber] = useState("");
  // Phase C: Nachweise (Verordnung/Genehmigung), nach Buchung hochgeladen.
  const [files, setFiles] = useState<File[]>([]);
  const [docKind, setDocKind] = useState("VERORDNUNG");
  const [docValidUntil, setDocValidUntil] = useState("");
  // Einzelfahrt: optionale automatische Rückfahrt.
  const [returnSingle, setReturnSingle] = useState(false);
  const [returnTimeSingle, setReturnTimeSingle] = useState("");

  function toggleEquip(k: string) {
    setEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // Gemeinsame Krankenfahrt-Detailfelder fuer beide Submit-Pfade.
  function medicalDetailFields() {
    return {
      patientName: patientDifferent && patientName.trim() ? patientName.trim() : null,
      patientBirthDate: patientDifferent && patientBirthDate ? patientBirthDate : null,
      mobility,
      companions,
      medicalEquipment: Array.from(equipment),
      requiresRamp,
      requiresStretcher,
      payerType,
      insuranceName: payerType === "INSURANCE" ? insuranceName.trim() || null : null,
      insuranceNumber: payerType === "INSURANCE" ? insuranceNumber.trim() || null : null,
    };
  }

  // Nachweise nach erfolgreicher Buchung/Serie hochladen (best effort).
  async function uploadDocuments(ref: { bookingId?: string; recurringId?: string }) {
    for (const f of files) {
      try {
        const dataBase64 = await fileToBase64(f);
        await fetch("/api/medical/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: docKind, validUntil: docValidUntil || null, fileName: f.name, mimeType: f.type || "application/octet-stream", dataBase64, ...ref }),
        });
      } catch {
        /* ein fehlgeschlagener Upload darf die Buchung nicht blockieren */
      }
    }
  }

  // Einmalig
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // Regelmäßig
  const [days, setDays] = useState<Set<number>>(new Set([1, 3, 5]));
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [returnTrip, setReturnTrip] = useState(false);
  const [returnTimeOfDay, setReturnTimeOfDay] = useState("12:00");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [account, setAccount] = useState<{ name: string; phone: string } | null>(null);
  const [verifyState, setVerifyState] = useState<"idle" | "sent" | "verified">("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [quote, setQuote] = useState<any | null>(null);
  const [routeLine, setRouteLine] = useState<[number, number][] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const haveRoute = pickup.lat != null && dest.lat != null;

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const c = d.customer;
        if (c && c.role === "CUSTOMER") {
          setAccount({ name: c.name ?? "", phone: c.phone ?? "" });
          setName((n) => (n.trim() ? n : c.name ?? ""));
          setPhone((p) => (p.trim() ? p : c.phone ?? ""));
        }
      })
      .catch(() => {});
  }, []);

  const onlyDigits = (s: string) => s.replace(/[^0-9]/g, "");
  const accountVerified = !!account && phone.trim() !== "" && onlyDigits(phone) === onlyDigits(account.phone);
  const verified = !!verificationToken || accountVerified;

  useEffect(() => {
    if (!haveRoute) {
      setQuote(null);
      setRouteLine(null);
      return;
    }
    let cancelled = false;
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: { lat: pickup.lat, lng: pickup.lng }, to: { lat: dest.lat, lng: dest.lng }, vehicleClass }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setQuote(d);
        setRouteLine(d.geometry ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, dest.lat, dest.lng, vehicleClass]);

  function toggleDay(v: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  async function requestCode() {
    setVerifyBusy(true);
    setVerifyError(null);
    setDevCodeHint(null);
    try {
      const res = await fetch("/api/verify/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "SMS", target: phone }) });
      const d = await res.json();
      if (!res.ok) setVerifyError(d.error ?? "Code konnte nicht gesendet werden.");
      else {
        setVerifyState("sent");
        if (d.devCode) setDevCodeHint(d.devCode);
      }
    } catch {
      setVerifyError("Netzwerkfehler.");
    } finally {
      setVerifyBusy(false);
    }
  }
  async function confirmCode() {
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/verify/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "SMS", target: phone, code: verifyCode.trim() }) });
      const d = await res.json();
      if (!res.ok || !d.token) setVerifyError(d.error ?? "Code falsch.");
      else {
        setVerificationToken(d.token);
        setVerifyState("verified");
      }
    } catch {
      setVerifyError("Netzwerkfehler.");
    } finally {
      setVerifyBusy(false);
    }
  }

  async function submitSingle() {
    setError(null);
    setSubmitting(true);
    let scheduledAt: string | null = null;
    if (date && time) scheduledAt = new Date(`${date}T${time}`).toISOString();
    const returnAt = returnSingle && date && returnTimeSingle ? new Date(`${date}T${returnTimeSingle}`).toISOString() : null;
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          pickupAddress: pickup.address,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          destAddress: dest.address,
          dest: { lat: dest.lat, lng: dest.lng },
          vehicleClass,
          medicalType,
          ...medicalDetailFields(),
          notes: notes || null,
          scheduledAt,
          returnAt,
          verificationToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Buchung fehlgeschlagen.");
        setSubmitting(false);
        return;
      }
      if (files.length) await uploadDocuments({ bookingId: data.id });
      router.push(`/verfolgen/${data.booking?.trackingRef ?? data.id}`);
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
      setSubmitting(false);
    }
  }

  async function submitRecurring() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: { address: pickup.address, lat: pickup.lat, lng: pickup.lng },
          dest: { address: dest.address, lat: dest.lat, lng: dest.lng },
          vehicleClass,
          medicalType,
          ...medicalDetailFields(),
          daysOfWeek: Array.from(days),
          timeOfDay,
          returnTrip,
          returnTimeOfDay: returnTrip ? returnTimeOfDay : null,
          startDate: startDate || null,
          endDate: endDate || null,
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Serie konnte nicht angelegt werden.");
        setSubmitting(false);
        return;
      }
      if (files.length && data.id) await uploadDocuments({ recurringId: data.id });
      router.push("/konto");
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
      setSubmitting(false);
    }
  }

  const singleOk = haveRoute && name.trim() && phone.trim() && verified && !submitting;
  const recurringOk = haveRoute && !!account && days.size > 0 && !submitting;

  return (
    <div className="grid gap-5" data-testid="medical-form">
      {/* Einmalig / Regelmäßig */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" data-testid="mode-single" onClick={() => setMode("single")} className={`rounded-2xl border-2 p-3 font-display font-extrabold transition ${mode === "single" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>
          Einmalig
        </button>
        <button type="button" data-testid="mode-recurring" onClick={() => setMode("recurring")} className={`rounded-2xl border-2 p-3 font-display font-extrabold transition ${mode === "recurring" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>
          Regelmäßig
        </button>
      </div>

      {/* Art der Fahrt */}
      <div>
        <label className="label">Art der Fahrt</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MEDICAL_TYPES.map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`medical-${m.key}`}
              onClick={() => setMedicalType(m.key)}
              className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${medicalType === m.key ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Fahrzeug</label>
        <select className="field" data-testid="medical-vclass" value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
          {VEHICLE_CLASSES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Abholadresse *</label>
        <AddressInput label="Abholung" hideLabel placeholder="Wo geht es los?" value={pickup.address} onChange={(t) => setPickup({ address: t })} onSelect={(r: GeocodeResult) => setPickup({ address: r.label, lat: r.lat, lng: r.lng })} required />
      </div>
      <div>
        <label className="label">Zieladresse *</label>
        <AddressInput label="Ziel" hideLabel placeholder="z. B. Dialysezentrum, Klinik" value={dest.address} onChange={(t) => setDest({ address: t })} onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })} required />
      </div>

      {haveRoute && (
        <div className="overflow-hidden rounded-2xl ring-1 ring-ink-200 shadow-card">
          <div className="h-40">
            <Map
              center={[((pickup.lat as number) + (dest.lat as number)) / 2, ((pickup.lng as number) + (dest.lng as number)) / 2]}
              markers={[
                { id: "p", lat: pickup.lat as number, lng: pickup.lng as number, kind: "pickup", popup: "Abholung" },
                { id: "d", lat: dest.lat as number, lng: dest.lng as number, kind: "dest", popup: "Ziel" },
              ] as MapMarker[]}
              line={routeLine ?? undefined}
              fit
            />
          </div>
        </div>
      )}
      {quote && (
        <p className="text-sm text-ink-600" data-testid="medical-quote">Pro Fahrt ca. <span className="font-extrabold text-ink-900">{formatEuro(quote.priceApprox ?? quote.priceMid)}</span></p>
      )}

      {/* Phase B/C/D: Patient, Mobilität, Ausstattung, Kostenträger, Nachweise */}
      <details className="rounded-2xl border-2 border-ink-200 bg-white p-4" data-testid="medical-details" open>
        <summary className="cursor-pointer font-display font-extrabold text-ink-900">Patient &amp; Mobilität</summary>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Mobilität</label>
              <select className="field" data-testid="medical-mobility" value={mobility} onChange={(e) => setMobility(e.target.value)}>
                {MOBILITY_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.icon} {m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Begleitpersonen</label>
              <input className="field" type="number" min={0} max={6} data-testid="medical-companions" value={companions} onChange={(e) => setCompanions(Math.max(0, Math.min(6, Number(e.target.value) || 0)))} />
            </div>
          </div>

          <div>
            <label className="label">Mitzuführende Ausstattung</label>
            <div className="flex flex-wrap gap-2" data-testid="medical-equipment">
              {EQUIPMENT_OPTIONS.map((eq) => (
                <button key={eq.key} type="button" data-testid={`equip-${eq.key}`} onClick={() => toggleEquip(eq.key)}
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${equipment.has(eq.key) ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>
                  {eq.icon} {eq.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
              <input type="checkbox" className="h-5 w-5 accent-brand-500" data-testid="medical-ramp" checked={requiresRamp} onChange={(e) => setRequiresRamp(e.target.checked)} /> 🦽 Rollstuhlrampe nötig
            </label>
            <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
              <input type="checkbox" className="h-5 w-5 accent-brand-500" data-testid="medical-stretcher" checked={requiresStretcher} onChange={(e) => setRequiresStretcher(e.target.checked)} /> 🛏️ Tragestuhl nötig
            </label>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <input type="checkbox" data-testid="medical-patient-different" checked={patientDifferent} onChange={(e) => setPatientDifferent(e.target.checked)} /> Patient weicht vom Besteller ab
            </label>
            {patientDifferent && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input className="field" data-testid="medical-patient-name" placeholder="Name des Patienten" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
                <input className="field" type="date" data-testid="medical-patient-birth" value={patientBirthDate} onChange={(e) => setPatientBirthDate(e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <label className="label">Kostenträger</label>
            <div className="grid grid-cols-2 gap-2" data-testid="medical-payer">
              {PAYER_TYPES.map((p) => (
                <button key={p.key} type="button" data-testid={`payer-${p.key}`} onClick={() => setPayerType(p.key)}
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${payerType === p.key ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
            {payerType === "INSURANCE" && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input className="field" data-testid="medical-insurance-name" placeholder="Krankenkasse" value={insuranceName} onChange={(e) => setInsuranceName(e.target.value)} />
                <input className="field" data-testid="medical-insurance-number" placeholder="Versichertennummer" value={insuranceNumber} onChange={(e) => setInsuranceNumber(e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <label className="label">Nachweise (PDF/Foto)</label>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
              <select className="field" data-testid="medical-doc-kind" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                <option value="VERORDNUNG">Verordnung</option>
                <option value="GENEHMIGUNG">Genehmigung</option>
                <option value="REZEPT">Rezept</option>
                <option value="BESCHEINIGUNG">Arztbescheinigung</option>
              </select>
              <input className="field" type="file" multiple accept="application/pdf,image/*" data-testid="medical-docs"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </div>
            <label className="mt-2 grid gap-1 text-xs text-ink-500">
              Gültig bis (z. B. Genehmigung/Verordnung) – optional
              <input className="field" type="date" data-testid="medical-doc-valid" value={docValidUntil} onChange={(e) => setDocValidUntil(e.target.value)} />
            </label>
            {files.length > 0 && <p className="mt-1 text-xs text-ink-500" data-testid="medical-docs-count">{files.length} Datei(en) als {docKind.toLowerCase()} ausgewählt{docValidUntil ? `, gültig bis ${docValidUntil}` : ""}</p>}
          </div>
        </div>
      </details>

      {mode === "single" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Datum (optional)</label>
              <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Uhrzeit (optional)</label>
              <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="rounded-2xl border-2 border-ink-200 bg-white p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <input type="checkbox" data-testid="single-return" checked={returnSingle} onChange={(e) => setReturnSingle(e.target.checked)} /> Rückfahrt am selben Tag planen
            </label>
            {returnSingle && (
              <div className="mt-2">
                <input className="field" type="time" data-testid="single-return-time" value={returnTimeSingle} onChange={(e) => setReturnTimeSingle(e.target.value)} />
                {!date && <p className="mt-1 text-xs text-amber-600">Bitte oben ein Datum wählen, damit die Rückfahrt geplant werden kann.</p>}
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name *</label>
              <input className="field" data-testid="medical-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label">Telefonnummer *</label>
              <input className="field" data-testid="medical-phone" type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setVerificationToken(null); setVerifyState("idle"); setVerifyCode(""); setDevCodeHint(null); }} required />
            </div>
          </div>

          {accountVerified ? (
            <p className="rounded-2xl border-2 border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800" data-testid="medical-verify-account">✓ Angemeldet als {account?.name} – Nummer bereits bestätigt.</p>
          ) : (
            <div className="rounded-2xl border-2 border-ink-200 bg-white p-4" data-testid="medical-verify">
              {verifyState !== "verified" ? (
                <div className="grid gap-2">
                  <p className="text-sm text-ink-600">SMS-Code an <span className="font-bold">{phone || "Ihre Nummer"}</span> senden.</p>
                  {verifyState === "idle" ? (
                    <button type="button" onClick={requestCode} disabled={verifyBusy || !phone.trim()} data-testid="medical-verify-send" className="btn-dark justify-self-start disabled:opacity-60">{verifyBusy ? "Sende …" : "SMS-Code senden"}</button>
                  ) : (
                    <>
                      {devCodeHint && <p data-testid="medical-verify-devcode" className="rounded bg-brand-50 px-2 py-1 text-xs font-semibold">Testmodus – Code: <span className="font-mono font-bold">{devCodeHint}</span></p>}
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input className="field text-center font-mono" inputMode="numeric" maxLength={6} placeholder="Code" data-testid="medical-verify-code" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))} />
                        <button type="button" onClick={confirmCode} disabled={verifyBusy || verifyCode.length < 4} data-testid="medical-verify-confirm" className="btn-primary disabled:opacity-60">Bestätigen</button>
                      </div>
                    </>
                  )}
                  {verifyError && <p className="text-xs font-bold text-red-600" data-testid="medical-verify-error">{verifyError}</p>}
                </div>
              ) : (
                <p className="text-sm font-bold text-green-700">✓ Nummer bestätigt</p>
              )}
            </div>
          )}

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" data-testid="medical-error">{error}</p>}
          <button onClick={submitSingle} disabled={!singleOk} data-testid="medical-submit-single" className="btn-primary text-lg disabled:opacity-60">
            {submitting ? "Wird gebucht …" : "Krankenfahrt buchen"}
          </button>
        </>
      ) : (
        <>
          {!account ? (
            <div className="rounded-2xl border-2 border-ink-200 bg-ink-50 p-4 text-sm" data-testid="recurring-login-hint">
              Für <span className="font-bold">regelmäßige</span> Fahrten ist ein Kundenkonto nötig.{" "}
              <Link href="/konto" className="font-bold text-ink-900 underline">Jetzt anmelden / Konto erstellen</Link>
            </div>
          ) : (
            <>
              <div>
                <label className="label">Wochentage *</label>
                <div className="flex flex-wrap gap-2" data-testid="recurring-days">
                  {WEEKDAYS.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      data-testid={`day-${w.value}`}
                      onClick={() => toggleDay(w.value)}
                      className={`h-10 w-10 rounded-full border-2 text-sm font-bold transition ${days.has(w.value) ? "border-brand-500 bg-brand-500 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Uhrzeit Hinfahrt *</label>
                  <input className="field" type="time" data-testid="recurring-time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
                </div>
                <div className="flex flex-col">
                  <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                    <input type="checkbox" data-testid="recurring-return" checked={returnTrip} onChange={(e) => setReturnTrip(e.target.checked)} /> Rückfahrt
                  </label>
                  {returnTrip && <input className="field mt-2" type="time" data-testid="recurring-return-time" value={returnTimeOfDay} onChange={(e) => setReturnTimeOfDay(e.target.value)} />}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Startdatum (optional)</label>
                  <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Enddatum (optional)</label>
                  <input className="field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" data-testid="medical-error">{error}</p>}
              <button onClick={submitRecurring} disabled={!recurringOk} data-testid="medical-submit-recurring" className="btn-primary text-lg disabled:opacity-60">
                {submitting ? "Wird angelegt …" : "Serie anlegen"}
              </button>
            </>
          )}
        </>
      )}

      <details className="rounded-2xl border border-ink-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-ink-700">Bemerkung</summary>
        <textarea className="field mt-3" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="z. B. Rollstuhl, Begleitperson, Stockwerk" />
      </details>
    </div>
  );
}
