interface ResolvedPickup {
  airportName: string;
  airportIata: string;
  zone: { code: string; label: string; lat: number; lng: number };
}

// Treffpunkt-Karte für Flughafen-Abholungen: benannter Pickup-Point + Zone +
// GPS-Karten-Link (Navigation für Fahrgast und Fahrer).
export function PickupZoneCard({ pickup, role = "Treffpunkt" }: { pickup: ResolvedPickup; role?: string }) {
  const { zone } = pickup;
  const maps = `https://www.google.com/maps/search/?api=1&query=${zone.lat},${zone.lng}`;
  return (
    <div className="rounded-2xl border-2 border-ink-200 bg-white p-3" data-testid="pickup-zone">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{role} · {pickup.airportName} ({pickup.airportIata})</p>
      <p className="mt-0.5 font-display text-base font-extrabold text-ink-900">📍 {zone.label}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="rounded-lg bg-ink-900 px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-brand-500">Zone {zone.code}</span>
        <a href={maps} target="_blank" rel="noreferrer" data-testid="pickup-maps" className="text-sm font-bold text-ink-700 underline underline-offset-2 hover:text-ink-900">In Karte öffnen</a>
      </div>
    </div>
  );
}
