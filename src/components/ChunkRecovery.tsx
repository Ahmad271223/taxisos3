"use client";

import { useEffect } from "react";

// Erholung nach einem Deployment.
//
// Hat jemand die Seite noch offen, während eine neue Version ausgeliefert wird,
// zeigt der Browser beim Nachladen eines Bausteins einen "ChunkLoadError" und
// die Seite bleibt hängen. Statt einer Fehlerseite laden wir die Seite dann
// genau EINMAL neu – danach ist die neue Version aktiv.
//
// Der Merker in sessionStorage verhindert eine Endlosschleife, falls das
// Nachladen aus einem anderen Grund scheitert (z. B. Server nicht erreichbar).

const FLAG = "taxios_chunk_reload";

function isChunkError(message?: string | null): boolean {
  if (!message) return false;
  return (
    message.includes("ChunkLoadError") ||
    message.includes("Loading chunk") ||
    message.includes("Loading CSS chunk") ||
    // Beim MIME-Fehler liefert der Server eine HTML-Fehlerseite statt JS.
    message.includes("is not executable")
  );
}

function recover() {
  try {
    if (sessionStorage.getItem(FLAG)) return; // schon versucht -> nicht erneut
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* privater Modus o. Ä. -> trotzdem einmal neu laden */
  }
  window.location.reload();
}

export function ChunkRecovery() {
  useEffect(() => {
    // Erfolgreicher Seitenaufbau -> Merker zurücksetzen.
    try {
      sessionStorage.removeItem(FLAG);
    } catch {
      /* ignorieren */
    }

    const onError = (e: ErrorEvent) => {
      if (isChunkError(e?.message) || isChunkError((e?.error as Error)?.name)) recover();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: any = e?.reason;
      if (isChunkError(r?.message) || isChunkError(r?.name)) recover();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
