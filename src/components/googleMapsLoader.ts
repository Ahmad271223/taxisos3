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

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps laeuft nur im Browser."));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);
  if (ladevorgang) return ladevorgang;

  ladevorgang = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: googleMapsKey(),
      v: "weekly",
      language: "de",
      region: "DE",
      loading: "async",
      libraries: "marker",
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onload = async () => {
      try {
        // Mit loading=async sind die Bibliotheken erst nach importLibrary da.
        await window.google.maps.importLibrary("maps");
        await window.google.maps.importLibrary("marker");
        resolve(window.google);
      } catch (e) {
        ladevorgang = null;
        reject(e);
      }
    };
    s.onerror = () => {
      ladevorgang = null;
      reject(new Error("Google Maps konnte nicht geladen werden (Schluessel, Domain-Freigabe oder Netz)."));
    };
    document.head.appendChild(s);
  });
  return ladevorgang;
}
