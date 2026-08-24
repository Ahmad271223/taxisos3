"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { formatTime } from "@/lib/format";

interface Msg {
  id: string;
  bookingId: string;
  sender: "CUSTOMER" | "DRIVER";
  text: string;
  createdAt: string | null;
}

// Live-Chat Kunde <-> Fahrer (Phase 3i). Wird sowohl im Kunden-Tracking als
// auch im Fahrer-Portal genutzt; `me` bestimmt die Ausrichtung der Blasen.
export function ChatPanel({ bookingId, me }: { bookingId: string; me: "CUSTOMER" | "DRIVER" }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    // Verlauf laden bzw. nachladen. Wird auch nach jedem Reconnect und beim
    // Zurueckkehren aus dem Hintergrund aufgerufen: waehrend einer getrennten
    // Verbindung gesendete Nachrichten wuerden sonst dauerhaft fehlen, weil
    // Socket-Events nur an Clients gehen, die im Raum sind.
    const load = () =>
      fetch(`/api/bookings/${bookingId}/messages`)
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((d) => {
          if (!mounted) return;
          const fresh: Msg[] = d.messages ?? [];
          // Serverstand mit evtl. schon lokal eingetroffenen Nachrichten mischen.
          setMessages((cur) => {
            const byId = new Map(fresh.map((m) => [m.id, m]));
            for (const m of cur) if (!byId.has(m.id)) byId.set(m.id, m);
            return Array.from(byId.values()).sort(
              (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
            );
          });
        })
        .catch(() => {});

    load();

    const socket = getSocket();
    const onMsg = (m: Msg) => {
      if (m.bookingId !== bookingId) return;
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
    };
    const onConnect = () => {
      setOffline(false);
      load(); // verpasste Nachrichten nachholen
    };
    const onDisconnect = () => setOffline(true);
    // Handy entsperrt / Tab wieder im Vordergrund -> Stand auffrischen.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    socket.on("chat:message", onMsg);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      socket.off("chat:message", onMsg);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bookingId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    setError(null);
    // Ohne Timeout bleibt der Button bei getrennter Verbindung dauerhaft
    // deaktiviert, weil die Bestaetigung (ACK) nie eintrifft.
    let answered = false;
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      setSending(false);
      setError("Keine Verbindung – Nachricht nicht gesendet. Bitte erneut versuchen.");
    }, 8000);

    getSocket().emit("chat:send", { bookingId, text: t }, (r: any) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      setSending(false);
      if (r?.ok) setText("");
      else setError(r?.error ?? "Senden fehlgeschlagen.");
    });
  }

  return (
    <div className="card p-4" data-testid="chat-panel">
      <h2 className="mb-2 flex items-center justify-between eyebrow text-ink-500">
        <span>{me === "CUSTOMER" ? "Chat mit dem Fahrer" : "Chat mit dem Fahrgast"}</span>
        {offline && (
          <span data-testid="chat-offline" className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
            Offline – Verbindung wird wiederhergestellt
          </span>
        )}
      </h2>
      <div ref={listRef} data-testid="chat-messages" className="mb-3 flex max-h-56 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-400">Noch keine Nachrichten.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender === me;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? "bg-brand-500 text-ink-900" : "bg-ink-100 text-ink-900"
                  }`}
                >
                  {m.text}
                </div>
                <span className="mt-0.5 text-[10px] text-ink-400">{formatTime(m.createdAt)}</span>
              </div>
            );
          })
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          data-testid="chat-input"
          className="field"
          placeholder="Nachricht …"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          data-testid="chat-send"
          className="btn-primary disabled:opacity-60"
        >
          Senden
        </button>
      </div>
      {error && <p data-testid="chat-error" className="mt-1 text-xs font-bold text-red-600">{error}</p>}
    </div>
  );
}
