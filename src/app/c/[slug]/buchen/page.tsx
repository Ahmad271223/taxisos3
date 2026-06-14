import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingForm } from "@/components/BookingForm";

export const dynamic = "force-dynamic";

export default async function CompanyBuchen({ params }: { params: { slug: string } }) {
  const company = await prisma.company.findUnique({ where: { slug: params.slug } });
  if (!company) notFound();

  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="TaxiOS" className="h-12 w-12 shrink-0" />
            <div>
              <p className="font-display text-base font-extrabold tracking-tight">{company.name}</p>
              <p className="text-xs font-semibold text-ink-500">Taxi jetzt bestellen</p>
            </div>
          </div>
          <Link href={`/c/${company.slug}`} data-testid="back-link" className="text-sm font-bold text-ink-600 hover:text-ink-900">← Zurück</Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <span className="chip bg-brand-500 text-ink-900">Sofort</span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink-900">
          Fahrt planen
        </h1>
        <p className="mt-1.5 text-ink-600">Wir finden den nächsten freien Fahrer per GPS.</p>
        <div className="card mt-6 p-6">
          <BookingForm companySlug={company.slug} />
        </div>
      </section>
    </main>
  );
}
