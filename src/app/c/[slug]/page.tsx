import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CompanyHome({ params }: { params: { slug: string } }) {
  const company = await prisma.company.findUnique({ where: { slug: params.slug } });
  if (!company) notFound();

  const tel = (company.phone ?? "").replace(/[^0-9+]/g, "");
  const cityHint = company.address?.split(",").pop()?.trim() || "Hannover";

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-ink-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-hero-yellow" />

      <div className="relative">
        <header className="mx-auto flex max-w-md items-center justify-between px-5 py-4 sm:max-w-3xl">
          <Link href="/" className="flex items-center gap-3" data-testid="company-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="TaxiOS" className="h-14 w-14 shrink-0" />
            <span className="leading-tight">
              <span className="block font-display text-base font-extrabold tracking-tight">{company.name}</span>
              <span className="block text-xs font-semibold text-ink-500">Taxi bestellen</span>
            </span>
          </Link>
          <Link
            href="/fahrer"
            data-testid="customer-driver-login"
            className="rounded-xl px-3 py-2 text-xs font-bold text-ink-600 transition hover:bg-ink-100"
          >
            Fahrer
          </Link>
        </header>

        <section className="mx-auto max-w-md px-5 pb-10 pt-6 sm:max-w-3xl sm:pt-12">
          <span className="chip bg-ink-900 text-brand-500 ring-1 ring-ink-900/10">
            <span className="h-2 w-2 animate-pulseSoft rounded-full bg-brand-500" />
            Live-GPS · {cityHint}
          </span>
          <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Hallo!
          </h1>
          <p className="mt-3 max-w-xl text-lg text-ink-600 sm:text-xl">
            Wohin soll es gehen? Wir finden Ihren nächsten freien Fahrer automatisch per GPS.
          </p>

          <div className="mt-8 grid gap-3">
            <Link
              href={`/c/${company.slug}/buchen`}
              data-testid="cta-jetzt-taxi"
              className="group flex items-center justify-between gap-4 rounded-3xl bg-brand-500 p-5 shadow-glow transition hover:-translate-y-0.5 hover:bg-brand-400"
            >
              <div className="flex items-center gap-4">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-900 text-brand-500">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                    <path
                      d="M3 16v-3a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a1 1 0 0 1-1 1h-1v1a1 1 0 1 1-2 0v-1H8v1a1 1 0 1 1-2 0v-1H4a1 1 0 0 1-1-1Z"
                      fill="currentColor"
                    />
                    <path d="M7 10l1.5-4h7L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-display text-2xl font-extrabold text-ink-900">Jetzt Taxi</p>
                  <p className="text-sm font-semibold text-ink-900/70">Sofort einen freien Fahrer rufen</p>
                </div>
              </div>
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-900 transition group-hover:translate-x-1" fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <Link
              href={`/c/${company.slug}/buchen/vorbestellung`}
              data-testid="cta-spaeter-bestellen"
              className="group flex items-center justify-between gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink-900"
            >
              <div className="flex items-center gap-4">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-ink-900">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                    <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-display text-xl font-extrabold text-ink-900">Später bestellen</p>
                  <p className="text-sm text-ink-500">Termin im Voraus reservieren</p>
                </div>
              </div>
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            {company.phone && (
              <a
                href={`tel:${tel}`}
                data-testid="cta-anrufen"
                className="group flex items-center justify-between gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink-900"
              >
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-ink-900">
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                      <path
                        d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="font-display text-xl font-extrabold text-ink-900">Telefonisch</p>
                    <p className="text-sm text-ink-500">{company.phone}</p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>

          <div className="mt-10 grid grid-cols-3 gap-3 text-center">
            <Feature t="Live-Tracking" d="Sehen Sie Ihren Fahrer in Echtzeit." />
            <Feature t="Transparente Preise" d="Preisspanne vor der Bestellung." />
            <Feature t="Schnelle Buchung" d="In 30 Sekunden bestellt." />
          </div>
        </section>
      </div>
    </main>
  );
}

function Feature({ t, d }: { t: string; d: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/70 p-3 text-left backdrop-blur">
      <p className="font-display text-sm font-bold text-ink-900">{t}</p>
      <p className="mt-0.5 text-xs text-ink-500">{d}</p>
    </div>
  );
}
