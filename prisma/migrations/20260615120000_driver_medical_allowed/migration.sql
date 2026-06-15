-- Krankenfahrten-Freigabe (Phase 15): nur freigegebene Fahrer duerfen
-- Buchungen mit medicalType annehmen. Standard: nicht freigegeben.
ALTER TABLE "Driver" ADD COLUMN "medicalAllowed" BOOLEAN NOT NULL DEFAULT false;
