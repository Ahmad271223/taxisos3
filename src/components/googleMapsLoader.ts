// Laedt das Google-Maps-Skript genau einmal und liefert das `google`-Objekt.
//
// Bewusst ohne Zusatzpaket (@googlemaps/js-api-loader): es sind ~30 Zeilen,
// und jede weitere Abhaengigkeit ist ein weiterer Update-Pfad. Typen werden
// hier nicht eingebunden - das Objekt ist `any`; die Karte kapselt den
// Umgang damit an EINER Stelle (GoogleMap.tsx / GoogleLocationPicker.tsx).
//
// Der Schluessel ist ein NEXT_PUBLIC_-Wert, landet also im Browser. Das ist
// bei Google so vorgesehen; abgesichert wird er in der Cloud Console durch die
// Einschraenkung auf die eigene Domain (HTTP-Referrer).

declare global {
  interface Window {
    google?: any;
  }
}

export function googleMapsKey(): string {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim();
}

/** Ist Google Maps fuer die Oberflaeche konfiguriert? */
export function googleMapsAktiv(): boolean {
  return googleMapsKey().length > 0;
}

let ladevorgang: Promise<any> | null = null;

// Google meldet einen abgelehnten Schluessel (falsche Domain, API nicht
// aktiviert, Abrechnung fehlt) NICHT als Ausnahme, sondern ruft die globale
// Funktion gm_authFailure auf und schaltet die Bibliothek danach ab. Jeder
// weitere Aufruf laeuft dann in tote Objekte und wirft - ohne diese Stelle
// riss ein abgelehnter Schluessel die ganze Seite mit.
let authAbgelehnt = false;
const authZuhoerer = new Set<() => void>();

if (typeof window !== "undefined") {
  (window as any).gm_authFailure = () => {
    authAbgelehnt = true;
    for (const z of authZuhoerer) z();
  };
}

/** Wurde der Schluessel von Google abgelehnt? */
export function googleMapsAbgelehnt(): boolean {
  return authAbgelehnt;
}

/** Wird aufgerufen, sobald Google den Schluessel ablehnt. Liefert eine Abmeldefunktion. */
export function beiGoogleMapsAblehnung(cb: () => void): () => void {
  authZuhoerer.add(cb);
  if (authAbgelehnt) cb();
  return () => authZuhoerer.delete(cb);
}

export const ABLEHNUNGS_HINWEIS =
  "Google Maps hat den Schlüssel abgelehnt – diese Adresse ist im Google-Cloud-Projekt nicht freigegeben " +
  "oder die Maps JavaScript API ist nicht aktiviert.";

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps laeuft nur im Browser."));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);
  if (ladevorgang) return ladevorgang;

  ladevorgang = new Promise((resolve, reject) => {
    // Mit loading=async ist `google.maps` beim onload des Skripts noch NICHT
    // fertig (importLibrary fehlt dann noch). Google ruft stattdessen die
    // benannte callback-Funktion auf, sobald wirklich alles bereit ist.
    const rueckruf = "__taxiosGoogleMapsBereit";
    (window as any)[rueckruf] = async () => {
      try {
        await window.google.maps.importLibrary("maps");
        await window.google.maps.importLibrary("marker");
        resolve(window.google);
      } catch (e) {
        ladevorgang = null;
        reject(e);
      } finally {
        delete (window as any)[rueckruf];
      }
    };

    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: googleMapsKey(),
      v: "weekly",
      language: "de",
      region: "DE",
      loading: "async",
      libraries: "marker",
      callback: rueckruf,
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onerror = () => {
      ladevorgang = null;
      delete (window as any)[rueckruf];
      reject(new Error("Google Maps konnte nicht geladen werden (Schluessel, Domain-Freigabe oder Netz)."));
    };
    document.head.appendChild(s);
  });
  return ladevorgang;
}
