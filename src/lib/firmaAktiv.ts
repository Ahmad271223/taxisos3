// Darf diese Firma das System noch benutzen?
//
// Die Abo-Sperre saß bisher an genau EINER Stelle: beim Anlegen eines Fahrers.
// Eine gekündigte oder überfällige Firma konnte sich weiterhin als Firmenchef
// anmelden, Dashboards öffnen, Preise ändern, den Krankenfahrten-Pool sehen und
// jede andere Admin-Schnittstelle benutzen. Das ist keine Sicherheitslücke im
// engeren Sinn, aber es hebelt das Geschäftsmodell aus.
//
// Diese Prüfung gehört deshalb zentral in die schreibenden und
// betriebsrelevanten Admin-Routen. LESEN bleibt bewusst erlaubt: Wer kündigt,
// muss weiterhin an seine Rechnungen, Belege und Zahlen kommen (und an die
// Abo-Seite, um wieder zu buchen) — sonst wäre die Kündigung zugleich eine
// Enteignung der eigenen Daten.
//
// Die Antwort wird kurz zwischengespeichert, damit nicht jede Anfrage eine
// zusätzliche Abfrage auslöst; eine Änderung greift damit binnen Sekunden.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const HALTBARKEIT_MS = 10_000;
const GESPERRT = new Set(["GEKUENDIGT", "UEBERFAELLIG"]);

const zwischenspeicher = new Map<string, { status: string; bis: number }>();

async function statusVon(companyId: string): Promise<string> {
  const gemerkt = zwischenspeicher.get(companyId);
  if (gemerkt && gemerkt.bis > Date.now()) return gemerkt.status;

  const c = await prisma.company
    .findUnique({ where: { id: companyId }, select: { subscriptionStatus: true } })
    .catch(() => null);
  // Bei einer Störung NICHT aussperren: eine kurze Datenbankschwäche darf
  // keinen Taxibetrieb anhalten.
  if (c === null) return "AKTIV";

  const status = c.subscriptionStatus ?? "AKTIV";
  zwischenspeicher.set(companyId, { status, bis: Date.now() + HALTBARKEIT_MS });
  return status;
}

/**
 * Liefert eine fertige Absage, wenn das Abo der Firma nicht mehr trägt –
 * sonst null.
 */
export async function aboGesperrt(companyId: string): Promise<NextResponse | null> {
  const status = await statusVon(companyId);
  if (!GESPERRT.has(status)) return null;
  return NextResponse.json(
    {
      error:
        status === "UEBERFAELLIG"
          ? "Die letzte Abo-Zahlung ist fehlgeschlagen. Bitte aktualisieren Sie Ihr Zahlungsmittel, um weiterzuarbeiten."
          : "Ihr Abo ist gekündigt. Bitte buchen Sie einen Tarif, um weiterzuarbeiten.",
      code: "SUBSCRIPTION_INACTIVE",
      subscriptionStatus: status,
    },
    { status: 402 },
  );
}

/** Nach einer Abo-Änderung sofort wirksam werden lassen. */
export function firmaVergessen(companyId: string): void {
  zwischenspeicher.delete(companyId);
}
