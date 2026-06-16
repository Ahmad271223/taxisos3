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

export async function sendDueReminders(): Promise<number> {
  const now = Date.now();
  const horizon = new Date(now + (1440 + GRACE_MIN) * 60_000);
  const bookings = await prisma.booking.findMany({
    where: {
      isScheduled: true,
      scheduledAt: { gt: new Date(now), lt: horizon },
      status: { in: ["OFFEN", "ZUGEWIESEN"] },
    },
    select: {
      id: true, scheduledAt: true, customerPhone: true, customerName: true,
      patientName: true, pickupAddress: true, medicalType: true, remindersSent: true,
    },
  });

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

    if (b.customerPhone && b.customerPhone !== "—") {
      await sendSms(b.customerPhone, body).catch(() => {});
    } else {
      console.log(`[reminder:no-phone] ${b.id}: ${body}`);
    }

    already.add(due.key);
    await prisma.booking.update({ where: { id: b.id }, data: { remindersSent: Array.from(already).join(",") } });
    sent++;
  }
  return sent;
}
