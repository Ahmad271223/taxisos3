// Verletzungen der Eindeutigkeit sauber beantworten.
//
// Das Muster "erst nachsehen, ob die E-Mail frei ist, dann anlegen" ist nicht
// atomar: zwei gleichzeitige Anmeldungen sehen beide "frei" und legen beide an.
// Die Datenbank fängt das zuverlässig ab (unique constraint) — nur kam bisher
// ein ungefangener Prisma-Fehler heraus und damit ein Serverfehler, statt der
// klaren Auskunft "diese E-Mail ist schon vergeben".
//
// Die Vorabprüfung bleibt: sie spart im Normalfall den Fehlerfall und liefert
// die schönere Meldung. Diese Funktion ist das Netz darunter.

/** Prisma-Fehlercode für „unique constraint failed". */
const EINDEUTIG_VERLETZT = "P2002";

export function istEindeutigkeitsfehler(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === EINDEUTIG_VERLETZT;
}

/**
 * Führt `anlegen` aus und übersetzt eine Kollision in einen sprechenden Fehler.
 * Alles andere fliegt unverändert weiter — ein Datenbankausfall darf nicht als
 * „schon vergeben" beim Nutzer ankommen.
 */
export async function anlegenOderKollision<T>(
  anlegen: () => Promise<T>,
): Promise<{ ok: true; wert: T } | { ok: false }> {
  try {
    return { ok: true, wert: await anlegen() };
  } catch (e) {
    if (istEindeutigkeitsfehler(e)) return { ok: false };
    throw e;
  }
}
