"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Schlanker Cookie-Hinweis. Wir setzen nur technisch notwendige Cookies
// (Login-Session) -> Informationshinweis, kein Consent-Management nötig.
export function CookieNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem("taxios_cookie_ok")) setShow(true);
    } catch {
      /* localStorage evtl. blockiert */
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem("taxios_cookie_ok", "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-ink-200 bg-white/95 px-4 py-3 shadow-float backdrop-blur"
      data-testid="cookie-notice"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 text-sm text-ink-700 sm:flex-row">
        <p>
          Wir verwenden nur technisch notwendige Cookies (Login-Session). Mehr in der{" "}
          <Link href="/datenschutz" className="font-bold text-ink-900 underline">
            Datenschutzerklärung
          </Link>
          .
        </p>
        <button onClick={dismiss} data-testid="cookie-ok" className="btn-primary shrink-0">
          Verstanden
        </button>
      </div>
    </div>
  );
}
