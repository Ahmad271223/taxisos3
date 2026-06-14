import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingForm } from "@/components/BookingForm";

export const dynamic = "force-dynamic";

export default async function CompanyVorbestellung({ params }: { params: { slug: string } }) {
  const company = await prisma.company.findUnique({ where: { slug: params.slug } });
  if (!company) notFound();

  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-500 text-ink-900 shadow-glow">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
                <path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-base font-extrabold tracking-tight">{company.name}</p>
              <p className="text-xs font-semibold text-ink-500">Vorbestellung</p>
            </div>
          </div>
          <Link href={`/c/${company.slug}`} className="text-sm font-bold text-ink-600 hover:text-ink-900">← Zurück</Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <span className="chip bg-ink-900 text-brand-500">Vorbestellung</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">
          Taxi später bestellen
        </h1>
        <p className="mt-1.5 text-ink-600">
          Reservieren Sie Ihre Fahrt im Voraus. Ein Fahrer wird rechtzeitig zugewiesen.
        </p>
        <div className="card mt-6 p-6">
          <BookingForm scheduled companySlug={company.slug} />
        </div>
      </section>
    </main>
  );
}
