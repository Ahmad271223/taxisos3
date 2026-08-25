// Fahrt-Erinnerungen: 24h / 2h / 30min vor einer geplanten Fahrt wird der
// Fahrgast erinnert (SMS via lib/notify; ohne Twilio-Key Mock-Log). Jede
// Erinnerung wird genau einmal verschickt (Booking.remindersSent, CSV).

import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/notify";
import { medicalLabel } from "@/lib/medical";

const OFFSETS = [
  { key: "24h", minutes: 1440 },
  { key: "2h", minutes: 120 },
  { key: "30m", minutes: 30 },
] as const;

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
    const due = OFFSETS.find(
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
