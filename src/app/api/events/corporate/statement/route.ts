import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  corporateStatementPdf,
  corporateSections,
  type CorporateCarrier,
  type CorporateStatementLine,
} from "@/lib/corporatePdf";
import { taxiVatRate } from "@/lib/ridePdf";

export const dynamic = "force-dynamic";

// Monats-Abrechnung der Firmenmobilität als PDF: alle über die QR-Codes dieses
// Veranstalters übernommenen Fahrten im gewählten Monat.
export async function GET(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const monthParam = new URL(req.url).searchParams.get("month"); // "YYYY-MM"
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam ?? "");
  const year = m ? Number(m[1]) : now.getFullYear();
  const monthIdx = m ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(year, monthIdx, 1);
  const end = new Date(year, monthIdx + 1, 1);
  const periodLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(start);
  const monthKey = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;

  const host = await prisma.eventHost.findUnique({
    where: { id: session.sub },
    select: { name: true, address: true },
  });
  const codes = await prisma.corporateCode.findMany({ where: { eventHostId: session.sub }, select: { code: true } });
  const codeList = codes.map((c) => c.code);

  let lines: CorporateStatementLine[] = [];
  let total = 0;
  // Aussteller der Rechnung ist das befoerdernde Unternehmen. Deshalb wird es
  // hier mitgeladen – ohne diese Angabe liesse sich die Abrechnung nicht je
  // Unternehmen aufteilen und traege faelschlich die Plattform als Absender.
  const carriers = new Map<string, CorporateCarrier>();
  if (codeList.length) {
    const bookings = await prisma.booking.findMany({
      where: { corporateCode: { in: codeList }, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      include: {
        company: { select: { id: true, name: true, address: true, taxId: true, vatId: true } },
      },
    });
    for (const b of bookings) {
      if (b.company && !carriers.has(b.company.name)) {
        carriers.set(b.company.name, {
          id: b.company.id,
          name: b.company.name,
          address: b.company.address ?? null,
          taxId: b.company.taxId ?? null,
          vatId: b.company.vatId ?? null,
        });
      }
    }
    lines = bookings.map((b) => {
      const amount = b.fare ?? b.priceExact ?? b.priceApprox ?? b.priceMin ?? 0;
      total += amount;
      return {
        date: b.createdAt,
        guest: b.customerName,
        route: `${b.pickupAddress} -> ${b.destAddress}`,
        code: b.corporateCode ?? "",
        amount,
        companyName: b.company?.name ?? null,
        distanceMeters: b.distanceMeters ?? null,
      };
    });
  }
  total = Math.round(total * 100) / 100;

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Datum", "Fahrgast", "Fahrt", "Code", "Betrag (EUR)"].join(";");
    const rows = lines.map((l) =>
      [l.date.toLocaleDateString("de-DE"), l.guest, l.route, l.code, l.amount.toFixed(2).replace(".", ",")].map(esc).join(";"),
    );
    const csv = "﻿" + [header, ...rows].join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Firmenmobilitaet_${monthKey}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const empfaenger = host?.name ?? "Firma";
  const pdf = await corporateStatementPdf({
    company: empfaenger,
    companyAddress: host?.address ?? null,
    periodLabel,
    monthKey,
    issuedAtIso: new Date().toISOString(),
    lines,
    total,
    sections: corporateSections(lines, carriers, taxiVatRate, monthKey, empfaenger),
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Firmenmobilitaet_${monthKey}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
