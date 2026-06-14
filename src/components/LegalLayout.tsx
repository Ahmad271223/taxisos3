import Link from "next/link";
import { Brand } from "@/components/Brand";

// Gemeinsames Layout für die Rechtsseiten (Impressum/Datenschutz/AGB).
export function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Brand href="/" subtitle={title} />
          <Link href="/" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Startseite</Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="font-display text-2xl font-extrabold text-ink-900">{title}</h1>
        <p className="mt-2 rounded-xl bg-brand-50 px-4 py-3 text-xs font-semibold text-ink-700">
          Hinweis: Diese Seite ist eine Vorlage mit Platzhaltern [in eckigen Klammern]. Vor dem
          Live-Gang von einer Rechtsberatung / einem Anwalt prüfen und vervollständigen lassen.
        </p>
        <div className="mt-4">{children}</div>
      </article>
    </main>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-6 font-display text-lg font-bold text-ink-900">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-ink-700">{children}</p>;
}
