import { NextResponse } from "next/server";
import { einrichtungAktiv } from "@/lib/kontoAktiv";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { buildInstitutionStatement } from "@/lib/institutionInvoice";
import { institutionStatementPdf } from "@/lib/institutionPdf";

export const dynamic = "force-dynamic";

// Monats-Abrechnung als PDF (Phase E).
export async function GET(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Eine Sperre muss SOFORT wirken, nicht erst wenn der Ausweis nach sieben
  // Tagen ablaeuft - hier haengen Patientenakten dran.
  if (!(await einrichtungAktiv(session.sub))) {
    return NextResponse.json(
      { error: "Ihr Zugang ist derzeit gesperrt. Bitte wenden Sie sich an die Zentrale.", code: "INSTITUTION_INACTIVE" },
      { status: 403 },
    );
  }

  const month = new URL(req.url).searchParams.get("month");
  const statement = await buildInstitutionStatement(session.sub, month);
  const pdf = await institutionStatementPdf(statement);
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "EXPORT", entity: "BOOKING", detail: `PDF-Abrechnung ${statement.monthKey}` });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Abrechnung_${statement.monthKey}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
