import Link from "next/link";
import { BookingForm } from "@/components/BookingForm";
import { Brand } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default function PlatformBookingPage({ searchParams }: { searchParams?: { class?: string; driver?: string } }) {
  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand subtitle="Taxi jetzt bestellen" />
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
        <span className="chip bg-brand-500 text-ink-900">Sofort</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">
          Fahrt planen
        </h1>
        <p className="mt-1.5 text-ink-600">
          Wir finden den nächsten freien Fahrer per GPS – fair und ohne Firmen­auswahl.
        </p>
        <Link
          href="/buchen/gruppe"
          data-testid="to-group-booking"
          className="mt-5 flex items-center justify-between gap-3 rounded-2xl border-2 border-ink-200 bg-white p-4 transition hover:border-brand-500"
        >
          <span>
            <span className="font-display font-extrabold text-ink-900">👥 Gruppe oder Event?</span>
            <span className="block text-sm text-ink-600">Mehrere Taxis auf einmal – Hochzeit, Firma, Messe, Flughafen.</span>
          </span>
          <span className="shrink-0 text-xl text-ink-400">→</span>
        </Link>

        <Link
          href="/buchen/flughafen"
          data-testid="to-airport-booking"
          className="mt-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-ink-200 bg-white p-4 transition hover:border-brand-500"
        >
          <span>
            <span className="font-display font-extrabold text-ink-900">✈️ Flughafen-Transfer?</span>
            <span className="block text-sm text-ink-600">Mit Flugnummer & Verspätungserkennung – pünktlich zur Landung.</span>
          </span>
          <span className="shrink-0 text-xl text-ink-400">→</span>
        </Link>

        <Link
          href="/buchen/krankenfahrt"
          data-testid="to-medical-booking"
          className="mt-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-ink-200 bg-white p-4 transition hover:border-brand-500"
        >
          <span>
            <span className="font-display font-extrabold text-ink-900">🏥 Krankenfahrt?</span>
            <span className="block text-sm text-ink-600">Dialyse, Reha, Klinik – einmalig oder regelmäßig, auch im Rollstuhltaxi.</span>
          </span>
          <span className="shrink-0 text-xl text-ink-400">→</span>
        </Link>

        <Link
          href="/taxis"
          data-testid="to-live-map"
          className="mt-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-ink-200 bg-white p-4 transition hover:border-brand-500"
        >
          <span>
            <span className="font-display font-extrabold text-ink-900">🗺️ Taxis live sehen</span>
            <span className="block text-sm text-ink-600">Verfügbare Taxis auf der Karte – Fahrzeug ansehen & gezielt bestellen.</span>
          </span>
          <span className="shrink-0 text-xl text-ink-400">→</span>
        </Link>

        <div className="card mt-6 p-6">
          <BookingForm initialVehicleClass={searchParams?.class} initialDriverId={searchParams?.driver} />
        </div>
      </section>
    </main>
  );
}
