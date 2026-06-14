import Link from "next/link";
import { AirportBookingForm } from "@/components/AirportBookingForm";
import { Brand } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Flughafen-Transfer – TaxiOS" };

export default function AirportBookingPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand subtitle="Flughafen-Transfer" />
          <Link href="/buchen" data-testid="airport-back" className="text-sm font-bold text-ink-600 hover:text-ink-900">
            ← Einzelfahrt
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <span className="chip bg-brand-500 text-ink-900">✈️ Flughafen</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">Flughafen-Transfer</h1>
        <p className="mt-1.5 text-ink-600">
          Flugnummer angeben – wir behalten Verspätungen im Blick und holen Sie passend zur tatsächlichen
          Landung ab (inkl. Gepäckpuffer).
        </p>
        <div className="card mt-6 p-6">
          <AirportBookingForm />
        </div>
      </section>
    </main>
  );
}
