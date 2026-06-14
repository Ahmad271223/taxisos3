import Link from "next/link";
import { GroupBookingForm } from "@/components/GroupBookingForm";
import { Brand } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gruppen- & Eventfahrt – TaxiOS" };

export default function GroupBookingPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand subtitle="Gruppen- & Eventfahrt" />
          <Link href="/buchen" data-testid="group-back" className="text-sm font-bold text-ink-600 hover:text-ink-900">
            ← Einzelfahrt
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <span className="chip bg-brand-500 text-ink-900">Mehrere Fahrzeuge</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">Gruppe oder Event buchen</h1>
        <p className="mt-1.5 text-ink-600">
          Hochzeit, Firmenfeier, Messe oder Flughafentransfer – wir stellen die passende Flotte zusammen
          und schicken mehrere Taxis zur selben Abholung.
        </p>
        <div className="card mt-6 p-6">
          <GroupBookingForm />
        </div>
      </section>
    </main>
  );
}
