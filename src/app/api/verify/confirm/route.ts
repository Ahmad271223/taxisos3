import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { MAX_ATTEMPTS, normalizeTarget, signVerifyToken, type VerifyChannel } from "@/lib/verify";

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
  if (v.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte neu anfordern." }, { status: 429 });
  }

  const ok = await verifyPassword(parsed.data.code, v.codeHash);
  if (!ok) {
    await prisma.verification.update({
      where: { id: v.id },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "Code falsch." }, { status: 401 });
  }

  await prisma.verification.update({
    where: { id: v.id },
    data: { consumedAt: new Date() },
  });

  const token = signVerifyToken(channel, target);
  return NextResponse.json({ ok: true, channel, token });
}
