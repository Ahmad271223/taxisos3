import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Liefert beide möglichen Sessions (Admin/Super + Fahrer), damit beide
// gleichzeitig eingeloggt sein können. `session` = Admin bevorzugt (Back-Compat).
export async function GET() {
  const admin = getSession("admin");
  const driver = getSession("driver");
  const customer = getSession("customer");
  // KEIN generisches `session` mehr.
  //
  // Frueher stand hier `session: admin ?? driver ?? customer`. Wer Firmenchef
  // und Fahrer gleichzeitig im selben Browser offen hatte, bekam damit ueberall
  // den Firmenchef geliefert - waehrend der Echtzeitkanal umgekehrt den Fahrer
  // bevorzugte. Genau daraus entstand die schwer greifbare Vermischung der
  // Konten zwischen zwei Reitern. Jede Oberflaeche muss jetzt sagen, wen sie
  // meint: `admin`, `driver` oder `customer`.
  return NextResponse.json({ admin, driver, customer });
}
