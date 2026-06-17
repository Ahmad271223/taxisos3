import Link from "next/link";
import Image from "next/image";
import { Brand } from "@/components/Brand";
import { SiteMenu } from "@/components/SiteMenu";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1630717285906-29364ffacea0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjB5ZWxsb3clMjB0YXhpJTIwY2l0eSUyMHN0cmVldHxlbnwwfHx8fDE3ODEyNzE4NDd8MA&ixlib=rb-4.1.0&q=85";

const PLATFORM_PHONE = (process.env.NEXT_PUBLIC_PLATFORM_PHONE ?? "").trim();

const STEPS = [
  { n: "01", t: "Adresse eingeben", d: "Abhol- und Zieladresse oder GPS verwenden." },
  { n: "02", t: "Preis sehen", d: "Sie sehen sofort eine transparente Preisspanne." },
  { n: "03", t: "Fahrer wird gesucht", d: "Das System schickt die Anfrage an alle freien Fahrer im Umkreis – fair, firmen­übergreifend." },
  { n: "04", t: "Live-Tracking", d: "Sie sehen Ihren Fahrer in Echtzeit auf der Karte." },
];

export default function PlatformLanding() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-ink-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-hero-yellow" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] opacity-[0.25] [background-image:var(--tw-gradient-from,linear-gradient(rgba(17,24,39,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(17,24,39,.04)_1px,transparent_1px))] bg-[size:40px_40px]" />

      <div className="relative">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Brand subtitle="Schnell ein Taxi bestellen" />
          <SiteMenu />
        </header>

        {/* Hero */}
        <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-10 lg:grid-cols-[1.1fr,1fr] lg:items-center lg:pt-20">
          <div>
            <span className="chip bg-ink-900 text-brand-500 ring-1 ring-ink-900/10">
              <span className="h-2 w-2 animate-pulseSoft rounded-full bg-brand-500" />
              GPS-Auto-Dispatch · Firmen­übergreifend
            </span>
            <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Wo soll&apos;s
              <span className="relative ml-2 inline-block bg-brand-500 px-2 pb-1 leading-[1.05] text-ink-900">
                hingehen?
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-600">
              Bestellen Sie direkt – ohne App, ohne Firma auszuwählen. Wir schicken Ihre Anfrage
              an alle freien Fahrer im Umkreis. Wer zuerst annimmt, bringt Sie ans Ziel.
            </p>

            {/* Kunden-CTAs: Jetzt bestellen / Später bestellen / Anrufen */}
            <div className="mt-8 grid gap-3">
              <Link
                href="/taxis"
                data-testid="cta-live-karte"
                className="group flex items-center justify-between gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink-900"
              >
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-2xl">🗺️</span>
                  <div>
                    <p className="font-display text-xl font-extrabold text-ink-900">Taxis live auf der Karte</p>
                    <p className="text-sm text-ink-500">Freie Fahrzeuge ansehen &amp; gezielt bestellen</p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              <Link
                href="/buchen"
                data-testid="cta-jetzt-bestellen"
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
                    <p className="font-display text-2xl font-extrabold text-ink-900">Jetzt bestellen</p>
                    <p className="text-sm font-semibold text-ink-900/70">Sofort einen freien Fahrer rufen</p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-900 transition group-hover:translate-x-1" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              <Link
                href="/buchen/vorbestellung"
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

              <Link
                href="/buchen/gruppe"
                data-testid="cta-gruppe"
                className="group flex items-center justify-between gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink-900"
              >
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-2xl">👥</span>
                  <div>
                    <p className="font-display text-xl font-extrabold text-ink-900">Gruppe &amp; Event</p>
                    <p className="text-sm text-ink-500">Mehrere Taxis – Hochzeit, Firma, Messe, Flughafen</p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              <Link
                href="/buchen/flughafen"
                data-testid="cta-flughafen"
                className="group flex items-center justify-between gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink-900"
              >
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-2xl">✈️</span>
                  <div>
                    <p className="font-display text-xl font-extrabold text-ink-900">Flughafen-Transfer</p>
                    <p className="text-sm text-ink-500">Mit Flugnummer &amp; Verspätungserkennung</p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              <Link
                href="/buchen/krankenfahrt"
                data-testid="cta-krankenfahrt"
                className="group flex items-center justify-between gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink-900"
              >
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-2xl">🏥</span>
                  <div>
                    <p className="font-display text-xl font-extrabold text-ink-900">Krankenfahrt</p>
                    <p className="text-sm text-ink-500">Dialyse, Reha, Klinik – einmalig oder regelmäßig</p>
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>

              {PLATFORM_PHONE && (
                <a
                  href={`tel:${PLATFORM_PHONE.replace(/[^0-9+]/g, "")}`}
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
                      <p className="font-display text-xl font-extrabold text-ink-900">Anrufen</p>
                      <p className="text-sm text-ink-500">{PLATFORM_PHONE}</p>
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500 transition group-hover:translate-x-1 group-hover:text-ink-900" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-500">
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Radius-Dispatch (500 m → 5 km)</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Live-GPS</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Ohne App</span>
            </div>
          </div>

          {/* Hero visual */}
          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[36px] bg-brand-500/20 blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-ink-900/5 bg-white shadow-float">
              <Image
                src={HERO_IMAGE}
                alt="Gelbes Taxi in der Stadt"
                width={900}
                height={1100}
                priority
                unoptimized
                className="h-[420px] w-full object-cover sm:h-[520px]"
              />
              <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 rounded-2xl bg-white/95 p-3 shadow-soft backdrop-blur">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500 text-ink-900">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                    <path d="M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13Z" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <div className="flex-1 text-sm leading-tight">
                  <p className="font-bold text-ink-900">Fahrer in 4 Min.</p>
                  <p className="text-ink-500">Murat ist unterwegs – Hauptbahnhof</p>
                </div>
                <span className="chip bg-green-50 text-green-700">Live</span>
              </div>
            </div>
            <div className="absolute -left-5 top-8 rotate-[-6deg] rounded-2xl bg-ink-900 px-3 py-1.5 text-xs font-bold text-brand-500 shadow-soft">
              Radius-Dispatch
            </div>
          </div>
        </section>

        {/* So funktioniert die Buchung */}
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="rounded-[32px] bg-ink-900 p-8 text-white sm:p-12">
            <p className="eyebrow text-brand-500">So funktioniert eine Fahrt</p>
            <h2 className="mt-2 max-w-2xl font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              In 4 Schritten zum Taxi.
            </h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-brand-500/60"
                >
                  <span className="font-display text-2xl font-extrabold text-brand-500">{s.n}</span>
                  <p className="mt-2 font-bold">{s.t}</p>
                  <p className="mt-1 text-sm text-ink-300">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Für Taxiunternehmen */}
        <section className="mx-auto max-w-6xl px-5 pb-20">
          <div className="grid items-center gap-6 rounded-[28px] bg-brand-500 p-8 sm:grid-cols-[1.5fr,1fr] sm:p-12">
            <div>
              <p className="eyebrow text-ink-900/70">Für Taxiunternehmen</p>
              <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-4xl">
                Mehr Aufträge ohne extra App.
              </h2>
              <p className="mt-2 text-ink-900/80">
                Registrieren Sie Ihr Unternehmen, legen Sie Fahrer an – das System verteilt
                Aufträge fair und firmen­übergreifend an alle freien Fahrer in der Nähe.
              </p>
            </div>
            <div className="flex justify-end">
              <Link href="/registrieren" data-testid="cta-cta-bottom" className="btn-dark text-base">
                Firma registrieren
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-ink-100">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-ink-500 sm:flex-row">
            <Brand subtitle="Schnell ein Taxi bestellen" />
            <div className="flex items-center gap-5">
              <Link href="/buchen" className="hover:text-ink-900">Jetzt bestellen</Link>
              <Link href="/konto" className="hover:text-ink-900">Mein Konto</Link>
              <Link href="/buchen/vorbestellung" className="hover:text-ink-900">Vorbestellung</Link>
              <Link href="/registrieren" className="hover:text-ink-900">Firma registrieren</Link>
              <Link href="/admin/login" className="hover:text-ink-900">Firmen-Login</Link>
              <Link href="/fahrer/login" className="hover:text-ink-900">Fahrer-Login</Link>
            </div>
          </div>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-4 border-t border-ink-100 px-5 py-4 text-xs text-ink-400 sm:justify-end">
            <Link href="/impressum" className="hover:text-ink-900">Impressum</Link>
            <Link href="/datenschutz" className="hover:text-ink-900">Datenschutz</Link>
            <Link href="/agb" className="hover:text-ink-900">AGB</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
