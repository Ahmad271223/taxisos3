import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listForCompany } from "@/lib/invoiceStore";

export const dynamic = "force-dynamic";

/** Rechnungs-Archiv der eigenen Firma (Phase 6). */
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  return NextResponse.json({ invoices: await listForCompany(session.companyId) });
}
