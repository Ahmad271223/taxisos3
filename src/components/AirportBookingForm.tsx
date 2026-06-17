"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { LuggageMatrix } from "@/components/LuggageMatrix";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";
import { MEET_GREET_LEVELS, meetGreetFee, FREE_WAIT_MIN, WAIT_PER_MIN } from "@/lib/airportExtras";
import { resolveAirportPickup } from "@/lib/airportZones";
import { PickupZoneCard } from "@/components/PickupZoneCard";
import { formatEuro, formatDateTime } from "@/lib/format";
import type { GeocodeResult } from "@/lib/geo";
import type { MapMarker } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const BAGGAGE_BUFFER_MIN = 30;
type Direction = "ARRIVAL" | "DEPARTURE";

interface Addr {
  address: string;
  lat?: number;
  lng?: number;
}

export function AirportBookingForm() {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("ARRIVAL");
  const [airport, setAirport] = useState<Addr>({ address: "" });
  const [other, setOther] = useState<Addr>({ address: "" });

  const [flightNumber, setFlightNumber] = useState("");
  const [flightDate, setFlightDate] = useState("");
  const [flightTime, setFlightTime] = useState("");
  const [flight, setFlight] = useState<any | null>(null);
  const [flightBusy, setFlightBusy] = useState(false);
  const [flightError, setFlightError] = useState<string | null>(null);

  const [passengers, setPassengers] = useState(1);
  const [vehicleClass, setVehicleClass] = useState("STANDARD");
  const [meetGreet, setMeetGreet] = useState("BASIC");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [quote, setQuote] = useState<any | null>(null);
  const [routeLine, setRouteLine] = useState<[number, number][] | null>(null);

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

  // Bei Ankunft ist der Flughafen die Abholung, sonst das Ziel.
  const pickup = direction === "ARRIVAL" ? airport : other;
  const dest = direction === "ARRIVAL" ? other : airport;
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

  // Preis-Vorschau
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
      body: JSON.stringify({ from: { lat: pickup.lat, lng: pickup.lng }, to: { lat: dest.lat, lng: dest.lng } }),
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
  }, [pickup.lat, pickup.lng, dest.lat, dest.lng]);

  const flightScheduledAt = flightDate && flightTime ? new Date(`${flightDate}T${flightTime}`) : null;
  const delay = flight?.delayMinutes ?? 0;
  // Voraussichtliche Abholung bei Ankunft = Landung + Verspätung + Gepäckpuffer.
  const arrivalPickup =
    direction === "ARRIVAL" && flightScheduledAt
      ? new Date(flightScheduledAt.getTime() + (delay + BAGGAGE_BUFFER_MIN) * 60_000)
      : null;

  async function checkFlight() {
    if (!flightNumber.trim()) return;
    setFlightBusy(true);
    setFlightError(null);
    try {
      const res = await fetch("/api/flights/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flightNumber, direction, date: flightDate || null }),
      });
      const d = await res.json();
      if (!res.ok) setFlightError(d.error ?? "Flug nicht gefunden.");
      else {
        setFlight(d.flight);
        // Datum + Uhrzeit automatisch aus der geplanten Flughafenzeit übernehmen
        // (Wandzeit am Flughafen – direkt aus dem ISO-String, ohne Zeitzonen-Shift).
        const iso: string | null = d.flight?.scheduledAt ?? null;
        if (iso && iso.length >= 16) {
          setFlightDate(iso.slice(0, 10));
          setFlightTime(iso.slice(11, 16));
        }
      }
    } catch {
      setFlightError("Netzwerkfehler.");
    } finally {
      setFlightBusy(false);
    }
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
    if (!haveRoute) return;
    setError(null);
    setSubmitting(true);
    const body: any = {
      customerName: name,
      customerPhone: phone,
      pickupAddress: pickup.address,
      pickup: { lat: pickup.lat, lng: pickup.lng },
      destAddress: dest.address,
      dest: { lat: dest.lat, lng: dest.lng },
      passengers,
      vehicleClass,
      meetGreet,
      flightNumber: flightNumber || null,
      flightDirection: direction,
      terminal: flight?.terminal ?? null,
      flightStatus: flight?.status ?? null,
      flightScheduledAt: flightScheduledAt ? flightScheduledAt.toISOString() : null,
      flightDelayMinutes: delay,
      verificationToken,
    };
    // Abflug: gewünschte Abholzeit selbst wählen (= geplante Abfahrt vom Start).
    if (direction === "DEPARTURE" && flightScheduledAt) {
      // Vorschlag: 2,5 h vor Abflug am Start losfahren.
      body.scheduledAt = new Date(flightScheduledAt.getTime() - 150 * 60_000).toISOString();
    }
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const canSubmit = haveRoute && name.trim() && phone.trim() && verified && flightNumber.trim() && !submitting;

  return (
    <div className="grid gap-5" data-testid="airport-form">
      {/* Richtung */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="dir-arrival"
          onClick={() => setDirection("ARRIVAL")}
          className={`rounded-2xl border-2 p-3 text-left transition ${direction === "ARRIVAL" ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white"}`}
        >
          <p className="font-display font-extrabold text-ink-900">🛬 Ankunft</p>
          <p className="text-[11px] text-ink-500">Abholung am Flughafen</p>
        </button>
        <button
          type="button"
          data-testid="dir-departure"
          onClick={() => setDirection("DEPARTURE")}
          className={`rounded-2xl border-2 p-3 text-left transition ${direction === "DEPARTURE" ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white"}`}
        >
          <p className="font-display font-extrabold text-ink-900">🛫 Abflug</p>
          <p className="text-[11px] text-ink-500">Fahrt zum Flughafen</p>
        </button>
      </div>

      {/* Flugdaten */}
      <div className="rounded-2xl border-2 border-ink-200 bg-white p-4" data-testid="flight-card">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="label">Flugnummer *</label>
            <input
              className="field uppercase"
              data-testid="flight-number"
              placeholder="z. B. LH123"
              value={flightNumber}
              onChange={(e) => {
                setFlightNumber(e.target.value);
                setFlight(null);
              }}
            />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={checkFlight} disabled={flightBusy || !flightNumber.trim()} data-testid="flight-check" className="btn-dark disabled:opacity-60">
              {flightBusy ? "Prüfe …" : "Flug prüfen"}
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="label">{direction === "ARRIVAL" ? "Geplante Landung" : "Geplanter Abflug"} – Datum</label>
            <input className="field" type="date" data-testid="flight-date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Uhrzeit</label>
            <input className="field" type="time" data-testid="flight-time" value={flightTime} onChange={(e) => setFlightTime(e.target.value)} />
          </div>
        </div>
        {flightError && <p className="mt-2 text-xs font-bold text-red-600" data-testid="flight-error">{flightError}</p>}
        {flight && (
          <div className="mt-3 rounded-xl bg-ink-50 px-3 py-2.5 text-sm" data-testid="flight-info">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-ink-900">
                {flight.airline ? `${flight.airline} ` : ""}{flight.flightNumber}
              </p>
              {flight.status === "DELAYED" ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-extrabold text-red-700">Verspätet +{flight.delayMinutes} Min.</span>
              ) : flight.status === "CANCELLED" ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-extrabold text-red-700">Annulliert</span>
              ) : flight.status === "LANDED" ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-extrabold text-green-800">Gelandet</span>
              ) : flight.status === "ACTIVE" ? (
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-extrabold text-ink-900">In der Luft</span>
              ) : (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-extrabold text-green-800">Planmäßig</span>
              )}
            </div>
            <p className="mt-1 font-semibold text-ink-800">
              {direction === "ARRIVAL" ? "🛬 Ankunft: " : "🛫 Abflug: "}
              {flight.airportName ?? "Flughafen"}{flight.airportIata ? ` (${flight.airportIata})` : ""}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-600">
              {flight.scheduledAt && (
                <span>{direction === "ARRIVAL" ? "Geplante Landung" : "Geplanter Abflug"}: <span className="font-bold text-ink-900">{formatDateTime(flight.scheduledAt)}</span></span>
              )}
              {flight.terminal && <span>Terminal <span className="font-bold text-ink-900">{flight.terminal}</span></span>}
              {flight.gate && <span>Gate <span className="font-bold text-ink-900">{flight.gate}</span></span>}
            </div>
            {arrivalPickup && (
              <p className="mt-1 text-xs text-ink-600" data-testid="arrival-pickup">
                Voraussichtliche Abholung: <span className="font-bold">{formatDateTime(arrivalPickup.toISOString())}</span> (inkl. {BAGGAGE_BUFFER_MIN} Min. Gepäckpuffer)
              </p>
            )}
            {flight.source === "mock" && (
              <p className="mt-1 text-[11px] font-semibold text-amber-700" data-testid="flight-demo">⚠ Demo-Daten – Live-Fluganbieter nicht konfiguriert (AVIATIONSTACK_KEY).</p>
            )}
          </div>
        )}
      </div>

      {/* Adressen */}
      <div>
        <label className="label">{direction === "ARRIVAL" ? "Flughafen (Abholung) *" : "Flughafen (Ziel) *"}</label>
        <AddressInput
          label="Flughafen"
          hideLabel
          placeholder="z. B. Flughafen Hannover (HAJ)"
          value={airport.address}
          onChange={(t) => setAirport({ address: t })}
          onSelect={(r: GeocodeResult) => setAirport({ address: r.label, lat: r.lat, lng: r.lng })}
          required
        />
      </div>
      <div>
        <label className="label">{direction === "ARRIVAL" ? "Zieladresse *" : "Abholadresse *"}</label>
        <AddressInput
          label="Adresse"
          hideLabel
          placeholder={direction === "ARRIVAL" ? "Wohin geht die Fahrt?" : "Wo sollen wir Sie abholen?"}
          value={other.address}
          onChange={(t) => setOther({ address: t })}
          onSelect={(r: GeocodeResult) => setOther({ address: r.label, lat: r.lat, lng: r.lng })}
          required
        />
      </div>

      {haveRoute && (
        <div className="overflow-hidden rounded-2xl ring-1 ring-ink-200 shadow-card">
          <div className="h-44">
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
        <div className="rounded-2xl border-2 border-brand-500 bg-brand-50 p-4" data-testid="airport-quote">
          <p className="eyebrow text-ink-700">Voraussichtlicher Fahrpreis</p>
          <p className="font-display text-2xl font-extrabold text-ink-900">ca. {formatEuro(quote.priceApprox ?? quote.priceMid)}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Personen</label>
          <input className="field" type="number" min={1} max={8} value={passengers} onChange={(e) => setPassengers(Math.max(1, Number(e.target.value)))} />
        </div>
      </div>

      <div>
        <label className="label">Gepäck (für passende Fahrzeugwahl)</label>
        <LuggageMatrix passengers={passengers} onRecommend={setVehicleClass} />
        <p className="mt-1 text-xs text-ink-500" data-testid="airport-vclass">Fahrzeug: {vehicleClassInfo(vehicleClass).icon} {vehicleClassInfo(vehicleClass).label}</p>
      </div>

      <div>
        <label className="label">Meet &amp; Greet</label>
        <div className="grid gap-2" data-testid="meet-greet">
          {MEET_GREET_LEVELS.map((lv) => {
            const fee = meetGreetFee(lv.key, pickup.address, dest.address);
            const active = meetGreet === lv.key;
            return (
              <button
                type="button"
                key={lv.key}
                onClick={() => setMeetGreet(lv.key)}
                data-testid={`mg-${lv.key}`}
                className={`flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition ${active ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white hover:border-ink-300"}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink-900">{lv.label}</span>
                  <span className="block text-xs text-ink-500">{lv.desc}</span>
                </span>
                <span className="shrink-0 text-sm font-extrabold text-ink-900">{fee > 0 ? `+ ${formatEuro(fee)}` : "inkl."}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Wartezeit: erste {FREE_WAIT_MIN} Min nach Ankunft frei, danach {formatEuro(WAIT_PER_MIN)}/Min. Flugverspätungen werden fair berücksichtigt.
        </p>
      </div>

      {direction === "ARRIVAL" && pickup.address && resolveAirportPickup(pickup.address, flight?.terminal) && (
        <PickupZoneCard pickup={resolveAirportPickup(pickup.address, flight?.terminal)!} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Name *</label>
          <input className="field" data-testid="airport-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Telefonnummer *</label>
          <input
            className="field"
            data-testid="airport-phone"
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

      {accountVerified ? (
        <p className="rounded-2xl border-2 border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800" data-testid="airport-verify-account">
          ✓ Angemeldet als {account?.name} – Nummer bereits bestätigt.
        </p>
      ) : (
        <div className="rounded-2xl border-2 border-ink-200 bg-white p-4" data-testid="airport-verify">
          {verifyState !== "verified" ? (
            <div className="grid gap-2">
              <p className="text-sm text-ink-600">SMS-Code an <span className="font-bold">{phone || "Ihre Nummer"}</span> senden.</p>
              {verifyState === "idle" ? (
                <button type="button" onClick={requestCode} disabled={verifyBusy || !phone.trim()} data-testid="airport-verify-send" className="btn-dark justify-self-start disabled:opacity-60">
                  {verifyBusy ? "Sende …" : "SMS-Code senden"}
                </button>
              ) : (
                <>
                  {devCodeHint && <p data-testid="airport-verify-devcode" className="rounded bg-brand-50 px-2 py-1 text-xs font-semibold">Testmodus – Code: <span className="font-mono font-bold">{devCodeHint}</span></p>}
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input className="field text-center font-mono" inputMode="numeric" maxLength={6} placeholder="Code" data-testid="airport-verify-code" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))} />
                    <button type="button" onClick={confirmCode} disabled={verifyBusy || verifyCode.length < 4} data-testid="airport-verify-confirm" className="btn-primary disabled:opacity-60">Bestätigen</button>
                  </div>
                </>
              )}
              {verifyError && <p className="text-xs font-bold text-red-600" data-testid="airport-verify-error">{verifyError}</p>}
            </div>
          ) : (
            <p className="text-sm font-bold text-green-700">✓ Nummer bestätigt</p>
          )}
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" data-testid="airport-error">{error}</p>}

      <button onClick={submit} disabled={!canSubmit} data-testid="airport-submit" className="btn-primary text-lg disabled:opacity-60">
        {submitting ? "Wird gebucht …" : direction === "ARRIVAL" ? "Abholung am Flughafen buchen" : "Fahrt zum Flughafen buchen"}
      </button>
      {!flightNumber.trim() && <p className="text-center text-xs text-ink-400">Bitte Flugnummer angeben.</p>}
      {flightNumber.trim() && !haveRoute && <p className="text-center text-xs text-ink-400">Bitte Flughafen und Adresse eingeben.</p>}
    </div>
  );
}
