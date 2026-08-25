// Fahrt-Erinnerungen: 24h / 2h / 30min vor einer geplanten Fahrt wird der
// Fahrgast erinnert (SMS via lib/notify; ohne Twilio-Key Mock-Log). Jede
// Erinnerung wird genau einmal verschickt (Booking.remindersSent, CSV).

import { prisma } from "@/lib/prisma";
import { smsProfil, sendSms } from "@/lib/notify";
import { medicalLabel } from "@/lib/medical";

const ALLE_OFFSETS = [
  { key: "24h", minutes: 1440 },
  { key: "2h", minutes: 120 },
  { key: "30m", minutes: 30 },
] as const;

// Hier entstehen die Kosten: DREI Erinnerungen je Vorbestellung. Zusammen mit
// Bestaetigung, "Fahrer unterwegs" und "Fahrer da" kommt eine Vorbestellung so
// auf rund sechs SMS (~0,49 EUR). Das Sparprofil kuerzt genau hier.
//
//   voll     24 h, 2 h, 30 min   – wie bisher
//   sparsam  2 h                 – Standard; eine Erinnerung reicht in der Praxis
//   minimal  keine               – der Fahrgast sieht alles auf der Verfolgungsseite
//
// Mit REMINDER_OFFSETS laesst sich die Auswahl unabhaengig vom Profil setzen,
// z. B. REMINDER_OFFSETS="24h,30m".
function aktiveOffsets(): typeof ALLE_OFFSETS[number][] {
  const eigene = (process.env.REMINDER_OFFSETS ?? "").trim();
  if (eigene) {
    const gewuenscht = new Set(eigene.split(",").map((s) => s.trim()));
    return ALLE_OFFSETS.filter((o) => gewuenscht.has(o.key));
  }
  const profil = smsProfil();
  if (profil === "voll") return [...ALLE_OFFSETS];
  if (profil === "minimal") return [];
  return ALLE_OFFSETS.filter((o) => o.key === "2h");
}

// Fenster nach der Triggerzeit, in dem die Erinnerung noch ausgelöst wird
// (deckt das Poll-Intervall ab; verhindert „verpasste" Nachzügler-Bursts).
const GRACE_MIN = 20;

const ERINNERUNGS_DECKEL = Number(process.env.REMINDER_BATCH ?? 500);

export async function sendDueReminders(): Promise<number> {
  const now = Date.now();
  const horizon = new Date(now + (1440 + GRACE_MIN) * 60_000);
  // Ohne Obergrenze zieht dieser Lauf ALLE faelligen Vorbestellungen auf
  // einmal in den Speicher. Bei einer Grossveranstaltung sind das schnell
  // Tausende – der Prozess blockiert dann minutenlang. Der Lauf wiederholt
  // sich alle 5 Minuten und markiert verschickte Erinnerungen, der Rest kommt
  // also im naechsten Durchgang dran. Die faelligsten zuerst.
  const bookings = await prisma.booking.findMany({
    where: {
      isScheduled: true,
      scheduledAt: { gt: new Date(now), lt: horizon },
      status: { in: ["OFFEN", "ZUGEWIESEN"] },
    },
    orderBy: { scheduledAt: "asc" },
    take: ERINNERUNGS_DECKEL,
    select: {
      id: true, scheduledAt: true, customerPhone: true, customerName: true,
      patientName: true, pickupAddress: true, medicalType: true, remindersSent: true,
    },
  });

  if (bookings.length === ERINNERUNGS_DECKEL) {
    console.warn(
      `Erinnerungen: Obergrenze von ${ERINNERUNGS_DECKEL} erreicht – der Rest folgt im naechsten Lauf.`,
    );
  }

  let sent = 0;
  for (const b of bookings) {
    if (!b.scheduledAt) continue;
    const minutesUntil = (b.scheduledAt.getTime() - now) / 60_000;
    const already = new Set((b.remindersSent ?? "").split(",").filter(Boolean));

    // Größtes fälliges Offset (OFFSETS ist absteigend) – max. eine Erinnerung pro Lauf.
    const due = aktiveOffsets().find(
      (o) => !already.has(o.key) && minutesUntil <= o.minutes && minutesUntil >= o.minutes - GRACE_MIN,
    );
    if (!due) continue;

    const when = b.scheduledAt.toLocaleString("de-DE", {
      weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const who = b.patientName || b.customerName;
    const label = b.medicalType ? medicalLabel(b.medicalType) ?? "Fahrt" : "Fahrt";
    const body = `Erinnerung: ${label} für ${who} am ${when} Uhr ab ${b.pickupAddress}.`;

    // Merker ZUERST setzen (atomar, nur wenn der Offset noch nicht drin ist).
    // Sonst koennte ein paralleler Lauf dieselbe Erinnerung erneut senden,
    // weil das Flag frueher nur NACH dem Twilio-Roundtrip geschrieben wurde.
    already.add(due.key);
    const claimed = await prisma.booking.updateMany({
      where: { id: b.id, remindersSent: b.remindersSent ?? "" },
      data: { remindersSent: Array.from(already).join(",") },
    });
    if (claimed.count === 0) continue; // anderer Lauf war schneller

    if (b.customerPhone && b.customerPhone !== "—") {
      // Zusaetzliche Sperre ueber das SMS-Protokoll (wirkt auch bei mehreren
      // Server-Instanzen, die sich die Datenbank teilen).
      await sendSms(b.customerPhone, body, {
        dedupeKey: `reminder:${b.id}:${due.key}`,
        kind: "REMINDER",
        bookingId: b.id,
      }).catch(() => {});
    } else {
      console.log(`[reminder:no-phone] ${b.id}: ${body}`);
    }
    sent++;
  }
  return sent;
}
