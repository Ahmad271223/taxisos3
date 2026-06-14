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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/bookings/${bookingId}/messages`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => mounted && setMessages(d.messages ?? []))
      .catch(() => {});

    const socket = getSocket();
    const onMsg = (m: Msg) => {
      if (m.bookingId !== bookingId) return;
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
    };
    socket.on("chat:message", onMsg);
    return () => {
      mounted = false;
      socket.off("chat:message", onMsg);
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
    getSocket().emit("chat:send", { bookingId, text: t }, (r: any) => {
      setSending(false);
      if (r?.ok) setText("");
      else setError(r?.error ?? "Senden fehlgeschlagen.");
    });
  }

  return (
    <div className="card p-4" data-testid="chat-panel">
      <h2 className="mb-2 eyebrow text-ink-500">
        {me === "CUSTOMER" ? "Chat mit dem Fahrer" : "Chat mit dem Fahrgast"}
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
