import { TrackingView } from "@/components/TrackingView";

export default function VerfolgenPage({ params }: { params: { id: string } }) {
  return <TrackingView id={params.id} />;
}
