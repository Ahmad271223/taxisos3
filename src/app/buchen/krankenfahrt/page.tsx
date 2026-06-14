import Link from "next/link";
import { MedicalBookingForm } from "@/components/MedicalBookingForm";
import { Brand } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Krankenfahrt – TaxiOS" };

export default function MedicalBookingPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand subtitle="Krankenfahrt" />
          <Link href="/buchen" data-testid="medical-back" className="text-sm font-bold text-ink-600 hover:text-ink-900">
            ← Einzelfahrt
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <span className="chip bg-brand-500 text-ink-900">🏥 Krankenfahrt</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">Krankenfahrt buchen</h1>
        <p className="mt-1.5 text-ink-600">
          Dialyse, Reha, Krankenhaus oder Arzt – einmalig oder als regelmäßige Serie (z. B. Mo/Mi/Fr),
          auf Wunsch im barrierefreien Rollstuhltaxi.
        </p>
        <div className="card mt-6 p-6">
          <MedicalBookingForm />
        </div>
      </section>
    </main>
  );
}
