import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { sendSms, sendEmail } from "@/lib/notify";
import { CODE_TTL_MS, generateCode, normalizeTarget, type VerifyChannel } from "@/lib/verify";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  channel: z.enum(["SMS", "EMAIL"]),
  target: z.string().min(3),
});

/**
 * Verifizierungs-Code anfordern (Phase 3h). Erzeugt einen 6-stelligen Code,
 * speichert ihn gehasht (per channel+target, upsert) und versendet ihn via
 * Twilio/Resend. Im Mock-Modus (keine Credentials) wird der Code als `devCode`
 * zurueckgegeben, damit der Flow lokal/CI testbar bleibt.
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
    return NextResponse.json({ error: "Kanal und Ziel erforderlich" }, { status: 400 });
  }
  const channel = parsed.data.channel as VerifyChannel;
  const target = normalizeTarget(channel, parsed.data.target);
  if (target.length < 3) {
    return NextResponse.json({ error: "Ungültiges Ziel" }, { status: 400 });
  }

  // Rate-Limit (nur hinter Proxy/Ingress): SMS-Bombing + Twilio-Kosten verhindern.
  // Jede SMS kostet echtes Geld. Das Limit pro ZIELNUMMER greift deshalb
  // immer – unabhaengig davon, ob eine IP feststellbar ist.
  const perTarget = rateLimit(`verify:t:${target}`, 5, 10 * 60_000);
  if (!perTarget.ok) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte später erneut versuchen.", retryAfter: perTarget.retryAfter },
      { status: 429 },
    );
  }
  const ip = clientIp(req);
  if (ip) {
    const perIp = rateLimit(`verify:ip:${ip}`, 50, 10 * 60_000);
    if (!perIp.ok) {
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte später erneut versuchen.", retryAfter: perIp.retryAfter },
        { status: 429 },
      );
    }
  }

  const code = generateCode();
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await prisma.verification.upsert({
    where: { channel_target: { channel, target } },
    update: { codeHash, expiresAt, attempts: 0, consumedAt: null },
    create: { channel, target, codeHash, expiresAt },
  });

  let mock = false;
  if (channel === "SMS") {
    const r = await sendSms(target, `Ihr TaxiOS-Bestätigungscode: ${code}`);
    mock = r.mock;
  } else {
    const r = await sendEmail(
      target,
      "Ihr TaxiOS-Bestätigungscode",
      `<p>Ihr Bestätigungscode lautet: <strong>${code}</strong></p><p>Gültig für 10 Minuten.</p>`,
    );
    mock = r.mock;
  }

  // devCode NUR außerhalb der Produktion offenlegen. In Produktion ohne echten
  // SMS/E-Mail-Versand (mock) darf der Code NICHT zurückgegeben werden – sonst
  // wäre die Verifizierung trivial umgehbar (Sicherheits-Theater). Läuft die App
  // produktiv ohne Anbieter, sollte REQUIRE_PHONE_VERIFICATION=0 gesetzt werden.
  // Zweite Sicherung: Vergisst ein Deployment NODE_ENV=production, wuerde der
  // Code sonst an jeden Anrufer gehen. Deshalb zusaetzlich verlangen, dass die
  // App unter einer lokalen Adresse laeuft.
  const base = (process.env.APP_BASE_URL ?? "").trim();
  const lokal = base === "" || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(base);
  const exposeDev = mock && process.env.NODE_ENV !== "production" && lokal;
  if (mock && process.env.NODE_ENV === "production") {
    console.warn(`[verify] ${channel}-Versand im Mock-Modus in PRODUKTION – kein Anbieter (Twilio/Resend) konfiguriert. Verifizierung schützt nicht.`);
  }
  return NextResponse.json({
    ok: true,
    channel,
    expiresAt: expiresAt.toISOString(),
    mock,
    ...(exposeDev ? { devCode: code } : {}),
  });
}
