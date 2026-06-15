import Link from "next/link";

export const dynamic = "force-dynamic";

// App-Router 404. Verhindert zugleich, dass next build die Pages-Router-
// Default-404 statisch generiert (die den <Html>-Importfehler auslöst).
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 text-center">
      <div>
        <p className="font-display text-7xl font-extrabold text-brand-500">404</p>
        <h1 className="mt-2 font-display text-xl font-extrabold text-ink-900">Seite nicht gefunden</h1>
        <p className="mt-1 text-ink-500">Diese Seite existiert nicht (mehr).</p>
        <Link href="/" className="mt-6 inline-block rounded-2xl bg-brand-500 px-5 py-3 font-extrabold text-ink-900 transition hover:bg-brand-400">
          Zur Startseite
        </Link>
      </div>
    </main>
  );
}
