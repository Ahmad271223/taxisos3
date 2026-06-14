// Krankenfahrten (Phase 15): Kategorien für medizinische Fahrten.
// Häufig mit Rollstuhltaxi (vehicleClass WHEELCHAIR), oft wiederkehrend
// (z. B. Dialyse 3×/Woche) – siehe lib/recurring.

export interface MedicalType {
  key: string;
  label: string;
  icon: string;
}

export const MEDICAL_TYPES: MedicalType[] = [
  { key: "DIALYSE", label: "Dialyse", icon: "🩺" },
  { key: "REHA", label: "Reha", icon: "🧑‍⚕️" },
  { key: "KRANKENHAUS", label: "Krankenhaus", icon: "🏥" },
  { key: "ARZT", label: "Arzttermin", icon: "💊" },
  { key: "SONSTIGE", label: "Sonstige", icon: "➕" },
];

const KEYS = new Set(MEDICAL_TYPES.map((m) => m.key));

export function isValidMedicalType(key: string | null | undefined): boolean {
  return !!key && KEYS.has(key);
}

export function normalizeMedicalType(key: string | null | undefined): string | null {
  return key && KEYS.has(key) ? key : null;
}

export function medicalLabel(key: string | null | undefined): string | null {
  return MEDICAL_TYPES.find((m) => m.key === key)?.label ?? null;
}
