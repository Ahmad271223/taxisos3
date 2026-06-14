import { LiveTaxiMap } from "@/components/LiveTaxiMap";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live-Taxikarte – TaxiOS" };

export default function TaxisPage() {
  return <LiveTaxiMap />;
}
