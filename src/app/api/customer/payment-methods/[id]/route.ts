import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { setDefaultCard, removeCard, listCards } from "@/lib/customerCards";

export const dynamic = "force-dynamic";

// Standardkarte festlegen.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Bitte melden Sie sich an." }, { status: 401 });

  let json: any = {};
  try {
    json = await req.json();
  } catch {
    /* Body optional */
  }
  if (json?.isDefault === false) {
    return NextResponse.json({ error: "Es muss immer eine Standardkarte geben." }, { status: 400 });
  }

  const ok = await setDefaultCard(session.sub, params.id);
  if (!ok) return NextResponse.json({ error: "Karte nicht gefunden." }, { status: 404 });
  return NextResponse.json({ cards: await listCards(session.sub) });
}

// Karte entfernen.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Bitte melden Sie sich an." }, { status: 401 });

  const res = await removeCard(session.sub, params.id);
  if (!res.ok) {
    // Karte gehoert zu einer offenen Fahrt -> 409, sonst 404.
    const status = res.reason?.includes("offene Fahrt") ? 409 : 404;
    return NextResponse.json({ error: res.reason ?? "Karte nicht gefunden." }, { status });
  }
  return NextResponse.json({ cards: await listCards(session.sub) });
}
