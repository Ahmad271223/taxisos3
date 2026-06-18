import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { saveSubscription, removeSubscription } from "@/lib/webpush";

export const dynamic = "force-dynamic";

// Push-Subscription des Fahrer-Geräts speichern.
export async function POST(req: Request) {
  const session = requireRole("DRIVER");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const sub = body?.subscription ?? body;
  try {
    await saveSubscription(session.sub, sub, req.headers.get("user-agent") ?? undefined);
  } catch {
    return NextResponse.json({ error: "Ungültige Subscription" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

// Push-Subscription beim Abmelden/Deaktivieren entfernen.
export async function DELETE(req: Request) {
  const session = requireRole("DRIVER");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const endpoint = body?.endpoint;
  if (typeof endpoint === "string" && endpoint) await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
