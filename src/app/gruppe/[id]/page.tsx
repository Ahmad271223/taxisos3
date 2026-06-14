import { GroupTracking } from "@/components/GroupTracking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gruppenfahrt verfolgen – TaxiOS" };

export default function GroupTrackingPage({ params }: { params: { id: string } }) {
  return <GroupTracking groupId={params.id} />;
}
