"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Item {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  primary?: boolean;
}

const I = {
  car: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M3 16v-3a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a1 1 0 0 1-1 1h-1v1a1 1 0 1 1-2 0v-1H8v1a1 1 0 1 1-2 0v-1H4a1 1 0 0 1-1-1Z" fill="currentColor" />
      <path d="M7 10l1.5-4h7L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17M12 13v3l2 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="2" />
      <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  building: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  login: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 8l4 4-4 4M14 12H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  wheel: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 9.5V4M9.8 13.6l-4 3.4M14.2 13.6l4 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  hotel: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M3 21h18M6 21V4h9v17M15 21V9h3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 8h3M9 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  ticket: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 6v12" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2.5" />
    </svg>
  ),
  hospital: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v6M9 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

const CUSTOMER: Item[] = [
  { href: "/buchen", label: "Jetzt bestellen", desc: "Sofort einen freien Fahrer rufen", icon: I.car, primary: true },
  { href: "/buchen/vorbestellung", label: "Vorbestellung", desc: "Termin im Voraus reservieren", icon: I.clock },
  { href: "/konto", label: "Mein Konto", desc: "Fahrten, Favoriten & Profil", icon: I.user },
];

const PARTNER: Item[] = [
  { href: "/registrieren", label: "Firma registrieren", desc: "Taxiunternehmen anmelden", icon: I.building },
  { href: "/admin/login", label: "Firmen-Login", desc: "Disposition & Verwaltung", icon: I.login },
  { href: "/fahrer/login", label: "Fahrer-Login", desc: "Aufträge annehmen & fahren", icon: I.wheel },
];

// B2B-Portale: eigene Konten zum Registrieren & Anmelden (jeweils mit Login/Register).
const B2B: Item[] = [
  { href: "/hotel", label: "Hotel-Portal", desc: "Gästefahrten buchen & abrechnen", icon: I.hotel },
  { href: "/event", label: "Event & Messe", desc: "Promo-Codes, Sammelpunkte, Firmen-QR", icon: I.ticket },
  { href: "/einrichtung", label: "Krankeneinrichtung", desc: "Patientenfahrten & Abrechnung", icon: I.hospital },
];

function Row({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`group flex items-center gap-3.5 rounded-2xl border p-3 transition hover:-translate-y-0.5 ${
        item.primary
          ? "border-transparent bg-brand-500 shadow-glow hover:bg-brand-400"
          : "border-ink-100 bg-white hover:border-ink-900"
      }`}
    >
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
          item.primary ? "bg-ink-900 text-brand-500" : "bg-ink-100 text-ink-900"
        }`}
      >
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display font-extrabold text-ink-900">{item.label}</span>
        <span className="block text-xs text-ink-500">{item.desc}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-400 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid="menu-open"
        aria-label="Menü öffnen"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 font-semibold text-ink-900 shadow-soft transition hover:border-ink-900 hover:shadow-float"
      >
        <span className="grid gap-[5px]">
          <span className="block h-[2.5px] w-5 rounded-full bg-ink-900" />
          <span className="block h-[2.5px] w-5 rounded-full bg-ink-900" />
          <span className="block h-[2.5px] w-5 rounded-full bg-ink-900" />
        </span>
        <span className="hidden text-sm sm:inline">Menü</span>
      </button>

      {/* Backdrop */}
      <div
        onClick={close}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Slide-over Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        data-testid="site-menu"
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(88vw,380px)] flex-col bg-white shadow-float transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <span className="font-display text-lg font-extrabold text-ink-900">Navigation</span>
          <button
            onClick={close}
            data-testid="menu-close"
            aria-label="Menü schließen"
            className="grid h-9 w-9 place-items-center rounded-xl text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <p className="eyebrow mb-2.5 text-ink-400">Fahrgäste</p>
          <div className="grid gap-2.5">
            {CUSTOMER.map((it) => (
              <Row key={it.href} item={it} onClick={close} />
            ))}
          </div>

          <p className="eyebrow mb-2.5 mt-7 text-ink-400">Taxiunternehmen & Fahrer</p>
          <div className="grid gap-2.5">
            {PARTNER.map((it) => (
              <Row key={it.href} item={it} onClick={close} />
            ))}
          </div>

          <p className="eyebrow mb-2.5 mt-7 text-ink-400">Geschäftskunden-Portale</p>
          <div className="grid gap-2.5">
            {B2B.map((it) => (
              <Row key={it.href} item={it} onClick={close} />
            ))}
          </div>
        </div>

        <div className="border-t border-ink-100 px-5 py-4 text-center text-xs text-ink-400">
          GPS-Auto-Dispatch · firmenübergreifend
        </div>
      </aside>
    </>
  );
}
