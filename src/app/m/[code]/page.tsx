import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Brand } from "@/components/Brand";
import { normalizeCorporateCode, corporateAvailable, corporateRemaining, corporateReasonText } from "@/lib/corporate";

export const dynamic = "force-dynamic";

function euro(cents: number) {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// Öffentliche QR-Landingpage: Ziel des Firmen-QR-Codes. Erklärt dem Gast, dass
// die Fahrt vom Firmenkonto übernommen wird, und führt in die Buchung.
export default async function MobilityLanding({ params }: { params: { code: string } }) {
  const code = normalizeCorporateCode(params.code ?? "");
  const cc = code
    ? await prisma.corporateCode.findUnique({ where: { code }, include: { eventHost: { select: { name: true } } } })
    : null;
  const avail = cc ? corporateAvailable(cc) : { ok: false as const, reason: undefined };
  const remaining = cc ? corporateRemaining(cc) : { remainingCents: null, remainingRides: null };

  return (
    <main className="grid min-h-screen place-items-center bg-ink-50 px-5">
      <div className="card w-full max-w-md p-6 text-center">
        <Brand subtitle="Firmenmobilität" />
        {!cc ? (
          <div className="mt-6">
            <p className="text-lg font-extrabold text-ink-900">Code nicht gefunden</p>
            <p className="mt-1 text-sm text-ink-500">Dieser QR-Code ist ungültig oder wurde zurückgezogen.</p>
          </div>
        ) : !avail.ok ? (
          <div className="mt-6">
            <p className="text-lg font-extrabold text-ink-900">{cc.eventHost.name}</p>
            <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{corporateReasonText(avail.reason)}</p>
          </div>
        ) : (
          <div className="mt-6">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-2xl">🚕</div>
            <p className="mt-3 text-sm text-ink-500">Ihre Fahrt wird übernommen von</p>
            <p className="text-xl font-extrabold text-ink-900">{cc.eventHost.name}</p>
            {cc.label && <p className="text-sm font-semibold text-brand-700">{cc.label}</p>}

            <div className="mt-4 grid gap-1 rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">
              <p className="font-bold text-ink-900">So funktioniert&apos;s</p>
              <p>Adresse eingeben, Taxi kommt – Sie zahlen nichts. Die Kosten trägt das Firmenkonto.</p>
              {(remaining.remainingRides != null || cc.perRideCents != null) && (
                <p className="mt-1 text-xs text-ink-500">
                  {remaining.remainingRides != null && <>Noch {remaining.remainingRides} Fahrt(en) verfügbar. </>}
                  {cc.perRideCents != null && <>Bis {euro(cc.perRideCents)} pro Fahrt gedeckt.</>}
                </p>
              )}
            </div>

            <Link href={`/buchen?corp=${cc.code}`} data-testid="corp-book" className="btn-primary mt-5 inline-block w-full">
              Jetzt kostenlose Fahrt buchen
            </Link>
            <p className="mt-2 text-xs text-ink-400">Code {cc.code}</p>
          </div>
        )}
      </div>
    </main>
  );
}
