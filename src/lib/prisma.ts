import { PrismaClient } from "@prisma/client";

// Einen einzigen PrismaClient pro Prozess wiederverwenden (verhindert
// Verbindungs-Leaks bei Hot-Reload im Dev-Modus).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Verbindungslimit an die Datenbank-URL haengen.
 *
 * Prisma oeffnet ohne Angabe rund (CPU-Kerne * 2 + 1) Verbindungen – auf einem
 * kleinen Server also etwa 17. Zwei Instanzen kaemen damit auf ~34 und wuerden
 * das Limit einer Starter-Datenbank (etwa 22) sprengen; die zweite Instanz
 * bekaeme dann gar keine Verbindung mehr.
 *
 * Der Wert kommt aus DB_CONNECTION_LIMIT. Steht in der URL bereits ein
 * connection_limit, bleibt es unberuehrt.
 */
function datenbankUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  const limit = process.env.DB_CONNECTION_LIMIT;
  if (!url || !limit) return url;
  if (url.includes("connection_limit=")) return url;
  return url + (url.includes("?") ? "&" : "?") + `connection_limit=${limit}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(process.env.DB_CONNECTION_LIMIT && process.env.DATABASE_URL
      ? { datasources: { db: { url: datenbankUrl() as string } } }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
