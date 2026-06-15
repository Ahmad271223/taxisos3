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

// ── Krankenfahrt-Details (Phase B) ─────────────────────────────────────────
import { z } from "zod";

export const MOBILITY_OPTIONS = [
  { key: "WALK", label: "Kann selbst laufen", icon: "🚶" },
  { key: "CANE", label: "Gehstock", icon: "🦯" },
  { key: "WALKER", label: "Rollator", icon: "🚶‍➡️" },
  { key: "WHEELCHAIR", label: "Rollstuhl", icon: "🦽" },
  { key: "E_WHEELCHAIR", label: "Elektrorollstuhl", icon: "🦼" },
] as const;

export const EQUIPMENT_OPTIONS = [
  { key: "WHEELCHAIR", label: "Rollstuhl", icon: "🦽" },
  { key: "E_WHEELCHAIR", label: "Elektrorollstuhl", icon: "🦼" },
  { key: "OXYGEN", label: "Sauerstoffgerät", icon: "🫁" },
  { key: "WALKER", label: "Gehhilfe", icon: "🦯" },
  { key: "LUGGAGE", label: "Med. Gepäck", icon: "🧳" },
] as const;

export const PAYER_TYPES = [
  { key: "SELF", label: "Privatzahler", icon: "💳" },
  { key: "INSURANCE", label: "Krankenkasse", icon: "🏥" },
] as const;

const MOBILITY_KEYS = new Set(MOBILITY_OPTIONS.map((m) => m.key));
const EQUIPMENT_KEYS = new Set(EQUIPMENT_OPTIONS.map((e) => e.key));

export function mobilityLabel(key: string | null | undefined): string | null {
  return MOBILITY_OPTIONS.find((m) => m.key === key)?.label ?? null;
}

export function equipmentLabels(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((k) => k.trim())
    .filter((k) => EQUIPMENT_KEYS.has(k as any))
    .map((k) => EQUIPMENT_OPTIONS.find((e) => e.key === k)?.label ?? k);
}

// Zod-Felder, die in die Buchungs-/Serien-Schemata gespreadet werden.
export const medicalDetailsSchema = {
  patientName: z.string().max(120).optional().nullable(),
  patientBirthDate: z.string().max(20).optional().nullable(),
  mobility: z.string().max(20).optional().nullable(),
  companions: z.number().int().min(0).max(6).optional().nullable(),
  medicalEquipment: z.array(z.string().max(20)).max(10).optional().nullable(),
  payerType: z.string().max(20).optional().nullable(),
  insuranceName: z.string().max(120).optional().nullable(),
  insuranceNumber: z.string().max(60).optional().nullable(),
  requiresRamp: z.boolean().optional().nullable(),
  requiresStretcher: z.boolean().optional().nullable(),
};

// Baut die persistierbaren Spaltenwerte aus der validierten Eingabe.
export function medicalDetailsData(d: any) {
  const norm = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const mobility = norm(d.mobility);
  const payer = norm(d.payerType);
  return {
    patientName: norm(d.patientName),
    patientBirthDate: norm(d.patientBirthDate),
    mobility: mobility && MOBILITY_KEYS.has(mobility as any) ? mobility : null,
    companions: typeof d.companions === "number" ? Math.max(0, Math.min(6, d.companions)) : 0,
    medicalEquipment:
      Array.isArray(d.medicalEquipment) && d.medicalEquipment.length
        ? d.medicalEquipment.filter((k: string) => EQUIPMENT_KEYS.has(k as any)).join(",") || null
        : null,
    payerType: payer === "SELF" || payer === "INSURANCE" ? payer : null,
    insuranceName: norm(d.insuranceName),
    insuranceNumber: norm(d.insuranceNumber),
    requiresRamp: !!d.requiresRamp,
    requiresStretcher: !!d.requiresStretcher,
  };
}
