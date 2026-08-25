// Umsetzung des Loeschkonzepts (memory/DSGVO/Loeschkonzept.md).
//
// Ein Loeschkonzept auf Papier ist wertlos, wenn niemand loescht. Dieser Lauf
// entfernt taeglich, was seinen Zweck erfuellt hat, und PROTOKOLLIERT dabei,
// was er entfernt hat – ohne dieses Protokoll liesse sich gegenueber einer
// Aufsichtsbehoerde nicht belegen, dass das Konzept auch angewendet wird.
//
// Bewusste Zurueckhaltung an zwei Stellen:
//
//   1. Fahrten werden standardmaessig NICHT geloescht. Fahrten haengen an
//      Rechnungen, Belegen und der steuerlichen Aufbewahrung (§ 147 AO), und
//      am Datensatz haengen Kaskaden. Wer sich hier vertut, vernichtet
//      Buchhaltung. Einschaltbar ueber RETENTION_FAHRTEN=1.
//   2. Fahrgastkonten werden standardmaessig NICHT anonymisiert. Auch das ist
//      unumkehrbar. Einschaltbar ueber RETENTION_KONTEN=1.
//
// Beides meldet im Trockenlauf trotzdem, WIE VIELE Datensaetze betroffen
// waeren – so ist die Entscheidung eine bewusste und keine versehentliche.

import { prisma } from "../lib/prisma";

const TAG = 24 * 60 * 60_000;

const FRIST = {
  verifikation: Number(process.env.RETENTION_VERIFIKATION_STUNDEN ?? 24),
  sms: Number(process.env.RETENTION_SMS_TAGE ?? 90),
  zugriff: Number(process.env.RETENTION_ZUGRIFF_TAGE ?? 365),
  storno: Number(process.env.RETENTION_STORNO_TAGE ?? 365),
  notruf: Number(process.env.RETENTION_NOTRUF_TAGE ?? 365),
  chat: Number(process.env.RETENTION_CHAT_TAGE ?? 365),
  dokument: Number(process.env.RETENTION_DOKUMENT_TAGE ?? 365),
  fahrtOhneBeleg: Number(process.env.RETENTION_FAHRT_TAGE ?? 365),
  kontoOhneFahrt: Number(process.env.RETENTION_KONTO_TAGE ?? 730),
};

const FAHRTEN_AKTIV = process.env.RETENTION_FAHRTEN === "1";
const KONTEN_AKTIV = process.env.RETENTION_KONTEN === "1";

export interface Bericht {
  trocken: boolean;
  posten: Record<string, number>;
  hinweise: string[];
}

function vorTagen(tage: number): Date {
  return new Date(Date.now() - tage * TAG);
}

/**
 * Einen Loeschlauf durchfuehren.
 *
 * @param trocken true = nur zaehlen, nichts aendern.
 */
