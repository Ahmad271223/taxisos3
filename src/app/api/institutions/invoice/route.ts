import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { buildInstitutionStatement } from "@/lib/institutionInvoice";

export const dynamic = "force-dynamic";

// Monats-Abrechnung einer Einrichtung (Phase E) als JSON. PDF: siehe ./pdf.
export async function GET(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const month = new URL(req.url).searchParams.get("month");
  const statement = await buildInstitutionStatement(session.sub, month);
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "EXPORT", entity: "BOOKING", detail: `Abrechnung ${statement.monthKey}` });
  return NextResponse.json(statement);
}
