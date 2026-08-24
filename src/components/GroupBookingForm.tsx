"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { formatEuro, formatDistance, formatDuration } from "@/lib/format";
import type { GeocodeResult } from "@/lib/geo";
import type { MapMarker } from "@/components/Map";
import { suggestFleet, vehicleClass as vehicleClassInfo, type FleetOption } from "@/lib/vehicleClasses";

import { CardChooser } from "@/components/CardChooser";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

interface Addr {
  address: string;
  lat?: number;
  lng?: number;
}

export function GroupBookingForm() {
  const router = useRouter();
  const [pickup, setPickup] = useState<Addr>({ address: "" });
  const [dest, setDest] = useState<Addr>({ address: "" });
  const [passengers, setPassengers] = useState(8);
  const [luggage, setLuggage] = useState(0);
  const [eventLabel, setEventLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<"CASH" | "CARD">("CASH");
  // Bei Kartenzahlung gilt die gespeicherte Karte des Kontos – es wird nichts reserviert.
  const [cardId, setCardId] = useState<string | null>(null);
  const [hasUsableCard, setHasUsableCard] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // Klassenpreise (für die Optionspreise) aus dem Quote.
  const [priceByClass, setPriceByClass] = useState<Record<string, number>>({});
  const [quoteMeta, setQuoteMeta] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [routeLine, setRouteLine] = useState<[number, number][] | null>(null);

  // Gewählte Flotte (immer eine Einzelklasse aus den Vorschlägen, manuell anpassbar).
  const [selected, setSelected] = useState<FleetOption | null>(null);

  // Telefon-Verifizierung
  const [account, setAccount] = useState<{ name: string; phone: string } | null>(null);
  const [verifyState, setVerifyState] = useState<"idle" | "sent" | "verified">("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const haveRoute = pickup.lat != null && dest.lat != null;

  // Konto laden + Felder vorausfüllen.
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

  // Klassenpreise holen, sobald die Route steht.
  useEffect(() => {
    if (!haveRoute) {
      setPriceByClass({});
      setQuoteMeta(null);
      setRouteLine(null);
      return;
    }
    let cancelled = false;
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: { lat: pickup.lat, lng: pickup.lng }, to: { lat: dest.lat, lng: dest.lng } }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const c of d.classes ?? []) map[c.key] = c.price;
        setPriceByClass(map);
        setQuoteMeta({ distanceMeters: d.distanceMeters, durationSeconds: d.durationSeconds });
        setRouteLine(d.geometry ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, dest.lat, dest.lng]);

  // Flotten-Vorschläge neu berechnen, wenn Personen/Gepäck sich ändern.
  const options = suggestFleet(passengers, luggage);
  // Empfehlung: günstigste Option (sobald Preise feststehen), sonst die mit den
  // wenigsten Fahrzeugen ("optimale Kosten" – z. B. 1 Van statt 2 Taxis).
  const recommendedId = (() => {
    const priced = options.filter((o) => optionPrice(o) > 0);
    if (priced.length) return priced.reduce((a, b) => (optionPrice(b) < optionPrice(a) ? b : a)).id;
    return options.reduce((a, b) => (b.vehicleCount < a.vehicleCount ? b : a), options[0])?.id;
  })();
  useEffect(() => {
    setSelected((prev) => {
      if (prev && options.some((o) => o.id === prev.id)) return prev;
      return options[0] ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers, luggage]);

  function optionPrice(o: FleetOption): number {
    return o.vehicles.reduce((sum, v) => sum + (priceByClass[v.classKey] ?? 0) * v.count, 0);
  }

  // Manueller Stepper für die gewählte (Einzelklasse-)Flotte.
  function adjustCount(delta: number) {
    setSelected((o) => {
      if (!o) return o;
      const v = o.vehicles[0];
      const count = Math.max(1, Math.min(100, v.count + delta));
      const c = vehicleClassInfo(v.classKey);
      return {
        ...o,
        id: "custom",
        label: `${count}× ${c.short}`,
        vehicles: [{ classKey: v.classKey, count }],
        vehicleCount: count,
        totalSeats: c.seats * count,
        totalLuggage: c.luggage * count,
      };
    });
  }

  async function requestCode() {
    setVerifyBusy(true);
    setVerifyError(null);
    setDevCodeHint(null);
    try {
      const res = await fetch("/api/verify/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "SMS", target: phone }),
      });
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
      const res = await fetch("/api/verify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "SMS", target: phone, code: verifyCode.trim() }),
      });
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

  async function submit() {
    if (!selected || !haveRoute) return;
    setError(null);
    setSubmitting(true);
    let scheduledAt: string | null = null;
    if (scheduled && date && time) scheduledAt = new Date(`${date}T${time}`).toISOString();
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          pickupAddress: pickup.address,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          destAddress: dest.address,
          dest: { lat: dest.lat, lng: dest.lng },
          vehicles: selected.vehicles,
          totalPassengers: passengers,
          totalLuggage: luggage,
          eventLabel: eventLabel || null,
          notes: notes || null,
          scheduledAt,
          paymentMethod: payment,
          cardId: payment === "CARD" ? cardId : null,
          verificationToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Buchung fehlgeschlagen.");
        setSubmitting(false);
        return;
      }
      router.push(`/gruppe/${data.id}`);
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
      setSubmitting(false);
    }
  }

  const seatsOk = !selected || selected.totalSeats >= passengers;
  const canSubmit = haveRoute && !!selected && name.trim() && phone.trim() && verified && seatsOk && !submitting;

  return (
    <div className="grid gap-5" data-testid="group-form">
      <div className="grid gap-4">
        <div>
          <label className="label">Abholadresse *</label>
          <AddressInput
            label="Abholadresse"
            hideLabel
            placeholder="Wo geht es für alle los?"
            value={pickup.address}
            onChange={(t) => setPickup({ address: t })}
            onSelect={(r: GeocodeResult) => setPickup({ address: r.label, lat: r.lat, lng: r.lng })}
            required
          />
        </div>
        <div>
          <label className="label">Zieladresse *</label>
          <AddressInput
            label="Zieladresse"
            hideLabel
            placeholder="Gemeinsames Ziel"
            value={dest.address}
            onChange={(t) => setDest({ address: t })}
            onSelect={(r: GeocodeResult) => setDest({ address: r.label, lat: r.lat, lng: r.lng })}
            required
          />
        </div>
      </div>

      {haveRoute && (
        <div className="overflow-hidden rounded-2xl ring-1 ring-ink-200 shadow-card">
          <div className="h-48">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Personen gesamt *</label>
          <input className="field" data-testid="group-passengers" type="number" min={1} max={800} value={passengers} onChange={(e) => setPassengers(Math.max(1, Number(e.target.value)))} />
        </div>
        <div>
          <label className="label">Gepäckstücke gesamt</label>
          <input className="field" data-testid="group-luggage" type="number" min={0} max={800} value={luggage} onChange={(e) => setLuggage(Math.max(0, Number(e.target.value)))} />
        </div>
      </div>

      <div>
        <label className="label">Anlass (optional)</label>
        <input className="field" data-testid="group-event" placeholder="z. B. Hochzeit Müller, Messe-Shuttle" value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} />
      </div>

      <div>
        <label className="label">Zahlart</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-testid="group-pay-cash" onClick={() => setPayment("CASH")} className={`rounded-2xl border-2 p-3 text-sm font-bold transition ${payment === "CASH" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>
            💶 Barzahlung
          </button>
          <button type="button" data-testid="group-pay-card" onClick={() => setPayment("CARD")} className={`rounded-2xl border-2 p-3 text-sm font-bold transition ${payment === "CARD" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}>
            💳 Kartenzahlung
          </button>
        </div>

        {payment === "CARD" && (
          <div className="mt-3">
            <CardChooser
              loggedIn={!!account}
              value={cardId}
              onChange={(id, usable) => {
                setCardId(id);
                setHasUsableCard(usable);
              }}
            />
          </div>
        )}
      </div>

      {/* Flotten-Vorschläge */}
      <div data-testid="fleet-options">
        <p className="eyebrow mb-2">Fahrzeuge wählen</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const isSel = selected?.vehicles[0]?.classKey === o.vehicles[0]?.classKey && (selected?.id === o.id || selected?.id === "custom");
            const c = vehicleClassInfo(o.vehicles[0].classKey);
            const price = optionPrice(o);
            return (
              <button
                key={o.id}
                type="button"
                data-testid={`fleet-${o.id}`}
                onClick={() => setSelected(o)}
                className={`rounded-2xl border-2 p-3 text-left transition ${isSel ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white hover:border-ink-300"}`}
              >
                <p className="font-display font-extrabold text-ink-900">
                  {c.icon} {o.label}
                  {o.id === recommendedId && <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-green-700" data-testid={`fleet-${o.id}-rec`}>Empfehlung</span>}
                </p>
                <p className="text-[11px] text-ink-500">{o.totalSeats} Plätze · {o.totalLuggage} Gepäck</p>
                {price > 0 && <p className="mt-1 font-bold text-ink-900" data-testid={`fleet-${o.id}-price`}>ca. {formatEuro(price)} gesamt</p>}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="mt-3 flex items-center justify-between rounded-2xl bg-ink-50 px-4 py-3" data-testid="fleet-summary">
            <div>
              <p className="text-sm font-bold text-ink-900">
                {vehicleClassInfo(selected.vehicles[0].classKey).icon} {selected.vehicleCount}× {vehicleClassInfo(selected.vehicles[0].classKey).short}
              </p>
              <p className="text-xs text-ink-500">{selected.totalSeats} Plätze · {priceByClass[selected.vehicles[0].classKey] ? `ca. ${formatEuro(optionPrice(selected))} gesamt` : "Preis nach Adresse"}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => adjustCount(-1)} data-testid="fleet-minus" className="grid h-8 w-8 place-items-center rounded-full border border-ink-300 font-bold">−</button>
              <span className="w-6 text-center font-extrabold" data-testid="fleet-count">{selected.vehicleCount}</span>
              <button type="button" onClick={() => adjustCount(1)} data-testid="fleet-plus" className="grid h-8 w-8 place-items-center rounded-full border border-ink-300 font-bold">+</button>
            </div>
          </div>
        )}
        {!seatsOk && (
          <p className="mt-2 text-xs font-semibold text-amber-700" data-testid="fleet-warn">
            Zu wenig Plätze für {passengers} Personen – bitte Anzahl erhöhen.
          </p>
        )}
        {quoteMeta && (
          <p className="mt-2 text-xs text-ink-500">📍 {formatDistance(quoteMeta.distanceMeters)} · ⏱ ca. {formatDuration(quoteMeta.durationSeconds)} je Fahrzeug</p>
        )}
      </div>

      {/* Vorbestellung */}
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
        <input type="checkbox" data-testid="group-scheduled" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
        Für später vorbestellen
      </label>
      {scheduled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Datum</label>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Uhrzeit</label>
            <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Ansprechpartner *</label>
          <input className="field" data-testid="group-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Telefonnummer *</label>
          <input
            className="field"
            data-testid="group-phone"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setVerificationToken(null);
              setVerifyState("idle");
              setVerifyCode("");
              setDevCodeHint(null);
            }}
            required
          />
        </div>
      </div>

      {/* Telefon bestätigen (entfällt für bestätigte Kontonummer) */}
      {accountVerified ? (
        <p className="rounded-2xl border-2 border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800" data-testid="group-verify-account">
          ✓ Angemeldet als {account?.name} – Nummer bereits bestätigt.
        </p>
      ) : (
        <div className="rounded-2xl border-2 border-ink-200 bg-white p-4" data-testid="group-verify">
          {verifyState !== "verified" ? (
            <div className="grid gap-2">
              <p className="text-sm text-ink-600">Wir senden einen SMS-Code an <span className="font-bold">{phone || "Ihre Nummer"}</span>.</p>
              {verifyState === "idle" ? (
                <button type="button" onClick={requestCode} disabled={verifyBusy || !phone.trim()} data-testid="group-verify-send" className="btn-dark justify-self-start disabled:opacity-60">
                  {verifyBusy ? "Sende …" : "SMS-Code senden"}
                </button>
              ) : (
                <>
                  {devCodeHint && <p data-testid="group-verify-devcode" className="rounded bg-brand-50 px-2 py-1 text-xs font-semibold">Testmodus – Code: <span className="font-mono font-bold">{devCodeHint}</span></p>}
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input className="field text-center font-mono" inputMode="numeric" maxLength={6} placeholder="Code" data-testid="group-verify-code" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))} />
                    <button type="button" onClick={confirmCode} disabled={verifyBusy || verifyCode.length < 4} data-testid="group-verify-confirm" className="btn-primary disabled:opacity-60">Bestätigen</button>
                  </div>
                </>
              )}
              {verifyError && <p className="text-xs font-bold text-red-600" data-testid="group-verify-error">{verifyError}</p>}
            </div>
          ) : (
            <p className="text-sm font-bold text-green-700">✓ Nummer bestätigt</p>
          )}
        </div>
      )}

      <details className="rounded-2xl border border-ink-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-ink-700">Bemerkung</summary>
        <textarea className="field mt-3" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="z. B. Sammelpunkt am Haupteingang" />
      </details>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" data-testid="group-error">{error}</p>}

      <button onClick={submit} disabled={!canSubmit} data-testid="group-submit" className="btn-primary text-lg disabled:opacity-60">
        {submitting ? "Wird gebucht …" : `${selected?.vehicleCount ?? ""} Fahrzeuge bestellen`}
      </button>
      {!haveRoute && <p className="text-center text-xs text-ink-400">Bitte zuerst Abhol- und Zieladresse eingeben.</p>}
      {haveRoute && !verified && <p className="text-center text-xs text-ink-400">Bitte Telefonnummer bestätigen.</p>}
    </div>
  );
}