export async function retentionLauf(trocken = false): Promise<Bericht> {
  const posten: Record<string, number> = {};
  const hinweise: string[] = [];

  // Kleiner Helfer: im Trockenlauf zaehlen, sonst loeschen.
  const weg = async (
    name: string,
    zaehlen: () => Promise<number>,
    loeschen: () => Promise<{ count: number }>,
  ) => {
    try {
      posten[name] = trocken ? await zaehlen() : (await loeschen()).count;
    } catch (e: any) {
      hinweise.push(`${name}: ${e?.message ?? e}`);
      posten[name] = -1;
    }
  };

  // --- Bestaetigungscodes: Zweck endet mit der Bestaetigung ----------------
  {
    const bis = new Date(Date.now() - FRIST.verifikation * 60 * 60_000);
    const wo = { createdAt: { lt: bis } };
    await weg(
      "Bestaetigungscodes",
      () => prisma.verification.count({ where: wo }),
      () => prisma.verification.deleteMany({ where: wo }),
    );
  }

  // --- SMS-Protokoll: enthaelt den vollen Nachrichtentext mit Adressen -----
  {
    const wo = { createdAt: { lt: vorTagen(FRIST.sms) } };
    await weg(
      "SMS-Protokoll",
      () => prisma.smsLog.count({ where: wo }),
      () => prisma.smsLog.deleteMany({ where: wo }),
    );
  }

  // --- Zugriffsprotokoll auf Gesundheitsdaten ------------------------------
  {
    const wo = { at: { lt: vorTagen(FRIST.zugriff) } };
    await weg(
      "Zugriffsprotokoll",
      () => prisma.accessLog.count({ where: wo }),
      () => prisma.accessLog.deleteMany({ where: wo }),
    );
  }

  // --- Stornoprotokoll ------------------------------------------------------
  {
    const wo = { createdAt: { lt: vorTagen(FRIST.storno) } };
    await weg(
      "Stornoprotokoll",
      () => prisma.cancellationLog.count({ where: wo }),
      () => prisma.cancellationLog.deleteMany({ where: wo }),
    );
  }

  // --- Notrufe --------------------------------------------------------------
  {
    const wo = { createdAt: { lt: vorTagen(FRIST.notruf) } };
    await weg(
      "Notrufe",
      () => prisma.sosAlert.count({ where: wo }),
      () => prisma.sosAlert.deleteMany({ where: wo }),
    );
  }

  // --- Chatnachrichten ------------------------------------------------------
  {
    const wo = { createdAt: { lt: vorTagen(FRIST.chat) } };
    await weg(
      "Chatnachrichten",
      () => prisma.chatMessage.count({ where: wo }),
      () => prisma.chatMessage.deleteMany({ where: wo }),
    );
  }

  // --- Medizinische Dokumente (Art. 9) -------------------------------------
  // Diese liegen als Base64 in der Datenbank. Sie sind das Sensibelste im
  // System und werden deshalb streng nach Frist entfernt.
  {
    const wo = { createdAt: { lt: vorTagen(FRIST.dokument) } };
    await weg(
      "Medizinische Dokumente",
      () => prisma.medicalDocument.count({ where: wo }),
      () => prisma.medicalDocument.deleteMany({ where: wo }),
    );
  }

  // --- Fahrten ohne Rechnungsbezug (nur mit ausdruecklicher Freigabe) ------
  {
    const wo = {
      createdAt: { lt: vorTagen(FRIST.fahrtOhneBeleg) },
      status: "STORNIERT" as const,
      // Nur, was nie bezahlt wurde – alles Bezahlte ist Beleg und bleibt.
      // Die tatsaechlich vorkommenden Werte sind OFFEN, KARTE_HINTERLEGT,
      // BEZAHLT, FEHLGESCHLAGEN und STORNIERT.
      paymentStatus: { notIn: ["BEZAHLT"] },
      // Zusaetzliche Sicherung: wo ein Fahrpreis steht, gab es eine Leistung.
      // Auch eine Stornogebuehr landet hier – solche Fahrten bleiben.
      fare: null,
    };
    const anzahl = await prisma.booking.count({ where: wo }).catch(() => 0);
    if (!FAHRTEN_AKTIV) {
      posten["Fahrten ohne Beleg (NICHT geloescht)"] = anzahl;
      if (anzahl > 0) {
        hinweise.push(
          `${anzahl} stornierte Fahrten ohne Zahlung waeren faellig. ` +
            "Loeschung ist absichtlich abgeschaltet (RETENTION_FAHRTEN=1 aktiviert sie), " +
            "weil an Fahrten Kaskaden und Aufbewahrungspflichten haengen.",
        );
      }
    } else {
      await weg(
        "Fahrten ohne Beleg",
        async () => anzahl,
        () => prisma.booking.deleteMany({ where: wo }),
      );
    }
  }

  // --- Fahrgastkonten ohne Fahrt (nur mit ausdruecklicher Freigabe) --------
  // Anonymisieren, NICHT loeschen: die Fahrten bleiben als Beleg bestehen.
  {
    const grenze = vorTagen(FRIST.kontoOhneFahrt);
    const kandidaten = await prisma.customer
      .findMany({
        where: {
          createdAt: { lt: grenze },
          bookings: { none: { createdAt: { gte: grenze } } },
          NOT: { email: { startsWith: "geloescht+" } },
        },
        select: { id: true },
        take: 500,
      })
      .catch(() => []);

    if (!KONTEN_AKTIV) {
      posten["Konten ohne Fahrt (NICHT anonymisiert)"] = kandidaten.length;
      if (kandidaten.length > 0) {
        hinweise.push(
          `${kandidaten.length} Fahrgastkonten ohne Fahrt in ${FRIST.kontoOhneFahrt} Tagen ` +
            "waeren faellig. Anonymisierung ist absichtlich abgeschaltet " +
            "(RETENTION_KONTEN=1 aktiviert sie), weil sie unumkehrbar ist.",
        );
      }
    } else if (trocken) {
      posten["Konten anonymisiert"] = kandidaten.length;
    } else {
      let n = 0;
      for (const k of kandidaten) {
        try {
          await prisma.customer.update({
            where: { id: k.id },
            data: {
              name: "Geloeschtes Konto",
              email: `geloescht+${k.id}@invalid.local`,
              phone: "",
              passwordHash: "",
              blocked: true,
              blockedReason: "Nach Loeschkonzept anonymisiert",
            },
          });
          n += 1;
        } catch {
          /* einzelne Fehlschlaege duerfen den Lauf nicht abbrechen */
        }
      }
      posten["Konten anonymisiert"] = n;
    }
  }

  return { trocken, posten, hinweise };
}

/** Bericht in einer Form ausgeben, die sich im Protokoll wiederfinden laesst. */
export function berichtAusgeben(b: Bericht): void {
  const kopf = b.trocken ? "Loeschlauf (TROCKEN, nichts geaendert)" : "Loeschlauf";
  const zeilen = Object.entries(b.posten)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[Loeschkonzept] ${kopf}: ${zeilen || "nichts faellig"}`);
  for (const h of b.hinweise) console.log(`[Loeschkonzept] Hinweis: ${h}`);
}
