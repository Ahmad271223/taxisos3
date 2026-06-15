"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AddressInput } from "@/components/AddressInput";
import { MapPickerModal } from "@/components/MapPickerModal";
import { StripePayment } from "@/components/StripePayment";
import { formatDistance, formatDuration, formatEuro } from "@/lib/format";
import type { GeocodeResult, PriceEstimateT } from "@/lib/geo";
import type { MapMarker } from "@/components/Map";
import { vehicleClass as vehicleClassInfo, normalizeClass } from "@/lib/vehicleClasses";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

interface AddrState {
  address: string;
  lat?: number;
  lng?: number;
}

type Step = "details" | "confirm";

export function BookingForm({ scheduled = false, companySlug, initialVehicleClass, initialDriverId, initialDestination }: { scheduled?: boolean; companySlug?: string; initialVehicleClass?: string; initialDriverId?: string; initialDestination?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [pickup, setPickup] = useState<AddrState>({ address: "" });
  const [dest, setDest] = useState<AddrState>({ address: initialDestination ?? "" });
  // Mehrziel-Vorabplanung (Phase 2e): Zwischenstopps zwischen Abholung und Ziel.
  const [stops, setStops] = useState<AddrState[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [luggage, setLuggage] = useState(false);
  const [childSeat, setChildSeat] = useState(false);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [payment, setPayment] = useState<"CASH" | "CARD">("CASH");
  // Fahrzeugklasse (Phase 12 Marktplatz) – Kunde wählt vor der Buchung.
  // Vorauswahl z. B. aus der Live-Karte (?class=VAN).
  const [vehicleClass, setVehicleClass] = useState(() => normalizeClass(initialVehicleClass));
  // Karten-Pin-Auswahl (Phase 24): für Abholung/Ziel.
  const [mapPickFor, setMapPickFor] = useState<null | "pickup" | "dest">(null);
  // Telefon-Verifizierung (Phase 3h)
  const [verifyState, setVerifyState] = useState<"idle" | "sent" | "verified">("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);
  // Eingeloggter Kunde (Phase 11): Name/Telefon vorausfüllen, bestätigte Nummer
  // braucht keine erneute SMS-Verifizierung.
  const [account, setAccount] = useState<{ name: string; phone: string } | null>(null);

  const [quote, setQuote] = useState<(PriceEstimateT & { priceApprox?: number; classes?: any[] }) | null>(null);
  const [routeLine, setRouteLine] = useState<[number, number][] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eingeloggten Kunden laden und Felder vorausfüllen (nur wenn noch leer).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const c = d.customer;
        if (c && c.role === "CUSTOMER") {
          setAccount({ name: c.name ?? "", phone: c.phone ?? "" });
          setName((n) => (n.trim() ? n : c.name ?? ""));
          setPhone((p) => (p.trim() ? p : c.phone ?? ""));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Kontonummer gilt als bestätigt -> keine erneute SMS-Verifizierung nötig.
  const onlyDigits = (s: string) => s.replace(/[^0-9]/g, "");
  const accountVerified =
    !!account && phone.trim() !== "" && onlyDigits(phone) === onlyDigits(account.phone);
  const verified = !!verificationToken || accountVerified;

  const haveRoute = pickup.lat != null && dest.lat != null;
  // Nur Zwischenstopps mit aufgeloesten Koordinaten fliessen in Route/Preis ein.
  const resolvedStops = stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ address: s.address, lat: s.lat as number, lng: s.lng as number }));
  const stopsKey = resolvedStops.map((s) => `${s.lat},${s.lng}`).join("|");

  // Fahrzeugklassen-Vergleich (Phase 12): Preise/Verfügbarkeit aus dem Quote.
  const quoteClasses: any[] = quote?.classes ?? [];
  const selectedClassQuote = quoteClasses.find((c) => c.key === vehicleClass);
  const displayApprox = selectedClassQuote?.price ?? quote?.priceApprox ?? quote?.priceMid ?? null;

  // Preis live berechnen, sobald Abholung und Ziel (und ggf. Stopps) stehen.
  useEffect(() => {
    if (!haveRoute) {
      setQuote(null);
      setRouteLine(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { lat: pickup.lat, lng: pickup.lng },
        to: { lat: dest.lat, lng: dest.lng },
        stops: resolvedStops,
        company: companySlug,
        passengers,
        luggage: luggage ? 2 : 0,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setQuote(d);
          setRouteLine(d.geometry ?? null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, dest.lat, dest.lng, stopsKey, passengers, luggage]);

  function selectPickup(r: GeocodeResult) {
    setPickup({ address: r.label, lat: r.lat, lng: r.lng });
  }
  function selectDest(r: GeocodeResult) {
    setDest({ address: r.label, lat: r.lat, lng: r.lng });
  }

  // -- Zwischenstopp-Verwaltung (Mehrziel) --------------------------------
  function addStop() {
    setStops((s) => [...s, { address: "" }]);
  }
  function removeStop(i: number) {
    setStops((s) => s.filter((_, idx) => idx !== i));
  }
  function updateStopText(i: number, text: string) {
    setStops((s) => s.map((st, idx) => (idx === i ? { ...st, address: text, lat: undefined, lng: undefined } : st)));
  }
  function selectStop(i: number, r: GeocodeResult) {
    setStops((s) => s.map((st, idx) => (idx === i ? { address: r.label, lat: r.lat, lng: r.lng } : st)));
  }

  // Gemeinsame Karten-Marker (Abholung, Stopps, Ziel) fuer beide Schritte.
  function buildMarkers(): MapMarker[] {
    const m: MapMarker[] = [];
    if (pickup.lat != null) m.push({ id: "p", lat: pickup.lat, lng: pickup.lng as number, kind: "pickup", popup: "Abholung" });
    stops.forEach((s, i) => {
      if (s.lat != null) m.push({ id: `s${i}`, lat: s.lat, lng: s.lng as number, kind: "stop", label: String(i + 1), popup: `Stopp ${i + 1}` });
    });
    if (dest.lat != null) m.push({ id: "d", lat: dest.lat, lng: dest.lng as number, kind: "dest", popup: "Ziel" });
    return m;
  }

  /** Aktuellen GPS-Standort als Abholort übernehmen. */
  async function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Standortdienste werden vom Browser nicht unterstützt.");
      return;
    }
    setGpsError(null);
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Reverse-Geocoding für eine lesbare Adresse.
        let label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        try {
          const r = await fetch(`/api/geocode?reverse=1&lat=${lat}&lng=${lng}`);
          if (r.ok) {
            const d = await r.json();
            const hit = d.results?.[0];
            if (hit?.label) label = hit.label;
          }
        } catch {
          /* fall back to coords */
        }
        setPickup({ address: label, lat, lng });
        setGpsLoading(false);
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(
          err.code === 1
            ? "Standort wurde blockiert. Bitte in den Browser-Einstellungen erlauben."
            : "Standort konnte nicht ermittelt werden.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  async function resolveAddr(addr: AddrState): Promise<AddrState> {
    if (addr.lat != null) return addr;
    if (!addr.address.trim()) return addr;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(addr.address)}`);
      const d = await res.json();
      const hit = d.results?.[0];
      if (hit) return { address: hit.label, lat: hit.lat, lng: hit.lng };
    } catch {
      /* ignore */
    }
    return addr;
  }

  // Schritt 1 → Schritt 2 (Bestätigung), KEINE Buchung
  async function proceedToConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError("Bitte Name und Telefonnummer angeben.");
      return;
    }
    if (scheduled) {
      if (!date || !time) {
        setError("Bitte Datum und Uhrzeit für die Vorbestellung wählen.");
        return;
      }
      const dt = new Date(`${date}T${time}`);
      if (isNaN(dt.getTime()) || dt.getTime() < Date.now() + 60_000) {
        setError("Bitte einen Zeitpunkt in der Zukunft wählen.");
        return;
      }
    }

    // Adressen automatisch erkennen.
    const p = await resolveAddr(pickup);
    const q = await resolveAddr(dest);
    // Nur ausgefuellte Zwischenstopps aufloesen; leere Felder verwerfen.
    const filledStops = stops.filter((s) => s.address.trim());
    const resolved = await Promise.all(filledStops.map(resolveAddr));
    setPickup(p);
    setDest(q);
    setStops(resolved);
    if (p.lat == null || q.lat == null) {
      setError("Adresse konnte nicht gefunden werden. Bitte genauer eingeben (Straße, Hausnummer, Ort).");
      return;
    }
    if (resolved.some((s) => s.lat == null)) {
      setError("Ein Zwischenstopp konnte nicht gefunden werden. Bitte genauer eingeben.");
      return;
    }
    setStep("confirm");
  }

  // -- Telefon-Verifizierung (Phase 3h) -----------------------------------
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
      if (!res.ok) {
        setVerifyError(d.error ?? "Code konnte nicht gesendet werden.");
      } else {
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
      if (!res.ok || !d.token) {
        setVerifyError(d.error ?? "Code falsch.");
      } else {
        setVerificationToken(d.token);
        setVerifyState("verified");
      }
    } catch {
      setVerifyError("Netzwerkfehler.");
    } finally {
      setVerifyBusy(false);
    }
  }

  // Echte Stripe-Kartenzahlung nur, wenn ein Publishable Key vorhanden ist;
  // sonst läuft CARD über den Mock-Pfad (Server autorisiert).
  const stripePubKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const useStripeCard = payment === "CARD" && !!stripePubKey;

  // Schritt 2: tatsächliche Buchung absenden → Fahrer wird jetzt gesucht.
  // paymentIntentId: bei echter Stripe-Kartenzahlung der vom Client autorisierte Intent.
  async function confirmBooking(paymentIntentId?: string) {
    setError(null);
    setSubmitting(true);

    let scheduledAt: string | null = null;
    if (scheduled) {
      scheduledAt = new Date(`${date}T${time}`).toISOString();
    }

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: companySlug ?? null,
          customerName: name,
          customerPhone: phone,
          pickupAddress: pickup.address,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          destAddress: dest.address,
          dest: { lat: dest.lat, lng: dest.lng },
          stops: resolvedStops,
          passengers,
          luggage,
          childSeat,
          vehicleClass,
          requestedDriverId: initialDriverId ?? null,
          notes: notes || null,
          scheduledAt,
          paymentMethod: payment,
          verificationToken,
          paymentIntentId: paymentIntentId ?? null,
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

  // -------------- SCHRITT 2: Bestätigung --------------
  if (step === "confirm") {
    return (
      <div className="grid gap-5" data-testid="booking-confirm">
        <div className="flex items-center gap-2 text-xs font-bold text-ink-500">
          <span className="chip bg-brand-500 text-ink-900">Schritt 2/2</span>
          Fahrt bestätigen
        </div>

        {/* Routen-Karte */}
        {haveRoute && (
          <div className="overflow-hidden rounded-2xl ring-1 ring-ink-200 shadow-card">
            <div className="h-56 sm:h-64">
              <Map
                center={[((pickup.lat as number) + (dest.lat as number)) / 2, ((pickup.lng as number) + (dest.lng as number)) / 2]}
                markers={buildMarkers()}
                line={routeLine ?? undefined}
                fit
              />
            </div>
          </div>
        )}

        {/* Zusammenfassung */}
        <div className="card p-5">
          <Row label="Abholung" value={pickup.address} />
          {resolvedStops.map((s, i) => (
            <Row key={i} label={`Zwischenstopp ${i + 1}`} value={s.address} />
          ))}
          <Row label="Ziel" value={dest.address} />
          {scheduled && <Row label="Termin" value={`${date} ${time}`} />}
          <Row label="Fahrzeug" value={`${vehicleClassInfo(vehicleClass).icon} ${vehicleClassInfo(vehicleClass).label}`} />
          <Row label="Personen" value={String(passengers)} />
          {(luggage || childSeat) && (
            <Row label="Optionen" value={[luggage && "Gepäck", childSeat && "Kindersitz"].filter(Boolean).join(", ")} />
          )}
          {notes && <Row label="Bemerkung" value={notes} />}
          <Row label="Kontakt" value={`${name} · ${phone}`} />
        </div>

        {/* Preis */}
        {quote && (
          <div className="rounded-3xl border-2 border-brand-500 bg-brand-50 p-5" data-testid="quote-card">
            <p className="eyebrow text-ink-700">Voraussichtlicher Fahrpreis</p>
            <p className="mt-1 font-display text-4xl font-extrabold text-ink-900" data-testid="quote-price">
              ca. {formatEuro(displayApprox ?? quote.priceMid)}
            </p>
            <p className="mt-2 text-sm text-ink-700">
              {formatDistance(quote.distanceMeters)} · {formatDuration(quote.durationSeconds)} · Schätzung anhand des Tagesdurchschnitts
            </p>
            <p className="mt-1 text-xs text-ink-500">Der genaue Festpreis steht fest, sobald ein Fahrer zugewiesen ist.</p>
          </div>
        )}

        {/* Zahlungsart */}
        <div>
          <p className="eyebrow mb-2">Zahlungsart</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <PaymentTile selected={payment === "CASH"} onClick={() => setPayment("CASH")} testid="pay-cash" title="Barzahlung" desc="Beim Fahrer bezahlen" icon="cash" />
            <PaymentTile selected={payment === "CARD"} onClick={() => setPayment("CARD")} testid="pay-card" title="Karte (Online)" desc="Nach der Fahrt per Link" icon="card" />
          </div>
        </div>

        {/* Telefon-Verifizierung (Phase 3h) – entfällt für bestätigte Kontonummer */}
        {accountVerified ? (
          <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-5 text-sm font-bold text-green-800" data-testid="verify-account">
            ✓ Angemeldet als {account?.name} – Ihre Nummer ist bereits bestätigt.
          </div>
        ) : (
        <div className="rounded-2xl border-2 border-ink-200 bg-white p-5" data-testid="verify-card">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-ink-700">Telefon bestätigen</p>
            {verifyState === "verified" && (
              <span data-testid="verify-ok" className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-extrabold text-green-800">
                ✓ Bestätigt
              </span>
            )}
          </div>
          {verifyState !== "verified" ? (
            <div className="mt-3 grid gap-3">
              <p className="text-sm text-ink-600">
                Wir senden einen SMS-Code an <span className="font-bold text-ink-900">{phone || "Ihre Nummer"}</span>, um Ihre Buchung zu bestätigen.
              </p>
              {verifyState === "idle" ? (
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={verifyBusy || !phone.trim()}
                  data-testid="verify-send"
                  className="btn-dark disabled:opacity-60"
                >
                  {verifyBusy ? "Sende …" : "SMS-Code senden"}
                </button>
              ) : (
                <div className="grid gap-2">
                  {devCodeHint && (
                    <p data-testid="verify-devcode" className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-ink-700">
                      Testmodus – Code: <span className="font-mono font-extrabold">{devCodeHint}</span>
                    </p>
                  )}
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      data-testid="verify-code"
                      className="field text-center font-mono tracking-[0.3em]"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-stelliger Code"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                    <button
                      type="button"
                      onClick={confirmCode}
                      disabled={verifyBusy || verifyCode.length < 4}
                      data-testid="verify-confirm"
                      className="btn-primary disabled:opacity-60"
                    >
                      Bestätigen
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={requestCode}
                    disabled={verifyBusy}
                    className="justify-self-start text-xs font-bold text-ink-500 hover:text-ink-900"
                  >
                    Code erneut senden
                  </button>
                </div>
              )}
              {verifyError && <p data-testid="verify-error" className="text-xs font-bold text-red-600">{verifyError}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-600">Ihre Nummer ist bestätigt. Sie können jetzt buchen.</p>
          )}
        </div>
        )}

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

        {useStripeCard ? (
          <div className="grid gap-3">
            {!verified && (
              <p className="text-center text-xs font-semibold text-ink-500">Bitte bestätigen Sie zuerst Ihre Telefonnummer.</p>
            )}
            {verified && haveRoute && (
              <StripePayment
                params={{
                  pickup: { lat: pickup.lat as number, lng: pickup.lng as number },
                  dest: { lat: dest.lat as number, lng: dest.lng as number },
                  stops: resolvedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
                  company: companySlug,
                }}
                disabled={submitting || !verified}
                submitting={submitting}
                onAuthorized={(piId) => confirmBooking(piId)}
              />
            )}
            <button onClick={() => setStep("details")} data-testid="back-to-details" className="btn-ghost">← Zurück</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <button onClick={() => setStep("details")} data-testid="back-to-details" className="btn-ghost">← Zurück</button>
              <button onClick={() => confirmBooking()} disabled={submitting || !verified} data-testid="confirm-booking" className="btn-primary text-lg disabled:opacity-60">
                {submitting ? "Wird gesendet …" : scheduled ? "Jetzt vorbestellen" : "Taxi bestellen"}
              </button>
            </div>
            <p className="text-center text-xs text-ink-400">
              {verified
                ? "Erst jetzt wird ein Fahrer gesucht und Ihre Daten weitergegeben."
                : "Bitte bestätigen Sie zuerst Ihre Telefonnummer."}
            </p>
          </>
        )}
      </div>
    );
  }

  // -------------- SCHRITT 1: Adressen & Daten --------------
  return (
    <form onSubmit={proceedToConfirm} className="grid gap-5" data-testid="booking-step1">
      <div className="flex items-center gap-2 text-xs font-bold text-ink-500">
        <span className="chip bg-ink-900 text-brand-500">Schritt 1/2</span>
        Fahrt eingeben
      </div>

      {initialDriverId && (
        <div className="rounded-2xl border-2 border-brand-500 bg-brand-50 p-3 text-sm font-semibold text-ink-900" data-testid="targeted-driver-banner">
          🚕 Gezielte Bestellung: Dieses Taxi wird zuerst angefragt. Sagt es nicht zu, suchen wir automatisch das nächste freie {vehicleClassInfo(vehicleClass).label}.
        </div>
      )}

      <MapPickerModal
        open={mapPickFor !== null}
        title={mapPickFor === "pickup" ? "Abholort auf der Karte wählen" : "Zielort auf der Karte wählen"}
        initial={
          mapPickFor === "pickup"
            ? pickup.lat != null
              ? { address: pickup.address, lat: pickup.lat, lng: pickup.lng }
              : null
            : dest.lat != null
            ? { address: dest.address, lat: dest.lat, lng: dest.lng }
            : null
        }
        onClose={() => setMapPickFor(null)}
        onConfirm={(p) => {
          if (mapPickFor === "pickup") setPickup({ address: p.address, lat: p.lat, lng: p.lng });
          else setDest({ address: p.address, lat: p.lat, lng: p.lng });
          setMapPickFor(null);
        }}
      />

      <div className="grid gap-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label !mb-0">Abholadresse *</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMapPickFor("pickup")}
                data-testid="pick-pickup-map"
                className="flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-[11px] font-bold text-ink-700 hover:border-brand-500 hover:text-ink-900"
              >
                📍 Karte
              </button>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={gpsLoading}
                data-testid="use-my-location"
                className="flex items-center gap-1.5 rounded-full bg-brand-500 px-3 py-1 text-[11px] font-bold text-ink-900 hover:bg-brand-400 disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2.4" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
                {gpsLoading ? "Suche …" : "Standort"}
              </button>
            </div>
          </div>
          <AddressInput
            placeholder="Straße, Hausnummer, Ort"
            value={pickup.address}
            onChange={(t) => setPickup((p) => ({ ...p, address: t, lat: undefined, lng: undefined }))}
            onSelect={selectPickup}
            label="Abholadresse"
            hideLabel
            required
          />
          {gpsError && <p className="mt-1 text-xs font-semibold text-red-600" data-testid="gps-error">{gpsError}</p>}
        </div>

        {/* Zwischenstopps (Mehrziel, Phase 2e) */}
        {stops.map((s, i) => (
          <div key={i} data-testid={`stop-row-${i}`}>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="label !mb-0">Zwischenstopp {i + 1}</label>
              <button
                type="button"
                onClick={() => removeStop(i)}
                data-testid={`remove-stop-${i}`}
                className="text-[11px] font-bold text-red-600 hover:text-red-700"
              >
                Entfernen
              </button>
            </div>
            <AddressInput
              label={`Zwischenstopp ${i + 1}`}
              placeholder="Adresse des Zwischenstopps"
              value={s.address}
              onChange={(t) => updateStopText(i, t)}
              onSelect={(r) => selectStop(i, r)}
              hideLabel
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addStop}
          data-testid="add-stop"
          className="flex items-center gap-1.5 justify-self-start rounded-full border border-ink-200 px-3 py-1.5 text-xs font-bold text-ink-700 transition hover:border-brand-500 hover:text-ink-900"
        >
          <span className="text-base leading-none">＋</span> Zwischenstopp hinzufügen
        </button>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label !mb-0">Zieladresse *</label>
            <button
              type="button"
              onClick={() => setMapPickFor("dest")}
              data-testid="pick-dest-map"
              className="flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-[11px] font-bold text-ink-700 hover:border-brand-500 hover:text-ink-900"
            >
              📍 Ziel auf Karte wählen
            </button>
          </div>
          <AddressInput
            label="Zieladresse"
            placeholder="Wohin geht die Fahrt?"
            value={dest.address}
            onChange={(t) => setDest((p) => ({ ...p, address: t, lat: undefined, lng: undefined }))}
            onSelect={selectDest}
            hideLabel
            required
          />
        </div>
        <p className="text-xs text-ink-500">
          Tipp: Adresse eintippen oder GPS-Knopf nutzen – der Preis erscheint automatisch unten. Mit Zwischenstopps planen Sie Mehrziel-Fahrten zum Gesamtpreis.
        </p>
      </div>

      {/* Karte */}
      {haveRoute && (
        <div className="overflow-hidden rounded-2xl ring-1 ring-ink-200 shadow-card">
          <div className="h-56 sm:h-64">
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

      {/* Preisvorschau */}
      <div className="rounded-3xl border-2 border-brand-500 bg-brand-50 p-5" data-testid="quote-card">
        {quoting ? (
          <p className="text-sm font-semibold text-ink-600">Preis wird berechnet …</p>
        ) : quote ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow text-ink-700">Voraussichtlicher Fahrpreis</p>
              <p data-testid="quote-price" className="mt-1 font-display text-3xl font-extrabold text-ink-900">
                ca. {formatEuro(displayApprox ?? quote.priceMid)}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">{vehicleClassInfo(vehicleClass).label} · Festpreis nach Fahrer-Zuweisung</p>
            </div>
            <div className="text-right text-sm text-ink-700">
              <p>📍 {formatDistance(quote.distanceMeters)}</p>
              <p>⏱ ca. {formatDuration(quote.durationSeconds)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm font-semibold text-ink-600">
            Wählen Sie Abhol- und Zieladresse für eine automatische Preisvorschau.
          </p>
        )}
      </div>

      {/* Fahrzeugauswahl & Live-Vergleich (Phase 12 Marktplatz) */}
      {quote && quoteClasses.length > 0 && (
        <VehicleClassPicker
          classes={quoteClasses}
          value={vehicleClass}
          onChange={setVehicleClass}
          passengers={passengers}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Name *</label>
          <input data-testid="booking-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Telefonnummer *</label>
          <input
            data-testid="booking-phone"
            className="field"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              // Bei Nummernänderung Verifizierung zurücksetzen.
              setVerificationToken(null);
              setVerifyState("idle");
              setVerifyCode("");
              setDevCodeHint(null);
            }}
            required
          />
        </div>
      </div>

      {scheduled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Datum *</label>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Uhrzeit *</label>
            <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
      )}

      <details className="rounded-2xl border border-ink-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-ink-700">Weitere Optionen</summary>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Personenanzahl</label>
              <input
                className="field"
                type="number"
                min={1}
                max={8}
                value={passengers}
                onChange={(e) => setPassengers(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={luggage} onChange={(e) => setLuggage(e.target.checked)} />
                Gepäck
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={childSeat} onChange={(e) => setChildSeat(e.target.checked)} />
                Kindersitz
              </label>
            </div>
          </div>
          <div>
            <label className="label">Bemerkungen</label>
            <textarea
              className="field"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z. B. Treffpunkt am Seiteneingang"
            />
          </div>
        </div>
      </details>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <button
        type="submit"
        data-testid="booking-continue"
        className="btn-primary text-lg"
        disabled={!haveRoute}
      >
        Weiter zur Bestätigung
      </button>
      {!haveRoute && (
        <p className="text-center text-xs text-ink-400">Geben Sie zuerst beide Adressen ein.</p>
      )}
    </form>
  );
}

// Fahrzeug-Marktplatz (Phase 12): Auswahlraster mit Live-Preis je Klasse,
// Kapazität und „passt"-Hinweis (Gepäckrechner).
function VehicleClassPicker({
  classes,
  value,
  onChange,
  passengers,
}: {
  classes: any[];
  value: string;
  onChange: (key: string) => void;
  passengers: number;
}) {
  const anyFits = classes.some((c) => c.fits);
  return (
    <div data-testid="vehicle-classes">
      <p className="eyebrow mb-2">Fahrzeug wählen</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {classes.map((c) => {
          const selected = c.key === value;
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`vclass-${c.key}`}
              onClick={() => onChange(c.key)}
              className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${
                selected ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              <span className="text-2xl leading-none">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-display font-extrabold text-ink-900">{c.short ?? c.label}</span>
                  {!c.fits && (
                    <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-500">zu klein</span>
                  )}
                </span>
                <span className="block text-[11px] text-ink-500">
                  {c.seats} Pers. · {c.luggage} Gepäck{c.available > 0 ? ` · ${c.available} frei` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display font-extrabold text-ink-900" data-testid={`vclass-${c.key}-price`}>
                  ca. {formatEuro(c.price)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {!anyFits && passengers > 4 && (
        <p className="mt-2 text-xs font-semibold text-amber-700" data-testid="vclass-hint">
          Für {passengers} Personen empfehlen wir ein Großraum-/Shuttle-Fahrzeug oder mehrere Taxis.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-ink-100 py-2 text-sm last:border-0">
      <span className="text-ink-500">{label}</span>
      <span className="text-right font-bold text-ink-900">{value}</span>
    </div>
  );
}

function PaymentTile({
  selected,
  onClick,
  title,
  desc,
  icon,
  testid,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  icon: "cash" | "card";
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition ${
        selected ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white hover:border-ink-300"
      }`}
    >
      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${selected ? "bg-brand-500 text-ink-900" : "bg-ink-100 text-ink-700"}`}>
        {icon === "cash" ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
            <rect x="2.5" y="6.5" width="19" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
            <rect x="2.5" y="5.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M2.5 10h19" stroke="currentColor" strokeWidth="2" />
            <path d="M6 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="flex-1">
        <p className="font-display font-extrabold text-ink-900">{title}</p>
        <p className="text-xs text-ink-500">{desc}</p>
      </span>
      <span className={`h-5 w-5 rounded-full border-2 ${selected ? "border-brand-500 bg-brand-500" : "border-ink-300 bg-white"}`} />
    </button>
  );
}
