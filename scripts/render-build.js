// Produktions-Build-Wrapper.
//
// Next.js 14.2.x hat einen Bug: `next build` kann die INTERNEN Default-
// Fehlerseiten /404 und /500 (Pages-Router-Fallback) nicht exportieren und
// bricht mit "Error: <Html> should not be imported outside of pages/_document"
// ab – OBWOHL alle App-Router-Seiten + Chunks erfolgreich kompiliert wurden.
// Der Abbruch passiert, BEVOR Next `.next/prerender-manifest.json` schreibt,
// wodurch der Produktions-Server nicht startet (ENOENT prerender-manifest).
//
// Diese App läuft über einen Custom-Server (server.ts), der vollständig
// dynamisch rendert (force-dynamic) und 404/500 zur Laufzeit erzeugt. Der
// Wrapper akzeptiert daher NUR diesen kosmetischen /404+/500-Fehler, ergänzt
// die fehlende (leere) prerender-manifest.json und liefert so einen
// vollständigen, lauffähigen Build. Jeder ANDERE Fehler bricht weiterhin ab.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let log = "";
const child = spawn("npx", ["next", "build"], { shell: true });
const tee = (stream, target) =>
  stream.on("data", (chunk) => {
    const s = chunk.toString();
    log += s;
    target.write(s);
  });
tee(child.stdout, process.stdout);
tee(child.stderr, process.stderr);

child.on("close", (code) => {
  if (code === 0) {
    ensurePrerenderManifest();
    process.exit(0);
  }

  const buildIdExists = fs.existsSync(path.join(".next", "BUILD_ID"));
  const compiled = /Compiled successfully/.test(log);
  const m = log.match(/Export encountered errors on following paths:\s*([\s\S]*?)(?:\n\n|\n[^\s/]|$)/);
  const listed = m ? m[1].split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const onlyErrorPages =
    listed.length > 0 &&
    listed.every((l) => /^\/_error:\s*\/(404|500)$/.test(l) || /\/_not-found$/.test(l));
  const realPageError = /Error occurred prerendering page "\/(?!404|500|_not-found)/.test(log);

  if (buildIdExists && compiled && onlyErrorPages && !realPageError) {
    ensurePrerenderManifest();
    console.log(
      "\n[render-build] Bekannter Next-14.2-Bug beim Export von " +
        listed.join(", ") +
        " ignoriert; fehlende prerender-manifest.json ergänzt. Build vollständig.",
    );
    process.exit(0);
  }

  console.error("\n[render-build] Build fehlgeschlagen (kein reiner /404,/500-Exportfehler).");
  process.exit(code || 1);
});

// Schreibt eine minimale, gültige prerender-manifest.json, falls sie der
// abgebrochene Export nicht erzeugt hat. Leere routes => alles dynamisch (SSR),
// exakt das gewünschte Verhalten dieser App.
function ensurePrerenderManifest() {
  const p = path.join(".next", "prerender-manifest.json");
  if (fs.existsSync(p)) return;
  const key = () => crypto.randomBytes(32).toString("hex");
  const manifest = {
    version: 4,
    routes: {},
    dynamicRoutes: {},
    notFoundRoutes: [],
    preview: { previewModeId: key(), previewModeSigningKey: key(), previewModeEncryptionKey: key() },
  };
  fs.writeFileSync(p, JSON.stringify(manifest));
  console.log("[render-build] .next/prerender-manifest.json ergänzt.");
}
