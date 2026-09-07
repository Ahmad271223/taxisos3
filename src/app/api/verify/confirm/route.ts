import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { MAX_ATTEMPTS, normalizeTarget, signVerifyToken, type VerifyChannel } from "@/lib/verify";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  channel: z.enum(["SMS", "EMAIL"]),
  target: z.string().min(3),
  code: z.string().min(4).max(8),
});

/**
 * Verifizierungs-Code bestätigen (Phase 3h). Bei Erfolg wird ein kurzlebiges,
 * signiertes Token zurueckgegeben, das die Buchung als Nachweis mitschickt.
 */
export async function POST(req: Request) {
  // Diese Route pruefte bisher gar nichts ab: kein Limit je Adresse, keines je
  // Ziel. Jeder Versuch loest eine absichtlich rechenintensive Passwortpruefung
  // aus - das ist ohne Bremse auch ein Hebel, um den Server auszulasten.
  const ip = clientIp(req);
  if (ip && !rateLimit(`verify-confirm:ip:${ip}`, 30, 10 * 60_000).ok) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte später erneut." }, { status: 429 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Kanal, Ziel und Code erforderlich" }, { status: 400 });
  }
  const channel = parsed.data.channel as VerifyChannel;
  const target = normalizeTarget(channel, parsed.data.target);

  const v = await prisma.verification.findUnique({
    where: { channel_target: { channel, target } },
  });
  if (!v) {
    return NextResponse.json({ error: "Kein Code angefordert. Bitte neu anfordern." }, { status: 404 });
  }
  if (v.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Code abgelaufen. Bitte neu anfordern." }, { status: 410 });
  }
  // Ein bereits eingeloester Code galt weiter: `consumedAt` wurde zwar
  // gesetzt, aber nie geprueft. Derselbe Code liess sich bis zum Ablauf
  // beliebig oft gegen ein frisches Nachweis-Token eintauschen.
  if (v.consumedAt) {
    return NextResponse.json({ error: "Dieser Code wurde bereits verwendet. Bitte neu anfordern." }, { status: 410 });
  }

  // Versuch ZUERST verbuchen, dann pruefen. Vorher wurde gelesen, dann
  // gerechnet, dann hochgezaehlt: vier gleichzeitige Anfragen sahen alle
  // denselben Stand und kamen gemeinsam am Limit vorbei. Die Bedingung im
  // UPDATE laesst die Datenbank entscheiden.
  const versuch = await prisma.verification.updateMany({
    where: { id: v.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (versuch.count !== 1) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte neu anfordern." }, { status: 429 });
  }

  const ok = await verifyPassword(parsed.data.code, v.codeHash);
  if (!ok) {
    return NextResponse.json({ error: "Code falsch." }, { status: 401 });
  }

  // Einloesen ebenfalls bedingt: zwei gleichzeitige richtige Anfragen duerfen
  // nicht beide ein Nachweis-Token bekommen.
  const eingeloest = await prisma.verification.updateMany({
    where: { id: v.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (eingeloest.count !== 1) {
    return NextResponse.json({ error: "Dieser Code wurde bereits verwendet. Bitte neu anfordern." }, { status: 410 });
  }

  const token = signVerifyToken(channel, target);
  return NextResponse.json({ ok: true, channel, token });
}
