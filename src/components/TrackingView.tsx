"use client";

import { useEffect, useMemo, useState } from "react";
import { SignaturePad } from "@/components/SignaturePad";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getSocket } from "@/lib/socket";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import { ChatPanel } from "@/components/ChatPanel";
import { TRACKING_STEPS, TRACKING_LABEL } from "@/lib/status";
import { formatDuration, formatEuro, formatDateTime } from "@/lib/format";
import type { MapMarker } from "@/components/Map";
import type { GeocodeResult } from "@/lib/geo";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export function TrackingView({ id }: { id: string }) {
  const [booking, setBooking] = useState<any | null>(null);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [routeLine, setRouteLine] = useState<[number, number][] | null>(null);
  const [stars, setStars] = useState(0);
  const [ratedDone, setRatedDone] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Zieländerung während der Fahrt (Phase 2f)
  const [editOpen, setEditOpen] = useState(false);
  const [changeMode, setChangeMode] = useState<"dest" | "stop">("dest");
  const [newAddr, setNewAddr] = useState<{ address: string; lat?: number; lng?: number }>({ address: "" });
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [sosState, setSosState] = useState<"idle" | "sending" | "sent">("idle");
  const [sosRescue, setSosRescue] = useState<any | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigBusy, setSigBusy] = useState(false);

  // Fahrtnachweis: Unterschrift + GPS speichern.
  async function submitSignature(dataUrl: string, name: string) {
    setSigBusy(true);
    const send = (lat?: number, lng?: number) =>
      fetch(`/api/bookings/${id}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataBase64: dataUrl, signedName: name || null, lat: lat ?? null, lng: lng ?? null }),
      })
        .then(() => {
          setSigOpen(false);
          setBooking((b: any) => (b ? { ...b, hasSignature: true, signatureAt: new Date().toISOString() } : b));
        })
        .catch(() => {})
        .finally(() => setSigBusy(false));
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude), () => send(), { timeout: 6000 });
    } else {
      send();
    }
  }

  // SOS-/Notfallmeldung (Phase 17/21): Standort sichern, Meldung absetzen und
  // automatisch den nächsten freien Fahrer zum Standort schicken.
  async function triggerSos() {
    if (sosState === "sending") return;
    if (!window.confirm("Notruf senden? Ihr Standort wird gespeichert und sofort der nächste Fahrer zu Ihnen geschickt.")) return;
    setSosState("sending");
    const send = (lat?: number, lng?: number) =>
      fetch("/api/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: id, lat, lng }),
      })
        .then((r) => r.json())
        .then((d) => {
          setSosState("sent");
          if (d?.rescueDriver) setSosRescue(d.rescueDriver);
        })
        .catch(() => setSosState("idle"));
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos.coords.latitude, pos.coords.longitude),
        () => send(),
        { timeout: 5000 },
      );
    } else {
      send();
    }
  }

  async function submitRating(n: number) {
    setStars(n);
    try {
      await fetch(`/api/bookings/${id}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: n }),
      });
    } catch {
      /* ignore */
    }
    setRatedDone(true);
  }

  async function cancelBooking() {
    if (!confirm("Möchten Sie die Fahrt wirklich stornieren?")) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/bookings/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Kunde hat storniert." }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCancelError(d.error ?? "Stornierung fehlgeschlagen.");
      }
    } catch {
      setCancelError("Netzwerkfehler.");
    } finally {
      setCancelling(false);
    }
  }

  async function submitDestChange() {
    if (newAddr.lat == null || newAddr.lng == null) {
      setChangeError("Bitte eine Adresse aus der Vorschlagsliste wählen.");
      return;
    }
    setChanging(true);
    setChangeError(null);
    const place = { address: newAddr.address, lat: newAddr.lat, lng: newAddr.lng };
    try {
      const res = await fetch(`/api/bookings/${id}/destination`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changeMode === "dest" ? { dest: place } : { addStop: place }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setChangeError(d.error ?? "Änderung fehlgeschlagen.");
      } else {
        // Aktualisierte Buchung kommt zusaetzlich per Socket (booking:update).
        const d = await res.json().catch(() => null);
        if (d?.booking) setBooking(d.booking);
        setEditOpen(false);
        setNewAddr({ address: "" });
      }
    } catch {
      setChangeError("Netzwerkfehler.");
    } finally {
      setChanging(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    fetch(`/api/bookings/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => mounted && setBooking(d.booking))
      .catch(() => mounted && setNotFound(true));

    const socket = getSocket();
    socket.emit("track:join", { bookingId: id });
    const onUpdate = (b: any) => {
      if (b?.id === id) {
        setBooking(b);
        if (b.driver?.lat != null && b.driver?.lng != null) {
          setDriverLoc({ lat: b.driver.lat, lng: b.driver.lng });
        }
      }
    };
    const onDriverLoc = (p: { bookingId: string; lat: number; lng: number }) => {
      if (p.bookingId === id) setDriverLoc({ lat: p.lat, lng: p.lng });
    };
    socket.on("booking:update", onUpdate);
    socket.on("booking:driverLocation", onDriverLoc);
    socket.on("connect", () => socket.emit("track:join", { bookingId: id }));

    return () => {
      mounted = false;
      socket.off("booking:update", onUpdate);
      socket.off("booking:driverLocation", onDriverLoc);
    };
  }, [id]);

  // Fallback-Polling: falls ein Socket-Event verpasst wird (Reconnect/Timing),
  // den Status regelmäßig nachladen – bis die Fahrt beendet/storniert ist.
  useEffect(() => {
    if (notFound) return;
    const st = booking?.trackingStatus;
    if (st === "BEENDET" || st === "STORNIERT") return;
    const iv = setInterval(() => {
      fetch(`/api/bookings/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.booking) return;
          setBooking(d.booking);
          if (d.booking.driver?.lat != null && d.booking.driver?.lng != null) {
            setDriverLoc({ lat: d.booking.driver.lat, lng: d.booking.driver.lng });
          }
        })
        .catch(() => {});
    }, 6000);
    return () => clearInterval(iv);
  }, [id, booking?.trackingStatus, notFound]);

  useEffect(() => {
    if (!booking) return;
    let cancelled = false;
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { lat: booking.pickupLat, lng: booking.pickupLng },
        to: { lat: booking.destLat, lng: booking.destLng },
        stops: booking.stops ?? [],
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRouteLine(d.geometry ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Bei Zieländerung (destChangeCount/dest) Strecke neu zeichnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, booking?.destLat, booking?.destLng, booking?.destChangeCount]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!booking) return [];
    const m: MapMarker[] = [
      { id: "pickup", lat: booking.pickupLat, lng: booking.pickupLng, kind: "pickup", popup: "Abholung" },
      ...((booking.stops ?? []) as Array<{ lat: number; lng: number }>).map((s, i) => ({
        id: `stop${i}`,
        lat: s.lat,
        lng: s.lng,
        kind: "stop" as const,
        label: String(i + 1),
        popup: `Stopp ${i + 1}`,
      })),
      { id: "dest", lat: booking.destLat, lng: booking.destLng, kind: "dest", popup: "Ziel" },
    ];
    const dl = driverLoc ?? (booking.driver?.lat != null ? { lat: booking.driver.lat, lng: booking.driver.lng } : null);
    if (dl) m.push({ id: "driver", lat: dl.lat, lng: dl.lng, kind: "car", popup: booking.driver?.name ?? "Fahrer" });
    return m;
  }, [booking, driverLoc]);

  if (notFound) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink-100 p-6 text-center">
        <div>
          <p className="text-5xl">🤔</p>
          <h1 className="mt-4 text-xl font-bold">Auftrag nicht gefunden</h1>
          <Link href="/" className="btn-primary mt-6">Zur Startseite</Link>
        </div>
      </main>
    );
  }

  if (!booking) {
    return <main className="grid min-h-screen place-items-center bg-ink-100">Lädt …</main>;
  }

  const status = booking.trackingStatus as string;
  const currentIdx = TRACKING_STEPS.indexOf(status as any);
  const center: [number, number] =
    (driverLoc && [driverLoc.lat, driverLoc.lng]) ||
    [booking.pickupLat, booking.pickupLng];
  const isScheduled = status === "GEPLANT";
  const noDriver = status === "KEIN_FAHRER";
  const cancelled = status === "STORNIERT";
  // Zieländerung erlaubt, solange ein Fahrer dran ist und die Fahrt nicht beendet ist.
  const canChangeDest = ["FAHRER_GEFUNDEN", "FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"].includes(status);
  const isCard = booking.paymentMethod === "CARD";
  const chatOpen = !!booking.driver && !["BEENDET", "STORNIERT"].includes(status);
  const platformPhone = process.env.NEXT_PUBLIC_PLATFORM_PHONE;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Brand subtitle="Fahrt verfolgen" />
          <Link href="/" className="text-sm font-bold text-ink-500 hover:text-ink-900">Startseite</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-3xl gap-4 px-5 py-5">
        {/* Status-Banner */}
        <div
          data-testid="tracking-banner"
          className={`relative overflow-hidden rounded-3xl p-6 shadow-float ${
            cancelled
              ? "bg-red-500 text-white"
              : noDriver
              ? "bg-brand-500 text-ink-900"
              : status === "BEENDET"
              ? "bg-green-500 text-white"
              : "bg-ink-900 text-white"
          }`}
        >
          <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <p className={`eyebrow ${cancelled || noDriver ? "text-ink-900/70" : "text-brand-500"}`}>Aktueller Status</p>
          <p className="mt-1 font-display text-2xl font-extrabold leading-tight" data-testid="tracking-status">
            {TRACKING_LABEL[status] ?? status}
          </p>
          {booking.etaSeconds != null && ["FAHRER_UNTERWEGS", "FAHRER_GEFUNDEN"].includes(status) && (
            <p className={`mt-1 font-bold ${cancelled || noDriver ? "text-ink-900/80" : "text-brand-500"}`}>
              Ankunft in ca. {formatDuration(booking.etaSeconds)}
            </p>
          )}
          {isScheduled && (
            <p className="mt-1 font-bold text-brand-500">Geplant für {formatDateTime(booking.scheduledAt)}</p>
          )}
          {status === "SUCHE" && (
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-brand-500">
              <span className="pulse-yellow relative h-2.5 w-2.5 rounded-full bg-brand-500" />
              Einen Fahrer suchen…
            </div>
          )}
          {status === "RESERVIERT_FAHRER" && (
            <p className="mt-2 max-w-md text-sm font-semibold text-brand-500">
              Ihr Fahrer beendet aktuell noch eine andere Fahrt und kommt anschließend direkt zu Ihnen.
            </p>
          )}
        </div>

        {/* Plattform-Hotline bei fehlendem Fahrer (Phase 3j) */}
        {noDriver && platformPhone && (
          <a
            href={`tel:${platformPhone}`}
            data-testid="platform-hotline"
            className="card flex items-center justify-between gap-3 p-4 transition hover:bg-ink-50"
          >
            <div className="text-sm text-ink-600">
              <p className="font-semibold text-ink-900">Lieber telefonisch buchen?</p>
              <p>Unsere Zentrale hilft Ihnen sofort weiter.</p>
            </div>
            <span className="shrink-0 rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-white">{platformPhone}</span>
          </a>
        )}

        {/* Stornierung (Kunde) */}
        {["SUCHE", "RESERVIERT_FAHRER", "FAHRER_GEFUNDEN", "FAHRER_UNTERWEGS", "GEPLANT"].includes(status) && !cancelled && (
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm text-ink-600">
              <p className="font-semibold text-ink-900">Pläne geändert?</p>
              <p>Sie können bis zur Ankunft des Fahrers kostenlos stornieren.</p>
              {cancelError && (
                <p data-testid="cancel-error" className="mt-1 text-xs font-bold text-red-600">{cancelError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={cancelBooking}
              disabled={cancelling}
              data-testid="cancel-booking"
              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
            >
              {cancelling ? "Storniere…" : "Fahrt stornieren"}
            </button>
          </div>
        )}

        {/* SOS / Notfall (Phase 17): während einer aktiven Fahrt */}
        {["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT", "RESERVIERT_FAHRER"].includes(status) && (
          <div className="card flex flex-wrap items-center justify-between gap-3 border-2 border-red-200 p-4" data-testid="sos-card">
            <div className="text-sm text-ink-600">
              <p className="font-semibold text-red-700">Notfall während der Fahrt?</p>
              <p>Sendet Ihren Standort an die Zentrale und Ihren Notfallkontakt.</p>
            </div>
            {sosState === "sent" ? (
              <div className="text-right" data-testid="sos-sent">
                <span className="rounded-xl bg-red-100 px-4 py-2 text-sm font-extrabold text-red-700">✓ Notruf gesendet</span>
                {sosRescue?.name && (
                  <p className="mt-1 text-xs font-bold text-ink-900" data-testid="sos-rescue">
                    Hilfe unterwegs: {sosRescue.name}{sosRescue.vehiclePlate ? ` · ${sosRescue.vehiclePlate}` : ""}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={triggerSos}
                disabled={sosState === "sending"}
                data-testid="sos-button"
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {sosState === "sending" ? "Sende…" : "🆘 SOS"}
              </button>
            )}
          </div>
        )}

        {/* Fahrtbeleg (Phase 19): nach Abschluss als PDF */}
        {status === "BEENDET" && (
          <a
            href={`/api/bookings/${id}/invoice`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="download-receipt"
            className="card flex items-center justify-between gap-3 p-4 transition hover:bg-ink-50"
          >
            <div className="text-sm text-ink-600">
              <p className="font-semibold text-ink-900">Fahrtbeleg herunterladen</p>
              <p>Quittung dieser Fahrt als PDF.</p>
            </div>
            <span className="shrink-0 rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-white">PDF öffnen</span>
          </a>
        )}

        {/* Digitaler Fahrtnachweis (Unterschrift) – bei Krankenfahrten */}
        {status === "BEENDET" && booking.medicalType && (
          <div className="card p-4" data-testid="signature-card">
            {booking.hasSignature ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold text-green-700">✓ Fahrtnachweis unterschrieben</p>
                  <p className="text-ink-500">{booking.signatureAt ? new Date(booking.signatureAt).toLocaleString("de-DE") : ""}</p>
                </div>
                <a href={`/api/bookings/${id}/signature?format=png`} target="_blank" rel="noreferrer" data-testid="view-signature" className="shrink-0 rounded-xl bg-ink-100 px-3 py-2 text-sm font-bold text-ink-700 hover:bg-ink-200">Ansehen</a>
              </div>
            ) : !sigOpen ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-ink-600">
                  <p className="font-semibold text-ink-900">Fahrtnachweis unterschreiben</p>
                  <p>Digitale Unterschrift als Nachweis – z. B. für die Krankenkasse.</p>
                </div>
                <button onClick={() => setSigOpen(true)} data-testid="open-signature" className="shrink-0 rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-white hover:bg-ink-800">Unterschreiben</button>
              </div>
            ) : (
              <div className="grid gap-2">
                <p className="text-sm font-semibold text-ink-900">Bitte im Feld unterschreiben:</p>
                <SignaturePad onSubmit={submitSignature} busy={sigBusy} />
              </div>
            )}
          </div>
        )}

        {/* Ziel ändern / Zwischenstopp einlegen (Phase 2f) */}
        {canChangeDest && (
          <div className="card p-4" data-testid="change-dest-card">
            {!editOpen ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-ink-600">
                  <p className="font-semibold text-ink-900">Ziel ändern oder Stopp einlegen?</p>
                  <p>Neues Ziel oder Zwischenstopp – der Preis wird automatisch neu berechnet.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(true);
                    setChangeError(null);
                  }}
                  data-testid="open-change-dest"
                  className="rounded-xl border border-ink-300 px-4 py-2 text-sm font-bold text-ink-800 transition hover:bg-ink-50"
                >
                  Ziel ändern
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="change-mode-dest"
                    onClick={() => setChangeMode("dest")}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${
                      changeMode === "dest" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 text-ink-600"
                    }`}
                  >
                    Neues Ziel
                  </button>
                  <button
                    type="button"
                    data-testid="change-mode-stop"
                    onClick={() => setChangeMode("stop")}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${
                      changeMode === "stop" ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 text-ink-600"
                    }`}
                  >
                    Zwischenstopp
                  </button>
                </div>
                <AddressInput
                  label={changeMode === "dest" ? "Neues Ziel" : "Zwischenstopp"}
                  placeholder="Adresse eingeben"
                  value={newAddr.address}
                  onChange={(t) => setNewAddr({ address: t, lat: undefined, lng: undefined })}
                  onSelect={(r: GeocodeResult) => setNewAddr({ address: r.label, lat: r.lat, lng: r.lng })}
                />
                {changeError && (
                  <p data-testid="change-dest-error" className="text-xs font-bold text-red-600">
                    {changeError}
                  </p>
                )}
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditOpen(false);
                      setNewAddr({ address: "" });
                      setChangeError(null);
                    }}
                    className="btn-ghost text-sm"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={submitDestChange}
                    disabled={changing}
                    data-testid="submit-change-dest"
                    className="btn-primary text-sm disabled:opacity-60"
                  >
                    {changing ? "Wird übernommen…" : changeMode === "dest" ? "Ziel übernehmen" : "Stopp hinzufügen"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Karte */}
        <div className="card h-72 overflow-hidden p-0 sm:h-80">
          <Map center={center} markers={markers} line={routeLine ?? undefined} fit zoom={14} />
        </div>

        {/* Abschluss: Quittung + Bewertung */}
        {status === "BEENDET" && (
          <div className="card p-6 text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 text-xl font-extrabold text-ink-900">Vielen Dank!</h2>
            <p className="text-ink-600">Ihre Fahrt ist beendet.</p>
            <p className="mt-4 eyebrow text-ink-400">Gesamtpreis</p>
            <p className="text-3xl font-extrabold text-ink-900" data-testid="final-fare">{formatEuro(booking.fare ?? booking.priceExact ?? booking.priceMax)}</p>
            {booking.rating || ratedDone ? (
              <p className="mt-4 font-semibold text-green-600">Danke für Ihre Bewertung! ⭐</p>
            ) : (
              <>
                <p className="mt-5 text-sm text-ink-500">Bewerten Sie Ihre Fahrt</p>
                <div className="mt-2 flex justify-center gap-1" onMouseLeave={() => setStars(0)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setStars(n)}
                      onClick={() => submitRating(n)}
                      data-testid={`rating-star-${n}`}
                      className="text-4xl leading-none transition"
                      aria-label={`${n} Sterne`}
                    >
                      <span className={n <= stars ? "text-brand-500" : "text-ink-300"}>★</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Fortschritt */}
        {!isScheduled && !cancelled && (
          <div className="card p-5">
            <ol className="grid gap-3">
              {TRACKING_STEPS.map((step, i) => {
                const done = currentIdx >= 0 && i <= currentIdx;
                const active = i === currentIdx;
                return (
                  <li key={step} className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        done ? "bg-green-600 text-white" : "bg-ink-200 text-ink-500"
                      } ${active ? "ring-4 ring-green-200" : ""}`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={done ? "font-semibold text-ink-900" : "text-ink-500"}>
                      {TRACKING_LABEL[step]}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Fahrerinformationen */}
        {booking.driver && (
          <div className="card p-5" data-testid="driver-info-card">
            <h2 className="mb-3 eyebrow text-ink-500">Ihr Fahrer</h2>
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-ink-900">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-display text-lg font-extrabold text-ink-900">{booking.driver.name}</p>
                <p className="text-sm text-ink-600">
                  {booking.driver.vehicleColor} {booking.driver.vehicleModel} ·{" "}
                  <span className="rounded bg-brand-500 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-900">
                    {booking.driver.vehiclePlate}
                  </span>
                </p>
              </div>
              {booking.driver.phone && (
                <a href={`tel:${booking.driver.phone}`} data-testid="call-driver" className="btn-ghost">
                  Anrufen
                </a>
              )}
            </div>
          </div>
        )}

        {/* Chat Kunde <-> Fahrer (Phase 3i) */}
        {chatOpen && <ChatPanel bookingId={id} me="CUSTOMER" />}

        {/* Fahrtdetails */}
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Fahrt</h2>
          <div className="grid gap-2 text-sm">
            <Row label="Von" value={booking.pickupAddress} />
            {((booking.stops ?? []) as Array<{ address: string }>).map((s, i) => (
              <Row key={i} label={`Stopp ${i + 1}`} value={s.address} testid={`row-stop-${i}`} />
            ))}
            <Row label="Nach" value={booking.destAddress} />
            {booking.priceExact != null ? (
              <Row
                label="Festpreis"
                value={formatEuro(booking.priceExact)}
                testid="row-price-exact"
                highlight
              />
            ) : (
              <Row
                label="Voraussichtlich"
                value={`ca. ${formatEuro(booking.priceApprox ?? booking.priceMax)}`}
                testid="row-price-approx"
              />
            )}
            <Row label="Auftragsnummer" value={booking.id} />
          </div>
          {booking.priceExact != null && status !== "BEENDET" && (
            <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-ink-700">
              ✓ Festpreis bestätigt nach Annahme durch den Fahrer.
            </p>
          )}
        </div>

        {/* Zahlung (Phase 2g) */}
        <div className="card p-5" data-testid="payment-card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Zahlung</h2>
          {!isCard ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-600">Barzahlung beim Fahrer</span>
              <span className="font-bold text-ink-900" data-testid="payment-status">
                Bar
              </span>
            </div>
          ) : (
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Kartenzahlung</span>
                <span
                  data-testid="payment-status"
                  className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                    booking.paymentStatus === "BEZAHLT"
                      ? "bg-green-100 text-green-800"
                      : booking.paymentStatus === "AUTORISIERT"
                      ? "bg-brand-100 text-ink-900"
                      : booking.paymentStatus === "FEHLGESCHLAGEN"
                      ? "bg-red-100 text-red-700"
                      : "bg-ink-100 text-ink-600"
                  }`}
                >
                  {(
                    {
                      AUTORISIERT: "Autorisiert",
                      BEZAHLT: "Bezahlt",
                      FEHLGESCHLAGEN: "Fehlgeschlagen",
                      STORNIERT: "Freigegeben",
                      OFFEN: "Offen",
                    } as Record<string, string>
                  )[booking.paymentStatus as string] ?? booking.paymentStatus}
                </span>
              </div>
              {booking.paymentStatus === "AUTORISIERT" && (
                <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-ink-700">
                  {booking.priceAuthorized != null
                    ? `${formatEuro(booking.priceAuthorized)} auf Ihrer Karte reserviert. `
                    : "Betrag auf Ihrer Karte reserviert. "}
                  Die endgültige Belastung erfolgt erst nach Fahrtende.
                </p>
              )}
              {booking.paymentStatus === "BEZAHLT" && (
                <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
                  {formatEuro(booking.fare ?? booking.priceExact)} wurden Ihrer Karte belastet.
                </p>
              )}
              {booking.paymentStatus === "FEHLGESCHLAGEN" && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  Kartenzahlung fehlgeschlagen – bitte begleichen Sie den Betrag bar beim Fahrer.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, testid, highlight }: { label: string; value: string; testid?: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-4" data-testid={testid}>
      <span className="text-ink-500">{label}</span>
      <span className={`text-right ${highlight ? "font-extrabold text-ink-900" : "font-medium text-ink-900"}`}>
        {value}
      </span>
    </div>
  );
}
