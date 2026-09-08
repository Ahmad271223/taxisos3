// Zugriffsprotokoll (Phase F / DSGVO): protokolliert Zugriffe auf Gesundheits-/
// Patientendaten. Bewusst "fire-and-forget" – Logging darf einen Request nie
// scheitern lassen.

import { prisma } from "@/lib/prisma";

export type AccessAction = "VIEW" | "DOWNLOAD" | "APPROVE" | "REJECT" | "CREATE" | "UPDATE" | "CANCEL" | "EXPORT";
// INSTITUTION: Freigabe/Sperre einer Einrichtung durch die Plattform.
// SOS:         Bearbeitung eines Notrufs – muss nachvollziehbar bleiben.
export type AccessEntity =
  | "MEDICAL_DOCUMENT"
  | "BOOKING"
  | "PATIENT"
  | "RECURRING"
  | "INSTITUTION"
  | "SOS"
  // DRIVER: Aenderungen an Fahrerrechten und -nachweisen.
  | "DRIVER";

export async function logAccess(e: {
  actorType: "ADMIN" | "INSTITUTION" | "CUSTOMER" | "SYSTEM";
  actorId?: string | null;
  action: AccessAction;
  entity: AccessEntity;
  entityId?: string | null;
  detail?: string | null;
  /** Mandant – ohne den ist der Eintrag fuer kein Unternehmen sichtbar. */
  companyId?: string | null;
}): Promise<void> {
  try {
    await prisma.accessLog.create({
      data: {
        actorType: e.actorType,
        actorId: e.actorId ?? null,
        companyId: e.companyId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        detail: e.detail ?? null,
      },
    });
  } catch {
    /* Protokollierung darf den eigentlichen Vorgang nicht blockieren. */
  }
}
