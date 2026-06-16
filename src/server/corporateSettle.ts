import { prisma } from "@/lib/prisma";

// Settlement der QR-Firmenmobilität.
//
// Beim Buchen wird der geschätzte Fahrpreis als Hold auf das Firmen-Budget
// gebucht (CorporateCode.usedCents += Schätzung, usedRides += 1) und der Hold
// pro Buchung in Booking.corporateSettledCents festgehalten. Diese Funktionen
// korrigieren den Hold:
//   - settleCorporateComplete: nach Fahrtende auf den tatsächlichen Endpreis.
//   - releaseCorporate: bei Storno den Hold + die Fahrt wieder freigeben.
// Beide sind idempotent (mehrfacher Aufruf ändert nichts mehr).

interface SettleBooking {
  id: string;
  corporateCode: string | null;
  corporateSettledCents: number | null;
}

// Fahrtende: Hold auf den Endpreis (EUR) anpassen. Differenz auf usedCents buchen.
export async function settleCorporateComplete(b: SettleBooking, fareEuro: number): Promise<void> {
  if (!b.corporateCode) return;
  const target = Math.max(0, Math.round((fareEuro || 0) * 100));
  const reserved = b.corporateSettledCents ?? 0;
  const delta = target - reserved;
  if (delta === 0) return;
  await prisma
    .$transaction([
      prisma.corporateCode.update({ where: { code: b.corporateCode }, data: { usedCents: { increment: delta } } }),
      prisma.booking.update({ where: { id: b.id }, data: { corporateSettledCents: target } }),
    ])
    .catch(() => {});
}

// Storno: gebuchten Hold + die Fahrt freigeben. Guard gegen Doppel-Freigabe.
export async function releaseCorporate(b: SettleBooking): Promise<void> {
  if (!b.corporateCode) return;
  const reserved = b.corporateSettledCents ?? 0;
  if (reserved <= 0) return; // bereits freigegeben/abgerechnet
  await prisma
    .$transaction([
      prisma.corporateCode.update({
        where: { code: b.corporateCode },
        data: { usedCents: { decrement: reserved }, usedRides: { decrement: 1 } },
      }),
      prisma.booking.update({ where: { id: b.id }, data: { corporateSettledCents: 0 } }),
    ])
    .catch(() => {});
}
