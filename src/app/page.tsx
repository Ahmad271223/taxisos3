import { LiveTaxiMap } from "@/components/LiveTaxiMap";

// Die Live-Karte ist die Startseite: Wer die Adresse aufruft, sieht sofort die
// verfuegbaren Taxis, kann oben ein Ziel suchen und mit einem Tipp bestellen.
// Die fruehere Vorstellungsseite (Ablauf, Unternehmen) liegt unter /info.
export const dynamic = "force-dynamic";
export const metadata = { title: "TaxiOS – Taxi bestellen in Hannover" };

export default function StartPage() {
  return <LiveTaxiMap />;
}
