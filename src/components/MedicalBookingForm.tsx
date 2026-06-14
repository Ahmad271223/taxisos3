"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { formatEuro } from "@/lib/format";
import type { GeocodeResult } from "@/lib/geo";
import type { MapMarker } from "@/components/Map";
import { MEDICAL_TYPES } from "@/lib/medical";
import { VEHICLE_CLASSES } from "@/lib/vehicleClasses";

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
          notes: notes || null,
          scheduledAt,
          verificationToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Buchung fehlgeschlagen.");
        setSubmitting(false);
        return;
      }
      router.push(`/verfolgen/${data.id}`);
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
