// Zugriffsprotokoll (Phase F / DSGVO): protokolliert Zugriffe auf Gesundheits-/
// Patientendaten. Bewusst "fire-and-forget" – Logging darf einen Request nie
// scheitern lassen.

import { prisma } from "@/lib/prisma";

export type AccessAction = "VIEW" | "DOWNLOAD" | "APPROVE" | "REJECT" | "CREATE" | "EXPORT";
export type AccessEntity = "MEDICAL_DOCUMENT" | "BOOKING" | "PATIENT" | "RECURRING";

export async function logAccess(e: {
  actorType: "ADMIN" | "INSTITUTION" | "CUSTOMER" | "SYSTEM";
  actorId?: string | null;
  action: AccessAction;
  entity: AccessEntity;
  entityId?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.accessLog.create({
      data: {
        actorType: e.actorType,
        actorId: e.actorId ?? null,
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
