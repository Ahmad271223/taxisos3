import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { invoiceDTO, invoiceToData, markPaid, markUnpaid, recordReminder } from "@/lib/invoiceStore";
import { sendInvoiceEmail } from "@/lib/invoiceMail";

export const dynamic = "force-dynamic";

/**
 * Einzel-Aktionen auf einer archivierten Rechnung (Phase 6, Super-Admin):
 *  { action: "pay", ref? }  -> Zahlungseingang erfassen (Zahlungsabgleich)
 *  { action: "unpaid" }     -> Zahlung zurücknehmen
 *  { action: "remind" }     -> Mahnung per E-Mail senden
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* optional */
  }
  const action = body?.action;

  const inv = await prisma.invoice.findUnique({ where: { id: params.id } });
  if (!inv) return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });

  if (action === "pay") {
    const updated = await markPaid(inv.id, body.ref ?? null);
    return NextResponse.json({ ok: true, invoice: invoiceDTO(updated) });
  }
  if (action === "unpaid") {
    const updated = await markUnpaid(inv.id);
    return NextResponse.json({ ok: true, invoice: invoiceDTO(updated) });
  }
  if (action === "remind") {
    const mail = await sendInvoiceEmail(invoiceToData(inv), { reminder: true, level: inv.remindersSent + 1 });
    const updated = mail.sent ? await recordReminder(inv.id) : inv;
    return NextResponse.json({ ok: mail.sent, mock: mail.mock, error: mail.error, invoice: invoiceDTO(updated) });
  }

  return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
}
