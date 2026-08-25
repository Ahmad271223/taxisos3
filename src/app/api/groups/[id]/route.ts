import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { groupDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

/**
 * Status einer Gruppen-/Eventbuchung.
 *
 * SICHERHEIT: Die Gruppen-ID steht in der geteilten Adresse `/gruppe/<id>` und
 * hat keinen eigenen Token. Frueher lieferte diese Route damit ohne jede
 * Anmeldung Name und Telefonnummer des Bestellers sowie saemtliche Kontaktdaten
 * aller Einzelfahrten heraus.
 *
 * Jetzt gilt: Wer die Adresse hat, sieht den Fahrtstatus – dafuer ist der Link
 * da. Kontaktdaten bekommt nur, wer sie ohnehin kennen darf: der Besteller
 * selbst oder das ausfuehrende Unternehmen.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const group = await prisma.bookingGroup.findUnique({ where: { id: params.id } });
  if (!group) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const bookings = await prisma.booking.findMany({
    where: { groupId: group.id },
    include: { driver: true },
    orderBy: { createdAt: "asc" },
  });

  const kunde = getSession("customer");
  const admin = getSession("admin");
  const istBesteller = !!kunde && !!group.customerId && kunde.sub === group.customerId;
  const istUnternehmen = !!admin?.companyId && bookings.some((b) => b.companyId === admin.companyId);

  const dto: any = groupDTO(group, bookings);
  if (istBesteller || istUnternehmen) return NextResponse.json({ group: dto });

  // Reduzierte Sicht: Ablauf ja, Kontaktdaten nein. Der Fahrer bleibt
  // sichtbar – der Gast muss sein Taxi erkennen koennen.
  return NextResponse.json({
    group: {
      ...dto,
      customerPhone: null,
      notes: null,
      bookings: (dto.bookings ?? []).map((b: any) => ({ ...b, customerPhone: null, notes: null })),
    },
  });
}
