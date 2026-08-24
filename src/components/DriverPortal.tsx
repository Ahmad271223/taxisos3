"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import { ChatPanel } from "@/components/ChatPanel";
import { DRIVER_STATUS, DRIVER_STATUS_LABEL, DRIVER_STATUS_COLOR, TRACKING_LABEL } from "@/lib/status";
import { formatEuro, formatDistance, formatDuration, formatDateTime } from "@/lib/format";
import type { GeocodeResult } from "@/lib/geo";

const FALLBACK = { lat: 52.375892, lng: 9.732010 }; // Hannover

// VAPID-Key (base64url) -> Uint8Array für pushManager.subscribe.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function DriverPortal() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"checking" | "ok" | "denied">("checking");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>("PAUSE");
  const [active, setActive] = useState<any | null>(null);
  const [myScheduled, setMyScheduled] = useState<any[]>([]);
  const [openScheduled, setOpenScheduled] = useState<any[]>([]);
  // 30-Min-Rückfrage vor einer reservierten Vorbestellung
  const [confirmAsk, setConfirmAsk] = useState<any | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [offer, setOffer] = useState<any | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [summary, setSummary] = useState<{ today: { trips: number; revenue: number }; recent: any[] } | null>(null);
  const [gpsOk, setGpsOk] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [emergencyAlert, setEmergencyAlert] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const sharingRef = useRef(false); // aktueller GPS-Zustand für Event-Handler
  // Push-Benachrichtigungen (neue Fahrtanfragen auch im Hintergrund)
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "denied" | "busy">("off");
  // Zieländerung / Zwischenstopp (Phase 2f)
  const [destEdit, setDestEdit] = useState(false);
  const [destMode, setDestMode] = useState<"dest" | "stop">("dest");
  const [destAddr, setDestAddr] = useState<{ address: string; lat?: number; lng?: number }>({ address: "" });

  const loadSummary = useCallback(() => {
    fetch("/api/driver/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSummary(d))
      .catch(() => {});
  }, []);

  // Auth pruefen
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.driver?.role === "DRIVER") {
          setAuthState("ok");
          setName(d.driver.name);
        } else {
          router.replace("/fahrer/login");
        }
      })
      .catch(() => router.replace("/fahrer/login"));
  }, [router]);

  // Socket
  useEffect(() => {
    if (authState !== "ok") return;
    const socket = getSocket("driver");

    // Merker: ist ueberhaupt schon ein Stand angekommen?
    let standErhalten = false;

    const onState = (s: any) => {
      standErhalten = true;
      setStatus(s.status);
      if (s.name) setName(s.name);
      setActive(s.activeBooking);
      setMyScheduled(s.myScheduled ?? []);
      setOpenScheduled(s.openScheduled ?? []);
      loadSummary();
    };
    const onOffer = (o: any) => setOffer(o);
    const onOfferCancel = (p: { bookingId: string }) =>
      setOffer((cur: any) => (cur?.id === p.bookingId ? null : cur));
    const onBooking = (b: any) => {
      setActive((cur: any) => (cur && cur.id === b.id ? b : cur));
    };
    // Notfall-Rettungsfahrt (Phase 21): sofort als aktive Fahrt übernehmen.
    const onEmergency = (b: any) => {
      setActive(b);
      setOffer(null);
      setEmergencyAlert(true);
    };
    // Rückfrage 30 Min vor einer reservierten Vorbestellung.
    const onConfirmScheduled = (p: any) => setConfirmAsk(p);

    socket.on("driver:state", onState);
    socket.on("driver:offer", onOffer);
    socket.on("driver:offerCancel", onOfferCancel);
    socket.on("driver:booking", onBooking);
    socket.on("driver:emergency", onEmergency);
    socket.on("driver:confirmScheduled", onConfirmScheduled);

    // Stand aktiv anfordern, statt nur auf den Push zu warten.
    //
    // Geht die Nachricht beim Verbindungsaufbau verloren (Socket.IO schaltet
    // dabei von Polling auf WebSocket um), blieb das Dashboard sonst dauerhaft
    // im Ladezustand – ohne Meldung. Deshalb: beim Verbinden anfordern, nach
    // dem Zurueckkehren aus dem Hintergrund erneut, und notfalls wiederholen.
    const anfordern = () => socket.emit("driver:sync", {});
    const onConnect = () => {
      standErhalten = false;
      anfordern();
    };
    const onSichtbar = () => {
      if (document.visibilityState === "visible") anfordern();
    };

    socket.on("connect", onConnect);
    document.addEventListener("visibilitychange", onSichtbar);
    if (socket.connected) anfordern();

    // Sicherungsnetz gegen eine still gestorbene Verbindung.
    //
    // Beobachtet: der Socket gilt auf BEIDEN Seiten als verbunden, es fliessen
    // aber keine Daten mehr. Nachfragen bringt dann nichts – die Anfrage kommt
    // gar nicht erst an. Erst der Herzschlag von Socket.IO merkt es und baut
    // neu auf; bis dahin ist der Fahrer blind und verpasst Auftraege.
    //
    // Deshalb: zweimal nachfragen, und wenn dann immer noch nichts da ist, die
    // Verbindung selbst neu aufbauen, statt auf den Herzschlag zu warten.
    let versuche = 0;
    const nachfassen = setInterval(() => {
      if (standErhalten) return;
      versuche += 1;
      if (versuche <= 2) {
        anfordern();
      } else if (versuche === 3) {
        // Verbindung ist offenbar tot – neu aufbauen.
        socket.disconnect();
        socket.connect();
      } else if (versuche > 6) {
        clearInterval(nachfassen);
      }
    }, 2500);

    return () => {
      clearInterval(nachfassen);
      document.removeEventListener("visibilitychange", onSichtbar);
      socket.off("connect", onConnect);
      socket.off("driver:state", onState);
      socket.off("driver:offer", onOffer);
      socket.off("driver:offerCancel", onOfferCancel);
      socket.off("driver:booking", onBooking);
      socket.off("driver:emergency", onEmergency);
      socket.off("driver:confirmScheduled", onConfirmScheduled);
    };
  }, [authState, loadSummary]);

  // Wake Lock: Bildschirm wach halten, damit der GPS-Watch nicht eingefroren
  // wird, wenn das Display dunkel würde (Browser drosseln inaktive Tabs).
  async function acquireWakeLock() {
    try {
      const anyNav = navigator as any;
      if (anyNav?.wakeLock?.request && !wakeLockRef.current) {
        wakeLockRef.current = await anyNav.wakeLock.request("screen");
        wakeLockRef.current.addEventListener?.("release", () => { wakeLockRef.current = null; });
      }
    } catch { /* Wake Lock optional */ }
  }
  function releaseWakeLock() {
    try { wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
  }

  // Geolocation-Watch (neu) starten. Wird beim Einschalten und – falls der
  // Browser den Watch im Hintergrund beendet hat – beim Zurückkehren erneut
  // aufgesetzt. Läuft weiter bis der Fahrer GPS selbst ausschaltet.
  function beginWatch() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    const socket = getSocket("driver");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsOk(true);
        socket.emit("driver:location", { lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        if (err.code === 1) {
          alert("Standort wurde blockiert. Bitte im Browser erlauben.");
          stopSharing();
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  // GPS: Live-Standort nur teilen, wenn der Fahrer es aktiv eingeschaltet hat.
  function startSharing() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("Standortdienste werden vom Browser nicht unterstützt.");
      return;
    }
    if (watchIdRef.current != null) return;
    beginWatch();
    sharingRef.current = true;
    setSharing(true);
    acquireWakeLock();
  }
  function stopSharing() {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    sharingRef.current = false;
    setSharing(false);
    setGpsOk(false);
    releaseWakeLock();
    // Bei Stopp Fahrer offline, damit kein Auftrag mehr ankommt.
    if (status === "FREI") {
      getSocket("driver").emit("driver:status", { status: "PAUSE" });
      setStatus("PAUSE");
    }
  }
  useEffect(() => () => stopSharing(), []); // cleanup on unmount

  // Hintergrund-Robustheit: Wenn die App wieder sichtbar wird, Wake Lock erneut
  // anfordern und – falls der Browser den GPS-Watch pausiert hat – neu starten.
  // So bleibt die Übertragung aktiv, bis der Fahrer GPS selbst ausschaltet.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (sharingRef.current) {
        acquireWakeLock();
        beginWatch();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Service Worker registrieren + bestehenden Push-Status ermitteln.
  useEffect(() => {
    if (authState !== "ok") return;
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) { setPushState("unsupported"); return; }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === "denied") setPushState("denied");
        else setPushState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setPushState("off");
      }
    })();
    return () => { cancelled = true; };
  }, [authState]);

  async function enablePush() {
    setPushState("busy");
    try {
      const keyRes = await fetch("/api/push/key").then((r) => r.json()).catch(() => null);
      if (!keyRes?.enabled || !keyRes?.publicKey) {
        alert("Push ist auf diesem Server nicht konfiguriert (VAPID-Keys fehlen).");
        setPushState("off");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPushState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setPushState(res.ok ? "on" : "off");
    } catch {
      setPushState("off");
    }
  }

  async function disablePush() {
    setPushState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } finally {
      setPushState("off");
    }
  }

  // Countdown fuer Angebot
  useEffect(() => {
    if (!offer) return;
    const tick = () => {
      const ms = Math.max(0, (offer.offerExpiresAt ?? 0) - Date.now());
      setRemaining(Math.ceil(ms / 1000));
      if (ms <= 0) setOffer(null);
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [offer]);

  function changeStatus(s: string) {
    if (s === "FREI" && !sharing) {
      alert("Bitte zuerst den Live-Standort teilen (Schalter oben). Ohne GPS keine Aufträge.");
      return;
    }
    setStatus(s);
    getSocket("driver").emit("driver:status", { status: s });
  }
  function respond(accept: boolean) {
    if (!offer) return;
    getSocket("driver").emit("driver:respond", { bookingId: offer.id, accept });
    setOffer(null);
  }
  function tripAction(action: string) {
    if (!active) return;
    getSocket("driver").emit("driver:trip", { bookingId: active.id, action });
  }
  function reserve(bookingId: string) {
    getSocket("driver").emit("driver:reserve", { bookingId });
  }
  // Antwort auf die 30-Min-Rückfrage: Ja = behalten, Nein = Storno-Button zeigen.
  function answerConfirm(bookingId: string, keep: boolean) {
    setConfirmBusy(true);
    getSocket("driver").emit("driver:confirmScheduled", { bookingId, keep }, () => {
      setConfirmBusy(false);
      setConfirmAsk(null);
    });
  }
  // Endgültige Absage – erst dieser Schritt gibt die Fahrt frei.
  function cancelScheduled(bookingId: string) {
    if (!window.confirm("Fahrt wirklich stornieren? Der Kunde wird informiert und wir suchen einen neuen Fahrer.")) return;
    setConfirmBusy(true);
    getSocket("driver").emit("driver:cancelScheduled", { bookingId }, () => {
      setConfirmBusy(false);
      setConfirmAsk(null);
    });
  }
  function submitDestChange() {
    if (!active || destAddr.lat == null || destAddr.lng == null) return;
    const place = { address: destAddr.address, lat: destAddr.lat, lng: destAddr.lng };
    getSocket("driver").emit("driver:changeDest", {
      bookingId: active.id,
      ...(destMode === "dest" ? { dest: place } : { addStop: place }),
    });
    setDestEdit(false);
    setDestAddr({ address: "" });
  }
  function navigate(lat: number, lng: number, waypoints?: Array<{ lat: number; lng: number }>) {
    // Zwischenstopps als Google-Maps-Waypoints einfügen, damit die Navigation
    // die Route ÜBER die Stopps führt (nicht direkt zum Ziel).
    const wp =
      waypoints && waypoints.length
        ? `&waypoints=${encodeURIComponent(waypoints.map((w) => `${w.lat},${w.lng}`).join("|"))}`
        : "";
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${wp}`, "_blank");
  }
  async function logout() {
    await fetch("/api/auth/logout?scope=driver", { method: "POST" });
    router.replace("/fahrer/login");
  }

  if (authState !== "ok") {
    return <main className="grid min-h-screen place-items-center bg-ink-900 text-white">Lädt …</main>;
  }

  const navTarget =
    active?.trackingStatus === "FAHRT_LAEUFT"
      ? { lat: active.destLat, lng: active.destLng, label: "zum Ziel" }
      : active
      ? { lat: active.pickupLat, lng: active.pickupLng, label: "zur Abholung" }
      : null;

  return (
    <main className="min-h-screen bg-ink-50 pb-20">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Brand href="/fahrer" subtitle={name} />
          <button onClick={logout} data-testid="driver-logout" className="text-sm font-bold text-ink-500 hover:text-ink-900">Abmelden</button>
        </div>
      </header>

      {emergencyAlert && (
        <button
          type="button"
          onClick={() => setEmergencyAlert(false)}
          data-testid="driver-emergency-toast"
          className="sticky top-[57px] z-20 w-full bg-red-600 px-5 py-3 text-center text-sm font-extrabold text-white"
        >
          🆘 NOTFALL-EINSATZ zugewiesen – sofort losfahren! (antippen zum Schließen)
        </button>
      )}

      <div className="mx-auto grid max-w-2xl gap-4 px-5 py-5">
        {/* Live-Standort Schalter (Pflicht fuer FREI) */}
        <div className={`card flex items-center justify-between p-5 ${sharing ? "border-2 border-green-500" : ""}`} data-testid="gps-share-card">
          <div className="min-w-0 pr-3">
            <p className="font-display text-lg font-extrabold">Live-Standort teilen</p>
            <p className="text-sm text-ink-500">
              {sharing
                ? gpsOk
                  ? "GPS aktiv – Sie sind disponierbar."
                  : "Warte auf GPS-Signal …"
                : "Pflicht für „Frei“. Standort wird live an die Zentrale gemeldet."}
            </p>
          </div>
          <button
            type="button"
            data-testid="gps-share-toggle"
            onClick={() => (sharing ? stopSharing() : startSharing())}
            className={`relative h-9 w-16 shrink-0 rounded-full transition ${sharing ? "bg-green-500" : "bg-ink-200"}`}
            aria-pressed={sharing}
            aria-label="Live-Standort teilen umschalten"
          >
            <span
              className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition ${
                sharing ? "left-8" : "left-1"
              }`}
            />
          </button>
        </div>

        {sharing && (
          <p className="-mt-2 px-1 text-xs text-ink-400" data-testid="gps-background-hint">
            📍 GPS bleibt an und wird übertragen, bis Sie es selbst ausschalten. Für Hintergrund-Betrieb die App geöffnet lassen (Bildschirm bleibt dank Wake-Lock aktiv) – bei komplett geschlossener App pausiert das Handy die Standortübertragung.
          </p>
        )}

        {/* Push-Benachrichtigungen: neue Fahrtanfragen auch im Hintergrund */}
        {pushState !== "unsupported" && (
          <div className={`card flex items-center justify-between p-5 ${pushState === "on" ? "border-2 border-brand-400" : ""}`} data-testid="push-card">
            <div className="min-w-0 pr-3">
              <p className="font-display text-lg font-extrabold">🔔 Benachrichtigungen</p>
              <p className="text-sm text-ink-500">
                {pushState === "on" ? "Aktiv – Sie werden bei neuen Fahrtanfragen benachrichtigt (auch im Hintergrund)."
                  : pushState === "denied" ? "Im Browser blockiert. Bitte in den Einstellungen erlauben."
                  : "Push aktivieren, um Fahrtanfragen auch bei geschlossenem Tab zu erhalten."}
              </p>
            </div>
            <button
              type="button"
              data-testid="push-toggle"
              disabled={pushState === "busy" || pushState === "denied"}
              onClick={() => (pushState === "on" ? disablePush() : enablePush())}
              className={`relative h-9 w-16 shrink-0 rounded-full transition disabled:opacity-50 ${pushState === "on" ? "bg-brand-500" : "bg-ink-200"}`}
              aria-pressed={pushState === "on"}
              aria-label="Push-Benachrichtigungen umschalten"
            >
              <span className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition ${pushState === "on" ? "left-8" : "left-1"}`} />
            </button>
          </div>
        )}

        {/* Status */}
        <div className="card p-5" data-testid="driver-status-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="eyebrow text-ink-500">Mein Status</h2>
            <span className="flex items-center gap-1.5 text-xs font-bold">
              <span className={`relative h-2.5 w-2.5 rounded-full ${gpsOk ? "bg-green-500" : "bg-ink-300"}`}>
                {gpsOk && <span className="absolute inset-0 animate-ping2 rounded-full bg-green-500" />}
              </span>
              {gpsOk ? "GPS aktiv" : "GPS aus"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DRIVER_STATUS.map((s) => (
              <button
                key={s}
                data-testid={`driver-status-${s.toLowerCase()}`}
                onClick={() => changeStatus(s)}
                disabled={!!active && s !== "BESETZT"}
                className={`rounded-2xl px-3 py-3.5 text-sm font-bold ring-1 transition disabled:opacity-40 ${
                  status === s ? "text-white ring-transparent shadow-soft" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50"
                }`}
                style={status === s ? { backgroundColor: DRIVER_STATUS_COLOR[s], color: s === "PAUSE" ? "#111827" : "#fff" } : undefined}
              >
                {DRIVER_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Einnahmen */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-xs uppercase tracking-wide text-ink-500">Einnahmen heute</p>
            <p className="mt-1 text-2xl font-extrabold text-ink-900">{formatEuro(summary?.today.revenue ?? 0)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs uppercase tracking-wide text-ink-500">Fahrten heute</p>
            <p className="mt-1 text-2xl font-extrabold text-ink-900">{summary?.today.trips ?? 0}</p>
          </div>
        </div>

        {/* Aktiver Auftrag */}
        {active && (
          <div className={`card p-5 ${active.isSos ? "border-2 border-red-500" : "border-2 border-brand-500"}`} data-testid="active-trip">
            {active.isSos && (
              <div className="mb-3 rounded-xl bg-red-600 px-4 py-3 text-center font-extrabold text-white" data-testid="driver-sos-banner">
                🆘 NOTFALL – bitte SOFORT zum Standort fahren!
              </div>
            )}
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-extrabold text-ink-900">{active.isSos ? "Notfall-Einsatz" : "Aktueller Auftrag"}</h2>
              <span className="chip bg-ink-900 text-white" data-testid="active-trip-status">
                {TRACKING_LABEL[active.trackingStatus]}
              </span>
            </div>
            <TripInfo b={active} />
            {navTarget && (
              <button
                onClick={() =>
                  navigate(
                    navTarget.lat,
                    navTarget.lng,
                    active?.trackingStatus === "FAHRT_LAEUFT" ? (active.stops ?? []) : undefined,
                  )
                }
                data-testid="driver-navigate"
                className="btn-primary mt-4 w-full"
              >
                Navigation starten ({navTarget.label})
              </button>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={() => tripAction("arrived")}
                disabled={active.trackingStatus !== "FAHRER_UNTERWEGS"}
                data-testid="trip-arrived"
                className="btn-ghost text-sm disabled:opacity-40"
              >
                Angekommen
              </button>
              <button
                onClick={() => tripAction("start")}
                disabled={active.trackingStatus !== "FAHRER_ANGEKOMMEN"}
                data-testid="trip-start"
                className="btn-dark text-sm disabled:opacity-40"
              >
                Fahrt starten
              </button>
              <button
                onClick={() => tripAction("complete")}
                disabled={active.trackingStatus !== "FAHRT_LAEUFT"}
                data-testid="trip-complete"
                className="btn-success text-sm disabled:opacity-40"
              >
                Beenden
              </button>
            </div>

            {active.trackingStatus === "FAHRER_ANGEKOMMEN" && (
              <button
                onClick={() => { if (window.confirm("Gast ist nicht erschienen? Die Fahrt wird storniert (ggf. No-Show-Gebühr).")) tripAction("noshow"); }}
                data-testid="trip-noshow"
                className="btn-ghost mt-2 w-full text-sm font-bold text-red-600"
              >
                Gast nicht erschienen (No-Show)
              </button>
            )}

            {/* Ziel ändern / Zwischenstopp (Phase 2f) */}
            {["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"].includes(active.trackingStatus) && (
              <div className="mt-3 border-t border-ink-100 pt-3" data-testid="driver-change-dest">
                {!destEdit ? (
                  <button
                    type="button"
                    onClick={() => setDestEdit(true)}
                    data-testid="driver-open-change-dest"
                    className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm font-bold text-ink-700 transition hover:bg-ink-50"
                  >
                    Ziel ändern / Zwischenstopp
                  </button>
                ) : (
                  <div className="grid gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDestMode("dest")}
                        className={`flex-1 rounded-lg border-2 px-2 py-1.5 text-xs font-bold transition ${
                          destMode === "dest" ? "border-brand-500 bg-brand-50" : "border-ink-200 text-ink-600"
                        }`}
                      >
                        Neues Ziel
                      </button>
                      <button
                        type="button"
                        onClick={() => setDestMode("stop")}
                        className={`flex-1 rounded-lg border-2 px-2 py-1.5 text-xs font-bold transition ${
                          destMode === "stop" ? "border-brand-500 bg-brand-50" : "border-ink-200 text-ink-600"
                        }`}
                      >
                        Zwischenstopp
                      </button>
                    </div>
                    <AddressInput
                      label={destMode === "dest" ? "Neues Ziel" : "Zwischenstopp"}
                      placeholder="Adresse eingeben"
                      value={destAddr.address}
                      onChange={(t) => setDestAddr({ address: t, lat: undefined, lng: undefined })}
                      onSelect={(r: GeocodeResult) => setDestAddr({ address: r.label, lat: r.lat, lng: r.lng })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDestEdit(false);
                          setDestAddr({ address: "" });
                        }}
                        className="btn-ghost text-sm"
                      >
                        Abbrechen
                      </button>
                      <button
                        type="button"
                        onClick={submitDestChange}
                        data-testid="driver-submit-change-dest"
                        className="btn-primary text-sm"
                      >
                        Übernehmen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat mit dem Fahrgast (Phase 3i) */}
        {active && !["BEENDET", "STORNIERT"].includes(active.trackingStatus) && (
          <ChatPanel bookingId={active.id} me="DRIVER" />
        )}

        {/* Meine Vorbestellungen (inkl. 30-Min-Rückfrage) */}
        {myScheduled.length > 0 && (
          <div className="card p-5">
            <h2 className="mb-3 font-bold text-ink-900">Meine geplanten Fahrten</h2>
            <div className="grid gap-3">
              {myScheduled.map((b) => {
                const asked = !!b.driverConfirmAskedAt;
                const declined = !!b.driverDeclinedAt;
                const confirmed = !!b.driverConfirmedAt;
                // Rückfrage offen: gestellt, aber noch nicht beantwortet.
                const open = asked && !declined && !confirmed;
                return (
                  <div
                    key={b.id}
                    data-testid={`scheduled-${b.id}`}
                    className={`rounded-xl p-3 text-sm ${
                      open ? "border-2 border-brand-500 bg-brand-50" : declined ? "border-2 border-red-200 bg-red-50" : "bg-ink-50"
                    }`}
                  >
                    <p className="font-semibold">{formatDateTime(b.scheduledAt)}</p>
                    <p className="text-ink-600">
                      {b.pickupAddress} → {b.destAddress}
                    </p>

                    {open && (
                      <div className="mt-3" data-testid="confirm-ask">
                        <p className="font-bold text-ink-900">Möchtest du diese Fahrt weiterhin durchführen?</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={confirmBusy}
                            data-testid="confirm-yes"
                            onClick={() => answerConfirm(b.id, true)}
                            className="rounded-xl bg-green-600 px-4 py-2 font-bold text-white transition hover:bg-green-700 disabled:opacity-60"
                          >
                            Ja
                          </button>
                          <button
                            type="button"
                            disabled={confirmBusy}
                            data-testid="confirm-no"
                            onClick={() => answerConfirm(b.id, false)}
                            className="rounded-xl border-2 border-ink-300 px-4 py-2 font-bold text-ink-800 transition hover:bg-ink-100 disabled:opacity-60"
                          >
                            Nein
                          </button>
                        </div>
                      </div>
                    )}

                    {confirmed && (
                      <p className="mt-2 font-semibold text-green-700" data-testid="confirm-done">
                        ✓ Zugesagt – die Fahrt bleibt bei dir.
                      </p>
                    )}

                    {declined && (
                      <div className="mt-3" data-testid="cancel-block">
                        <p className="font-semibold text-red-700">Du hast abgelehnt. Fahrt jetzt endgültig stornieren?</p>
                        <button
                          type="button"
                          disabled={confirmBusy}
                          data-testid="cancel-scheduled"
                          onClick={() => cancelScheduled(b.id)}
                          className="mt-2 w-full rounded-xl bg-red-600 px-4 py-2.5 font-extrabold text-white transition hover:bg-red-700 disabled:opacity-60"
                        >
                          Fahrt stornieren
                        </button>
                        <button
                          type="button"
                          disabled={confirmBusy}
                          onClick={() => answerConfirm(b.id, true)}
                          className="mt-2 w-full rounded-xl border border-ink-300 px-4 py-2 text-sm font-bold text-ink-700 transition hover:bg-ink-100 disabled:opacity-60"
                        >
                          Doch behalten
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Offene Vorbestellungen */}
        {openScheduled.length > 0 && !active && (
          <div className="card p-5">
            <h2 className="mb-3 font-bold text-ink-900">Verfügbare Vorbestellungen</h2>
            <div className="grid gap-3">
              {openScheduled.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 p-3 text-sm">
                  <div>
                    <p className="font-semibold">{formatDateTime(b.scheduledAt)}</p>
                    <p className="text-ink-600">{b.pickupAddress} → {b.destAddress}</p>
                  </div>
                  <button onClick={() => reserve(b.id)} className="btn-primary shrink-0 text-sm">Reservieren</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Letzte Fahrten */}
        {summary && summary.recent.length > 0 && (
          <div className="card p-5">
            <h2 className="mb-3 font-bold text-ink-900">Letzte Fahrten</h2>
            <div className="grid gap-2 text-sm">
              {summary.recent.map((b) => (
                <div key={b.id} className="flex justify-between border-b border-ink-100 pb-2 last:border-0">
                  <span className="truncate text-ink-600">{b.destAddress}</span>
                  <span className="font-semibold">{formatEuro(b.fare)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!active && status === "FREI" && (
          <p className="text-center text-sm text-ink-500">
            Sie sind frei und empfangen neue Aufträge. 🟢
          </p>
        )}
      </div>

      {/* Angebots-Overlay */}
      {offer && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-4 sm:place-items-center" data-testid="driver-offer">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="eyebrow text-brand-700">Neuer Auftrag</p>
                <h2 className="mt-1 font-display text-2xl font-extrabold">Annehmen oder ablehnen?</h2>
              </div>
              <span
                className="relative grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 font-display text-xl font-extrabold text-ink-900 shadow-glow"
                data-testid="offer-countdown"
              >
                {remaining}s
              </span>
            </div>
            <TripInfo b={offer} showCustomer />
            {offer.distanceToPickup != null && (
              <p className="mt-3 rounded-xl bg-ink-50 px-3 py-2 text-sm font-semibold text-ink-700">
                Entfernung zur Abholung: ca. {formatDistance(offer.distanceToPickup)}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => respond(false)} data-testid="offer-decline" className="btn-danger">Ablehnen</button>
              <button onClick={() => respond(true)} data-testid="offer-accept" className="btn-success">Annehmen</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TripInfo({ b, showCustomer }: { b: any; showCustomer?: boolean }) {
  return (
    <div className="grid gap-1 text-sm">
      {(b.isVip || b.meetGreet === "PREMIUM") && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {b.isVip && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold uppercase text-amber-700">⭐ VIP-Transfer</span>}
          {b.meetGreet === "PREMIUM" && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-extrabold uppercase text-indigo-700">🪧 Namensschild</span>}
        </div>
      )}
      {showCustomer && (
        <div className="flex justify-between">
          <span className="text-ink-500">Kunde</span>
          <span className="font-medium">
            {b.customerName} · <a href={`tel:${b.customerPhone}`} className="text-brand-700">{b.customerPhone}</a>
          </span>
        </div>
      )}
      <div className="flex justify-between gap-3">
        <span className="text-ink-500">Abholung</span>
        <span className="text-right font-medium">{b.pickupAddress}</span>
      </div>
      {((b.stops ?? []) as Array<{ address: string }>).map((s, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="text-ink-500">Stopp {i + 1}</span>
          <span className="text-right font-medium">{s.address}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <span className="text-ink-500">Ziel</span>
        <span className="text-right font-medium">{b.destAddress}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-ink-500">Strecke / Dauer</span>
        <span className="font-medium">{formatDistance(b.distanceMeters)} · {formatDuration(b.durationSeconds)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-ink-500">Preis</span>
        <span className="font-medium">{formatEuro(b.priceMin)} – {formatEuro(b.priceMax)}</span>
      </div>
      {(b.passengers > 1 || b.luggage || b.childSeat) && (
        <div className="flex justify-between">
          <span className="text-ink-500">Hinweise</span>
          <span className="font-medium">
            {b.passengers > 1 ? `${b.passengers} Pers. ` : ""}
            {b.luggage ? "🧳 " : ""}
            {b.childSeat ? "🧒 " : ""}
          </span>
        </div>
      )}
      {b.notes && (
        <div className="flex justify-between gap-3">
          <span className="text-ink-500">Bemerkung</span>
          <span className="text-right font-medium">{b.notes}</span>
        </div>
      )}
    </div>
  );
}
