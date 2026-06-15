import Link from "next/link";
import { BookingForm } from "@/components/BookingForm";
import { Brand } from "@/components/Brand";

export const dynamic = "force-dynamic";

const TILE_BASE = "group flex items-center gap-4 rounded-2xl border border-ink-100 bg-white p-4 transition hover:border-ink-900";

function Tile({ href, testid, title, desc, children }: { href: string; testid: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <Link href={href} data-testid={testid} className={TILE_BASE}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-900">{children}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display font-extrabold tracking-tight text-ink-900">{title}</span>
        <span className="block truncate text-[13px] text-ink-500">{desc}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-300 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export default function PlatformBookingPage({ searchParams }: { searchParams?: { class?: string; driver?: string; to?: string } }) {
  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand subtitle="Taxi bestellen" />
          <Link
            href="/"
            data-testid="booking-back"
            className="text-sm font-bold text-ink-600 hover:text-ink-900"
          >
            ← Zurück
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <span className="chip bg-ink-900 text-brand-500">Sofortfahrt</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">
          Wohin geht&apos;s?
        </h1>
        <p className="mt-1.5 text-ink-600">
          Wir vermitteln den nächsten freien Fahrer per GPS – fair und ohne Firmenauswahl.
        </p>

        <div className="mt-5 grid gap-2.5">
          <Tile href="/buchen/gruppe" testid="to-group-booking" title="Gruppe oder Event" desc="Mehrere Taxis – Hochzeit, Firma, Messe, Flughafen">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
              <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="2"/>
              <circle cx="17" cy="10" r="2.4" stroke="currentColor" strokeWidth="2"/>
              <path d="M3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </Tile>
          <Tile href="/buchen/flughafen" testid="to-airport-booking" title="Flughafen-Transfer" desc="Mit Flugnummer & Verspätungserkennung">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
              <path d="m21 16-9-2-7 4v-2l5-3-2-7h2l4 6 4-1 2 2-3 1 4 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
          </Tile>
          <Tile href="/buchen/krankenfahrt" testid="to-medical-booking" title="Krankenfahrt" desc="Dialyse, Reha, Klinik – einmalig oder regelmäßig">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
              <path d="M12 21s-7-5.2-7-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.8-7 11-7 11h-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </Tile>
          <Tile href="/taxis" testid="to-live-map" title="Live-Karte" desc="Verfügbare Taxis ansehen & gezielt bestellen">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
              <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M9 4v14M15 6v14" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </Tile>
        </div>

        <div className="card mt-6 p-6">
          <BookingForm initialVehicleClass={searchParams?.class} initialDriverId={searchParams?.driver} initialDestination={searchParams?.to} />
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-[13px] text-ink-500">
          <span>Klinik, Pflegeheim oder Dialysezentrum?</span>
          <Link href="/einrichtung" data-testid="to-institution-portal" className="font-bold text-ink-900 underline underline-offset-2 hover:text-brand-600">
            Einrichtungs-Portal
          </Link>
        </div>
      </section>
    </main>
  );
}
