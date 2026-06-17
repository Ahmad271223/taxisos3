// Fahrer-/Fahrzeug-Dokumente mit Ablaufdatum (Compliance): Führerschein,
// P-Schein, Taxikonzession, Versicherung, TÜV/HU. Berechnet Gültigkeitsstatus
// und Ablaufwarnungen (30 Tage Vorlauf, damit rechtzeitig erneuert wird).

import { daysUntil } from "./medical";

export const DRIVER_DOC_WARN_DAYS = 30;

export type DriverDocStatus = "NONE" | "EXPIRED" | "EXPIRING" | "VALID";

export interface DriverDoc {
  key: string;
  label: string;
  date: string | null;
  status: DriverDocStatus;
  days: number | null;
}

const DOC_DEFS: { key: string; field: string; label: string }[] = [
  { key: "license", field: "licenseUntil", label: "Führerschein" },
  { key: "pschein", field: "pScheinUntil", label: "P-Schein" },
  { key: "concession", field: "concessionUntil", label: "Taxikonzession" },
  { key: "insurance", field: "insuranceUntil", label: "Versicherung" },
  { key: "tuev", field: "tuevUntil", label: "TÜV/HU" },
];

export function docStatus(iso: string | null | undefined): { status: DriverDocStatus; days: number | null } {
  const days = daysUntil(iso);
  if (days == null) return { status: "NONE", days: null };
  if (days < 0) return { status: "EXPIRED", days };
  if (days <= DRIVER_DOC_WARN_DAYS) return { status: "EXPIRING", days };
  return { status: "VALID", days };
}

export function driverDocs(driver: any): DriverDoc[] {
  return DOC_DEFS.map((d) => {
    const date: string | null = driver[d.field] ?? null;
    const { status, days } = docStatus(date);
    return { key: d.key, label: d.label, date, status, days };
  });
}

// Schlimmster Status + Zähler abgelaufener/bald-ablaufender Dokumente.
export function driverDocAlert(driver: any): { worst: DriverDocStatus; expired: number; expiring: number } {
  const docs = driverDocs(driver);
  let expired = 0;
  let expiring = 0;
  for (const d of docs) {
    if (d.status === "EXPIRED") expired++;
    else if (d.status === "EXPIRING") expiring++;
  }
  const worst: DriverDocStatus = expired > 0 ? "EXPIRED" : expiring > 0 ? "EXPIRING" : "VALID";
  return { worst, expired, expiring };
}
