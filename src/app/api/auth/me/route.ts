import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Liefert beide möglichen Sessions (Admin/Super + Fahrer), damit beide
// gleichzeitig eingeloggt sein können. `session` = Admin bevorzugt (Back-Compat).
export async function GET() {
  const admin = getSession("admin");
  const driver = getSession("driver");
  const customer = getSession("customer");
  return NextResponse.json({ admin, driver, customer, session: admin ?? driver ?? customer });
}
