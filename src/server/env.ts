// Laedt .env-Dateien fuer den Custom-Server (tsx), BEVOR Module wie der
// PrismaClient ausgewertet werden, die process.env.DATABASE_URL benoetigen.
// Diese Datei muss als ALLERERSTER Import in server.ts stehen.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
