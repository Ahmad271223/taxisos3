import Link from "next/link";
import { BookingForm } from "@/components/BookingForm";
import { Brand } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default function PlatformPreorderPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand subtitle="Taxi vorbestellen" />
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
        <span className="chip bg-ink-900 text-brand-500">Vorbestellung</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">
          Fahrt für später buchen
        </h1>
        <p className="mt-1.5 text-ink-600">
          Termin im Voraus reservieren. Wir disponieren rechtzeitig den nächsten freien Fahrer.
        </p>
        <div className="card mt-6 p-6">
          <BookingForm scheduled />
        </div>
      </section>
    </main>
  );
}
