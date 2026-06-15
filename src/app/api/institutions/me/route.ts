import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { INSTITUTION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ institution: null }, { status: 200 });
  const inst = await prisma.institution.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, type: true, email: true, phone: true, address: true },
  });
  return NextResponse.json({ institution: inst });
}

// Logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(INSTITUTION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
