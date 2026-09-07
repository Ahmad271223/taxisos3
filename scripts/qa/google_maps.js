// QA: Google Maps Platform als einziger Kartendienst.
//
// Ohne Schluessel prueft die Reihe die Weiche, die Startsperre und den
// Streckendekoder mit Googles eigenem Beispielwert. Liegt ein echter
// Server-Schluessel vor (GOOGLE_MAPS_API_KEY in .env), werden zusaetzlich
// echte Anfragen gestellt: Adresse -> Koordinate, Koordinate -> Adresse,
// Route Hauptbahnhof -> List mit Strassenverlauf und Fahrzeit.
//
// Aufruf: node scripts/qa/google_maps.js   (kein Server noetig)
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish } = H;
const fs = require("fs");
const path = require("path");

function laden() {
  const { register } = require("tsx/cjs/api");
  register();
  return {
    geoGoogle: require("../../src/lib/geoGoogle.ts"),
    guard: require("../../src/server/liveGuard.ts"),
  };
}

async function main() {
  const { geoGoogle, guard } = laden();
  const ROOT = path.join(__dirname, "..", "..");

  // =========================================================================
  section("1) Leaflet ist vollstaendig weg");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const alleDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  check("Kein leaflet-Paket mehr", !Object.keys(alleDeps).some((k) => /leaflet/i.test(k)), Object.keys(alleDeps).filter((k) => /leaflet/i.test(k)).join(","));
  check("Keine Leaflet-Dateien mehr", !fs.existsSync(path.join(ROOT, "src/components/LeafletMap.tsx")));
  const layout = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  check("Kein Leaflet-CSS im Layout", !/leaflet/.test(layout));
  const mapTsx = fs.readFileSync(path.join(ROOT, "src/components/Map.tsx"), "utf8");
  check("Map.tsx zeichnet nur noch Google", /GoogleMap/.test(mapTsx) && !/react-leaflet/.test(mapTsx));
  check("Ohne Schluessel gibt es einen klaren Hinweis statt leerer Flaeche", /map-unconfigured/.test(mapTsx));

  // =========================================================================
  section("2) Streckendekoder (Googles Beispielwert)");
  // Aus der Google-Dokumentation: dieser Wert dekodiert zu drei Punkten.
  const punkte = geoGoogle.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  check("Drei Punkte", punkte.length === 3, punkte.length);
  const nah = (a, b) => Math.abs(a - b) < 0.0001;
  check("Punkt 1 stimmt (38.5, -120.2)", nah(punkte[0][0], 38.5) && nah(punkte[0][1], -120.2), JSON.stringify(punkte[0]));
  check("Punkt 2 stimmt (40.7, -120.95)", nah(punkte[1][0], 40.7) && nah(punkte[1][1], -120.95), JSON.stringify(punkte[1]));
  check("Punkt 3 stimmt (43.252, -126.453)", nah(punkte[2][0], 43.252) && nah(punkte[2][1], -126.453), JSON.stringify(punkte[2]));

  // =========================================================================
  section("3) Startsperre verlangt beide Google-Schluessel");
  const ohne = guard.collectFindings({ NODE_ENV: "production" });
  const server = ohne.find((f) => f.key === "GOOGLE_MAPS_API_KEY");
  const browser = ohne.find((f) => f.key === "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  check("Fehlender Server-Schluessel wird als hart gemeldet", !!server && server.fatal === true, JSON.stringify(server?.fatal));
  check("Fehlender Browser-Schluessel wird als hart gemeldet", !!browser && browser.fatal === true, JSON.stringify(browser?.fatal));
  const mit = guard.collectFindings({
    NODE_ENV: "production",
    GOOGLE_MAPS_API_KEY: "AIza-platzhalter",
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "AIza-platzhalter",
  });
  check("Mit beiden Schluesseln keine Karten-Beanstandung mehr",
    !mit.some((f) => /GOOGLE_MAPS/.test(f.key)), mit.filter((f) => /GOOGLE/.test(f.key)).map((f) => f.key).join(","));
  check("Alte Anbieter werden nicht mehr verlangt", !ohne.some((f) => /MAPBOX|LOCATIONIQ/.test(f.key)));

  // =========================================================================
  section("4) Echte Anfragen (nur mit Schluessel)");
  if (!geoGoogle.googleConfigured()) {
    info("GOOGLE_MAPS_API_KEY nicht gesetzt - echte Anfragen uebersprungen. Mit Schluessel in .env erneut ausfuehren.");
    check("Anbieter-Erkennung ohne Schluessel: aus", geoGoogle.googleConfigured() === false);
  } else {
    const treffer = await geoGoogle.geocodeGoogle("Hauptbahnhof Hannover", 3, { lat: 52.3759, lng: 9.732 });
    check("Adresssuche liefert Treffer", treffer.length > 0, treffer.length);
    check("Treffer liegt in Hannover", !!treffer[0] && Math.abs(treffer[0].lat - 52.3766) < 0.02 && Math.abs(treffer[0].lng - 9.7411) < 0.02, JSON.stringify(treffer[0]));
    check("Label ohne '..., Deutschland'", !!treffer[0] && !/Deutschland$/.test(treffer[0].label), treffer[0]?.label);

    const rueck = await geoGoogle.reverseGeocodeGoogle(52.3759, 9.732);
    check("Rueckwaerts-Suche liefert eine Adresse", !!rueck?.label, rueck?.label);

    const route = await geoGoogle.routeGoogle([{ lat: 52.3759, lng: 9.732 }, { lat: 52.39, lng: 9.76 }]);
    check("Route hat plausible Strecke (1-6 km)", route.distanceMeters > 1000 && route.distanceMeters < 6000, route.distanceMeters);
    check("Route hat Fahrzeit", route.durationSeconds > 60, route.durationSeconds);
    check("Route folgt echten Strassen (viele Punkte)", (route.geometry ?? []).length > 10, route.geometry?.length);
    info(`Hauptbahnhof -> List: ${(route.distanceMeters / 1000).toFixed(2)} km, ${Math.round(route.durationSeconds / 60)} Min`);

    // Laeden und Orte: das konnte die alte Suche (Photon) und muss Google
    // ueber die Places API ebenfalls koennen - sonst findet der Fahrgast
    // "C&A" oder seinen Friseur nicht.
    let placesFrei = true;
    let laden = [];
    try {
      laden = await geoGoogle.placesSuchen("C&A Hannover", 3, { lat: 52.3759, lng: 9.732 });
    } catch (e) {
      placesFrei = false;
      info(`Places API nicht freigeschaltet (${String(e?.message ?? e).slice(0, 90)}) - im Cloud-Projekt "Places API (New)" aktivieren und im Server-Schluessel erlauben.`);
    }
    if (placesFrei) {
      check("Laden wird gefunden (C&A)", laden.length > 0 && /C&A/i.test(laden[0].label), laden[0]?.label);
      check("Laden hat eine Anschrift", !!laden[0] && /Hannover/.test(laden[0].label), laden[0]?.label);
      const ueberSuche = await geoGoogle.geocodeGoogle("Neues Rathaus Hannover", 3, { lat: 52.3759, lng: 9.732 });
      check("Adresssuche nutzt Places fuer Orte", ueberSuche.length > 0 && /Rathaus/i.test(ueberSuche[0].label), ueberSuche[0]?.label);
    } else {
      check("Ohne Places faellt die Suche auf Adressen zurueck (kein Ausfall)",
        (await geoGoogle.geocodeGoogle("Georgstrasse 21 Hannover", 1, { lat: 52.3759, lng: 9.732 })).length > 0);
    }

    const mehrziel = await geoGoogle.routeGoogle([
      { lat: 52.3759, lng: 9.732 }, { lat: 52.3705, lng: 9.7392 }, { lat: 52.39, lng: 9.76 },
    ]);
    check("Mehrziel-Route ist laenger als die direkte", mehrziel.distanceMeters >= route.distanceMeters, `${mehrziel.distanceMeters} >= ${route.distanceMeters}`);
  }

  finish("GOOGLE-MAPS");
}

main().catch((e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  process.exit(1);
});
