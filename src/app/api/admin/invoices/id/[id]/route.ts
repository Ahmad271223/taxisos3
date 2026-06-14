import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invoicePdf } from "@/lib/pdf";
import { invoiceToData } from "@/lib/invoiceStore";

export const dynamic = "force-dynamic";

/** PDF einer festgeschriebenen (archivierten) Rechnung – eingefrorener Snapshot. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const inv = await prisma.invoice.findUnique({ where: { id: params.id } });
  if (!inv) return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && inv.companyId !== session.companyId) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const pdf = await invoicePdf(invoiceToData(inv));
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${inv.invoiceNo}.pdf"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
