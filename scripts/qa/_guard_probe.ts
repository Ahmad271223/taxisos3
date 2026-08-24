// Hilfsprogramm fuer scripts/qa/live_ready.js: fuehrt NUR die Startsperre aus
// und beendet sich sofort. So laesst sich das Verhalten pruefen, ohne jedes Mal
// einen vollstaendigen Server hochzufahren.
//
// Der env-Import muss – wie in server.ts – ganz oben stehen, sonst pruefte die
// Sperre eine leere Umgebung und meldete alles als fehlend. Bereits gesetzte
// Variablen bleiben dabei unangetastet, damit Tests gezielt vorgeben koennen.
import "../../src/server/env";
import { assertLiveReady } from "../../src/server/liveGuard";

assertLiveReady();
console.log("START-FREIGEGEBEN");
