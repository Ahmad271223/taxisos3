// Gilt dieses Konto noch?
//
// Der Anmelde-Ausweis im Browser laeuft erst nach sieben Tagen ab. Eine Sperre
// wirkte deshalb frueher nur auf NEUE Anmeldungen: Wer bereits angemeldet war,
// arbeitete bis zu einer Woche weiter. Bei Einrichtungen betrifft das
// Patientenakten und Krankenfahrten - dort ist das nicht hinnehmbar.
//
// Die Pruefung kostet eine kleine Abfrage je Anfrage. Damit sie nicht bei jedem
// Klick erneut laeuft, merken wir uns das Ergebnis fuer wenige Sekunden. Eine
// Sperre greift damit spaetestens nach dieser Zeitspanne - nicht nach Tagen.

import { prisma } from "@/lib/prisma";

const HALTBARKEIT_MS = 10_000;

const zwischenspeicher = new Map<string, { aktiv: boolean; bis: number }>();

export async function einrichtungAktiv(institutionId: string | null | undefined): Promise<boolean> {
  if (!institutionId) return false;

  const gemerkt = zwischenspeicher.get(institutionId);
  if (gemerkt && gemerkt.bis > Date.now()) return gemerkt.aktiv;

  const inst = await prisma.institution
    .findUnique({ where: { id: institutionId }, select: { active: true } })
    .catch(() => null);

  // Bei einem Datenbankfehler NICHT aussperren: sonst legt eine kurze Stoerung
  // den Betrieb einer Klinik lahm. Der Fehler faellt an anderer Stelle auf.
  if (inst === null) return true;

  const aktiv = inst.active !== false;
  zwischenspeicher.set(institutionId, { aktiv, bis: Date.now() + HALTBARKEIT_MS });
  return aktiv;
}

/** Nach einer Freigabe oder Sperre sofort wirksam werden lassen. */
export function einrichtungVergessen(institutionId: string): void {
  zwischenspeicher.delete(institutionId);
}
