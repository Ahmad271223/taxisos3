// Schlanke SVG-Icons fuer Fahrzeugklassen (statt Emoji) – serioes & uber-aehnlich.
import type { ReactNode } from "react";

type IconProps = { className?: string };

function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

// Standard Limousine – schlanke Silhouette
export const IconStandard = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M6 26h52v6a2 2 0 0 1-2 2h-4a3 3 0 0 1-6 0H22a3 3 0 0 1-6 0h-6a4 4 0 0 1-4-4v-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M10 26 14 14a4 4 0 0 1 4-3h28a4 4 0 0 1 3 1.5L54 26" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M16 19h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="19" cy="34" r="3" fill="currentColor"/>
    <circle cx="45" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// Van / Großraum – hoehere Karosserie
export const IconVan = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M6 28h52v4a2 2 0 0 1-2 2h-5a3 3 0 0 1-6 0H21a3 3 0 0 1-6 0H8a2 2 0 0 1-2-2v-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M8 28V13a3 3 0 0 1 3-3h38a4 4 0 0 1 4 3l3 15" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M14 14h12v12H14zM30 14h14v12H30zM48 16l2 10" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    <circle cx="18" cy="34" r="3" fill="currentColor"/>
    <circle cx="46" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// Extra-Gepaeck (Kombi)
export const IconExtraLuggage = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M6 27h52v5a2 2 0 0 1-2 2h-5a3 3 0 0 1-6 0H21a3 3 0 0 1-6 0H8a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="2"/>
    <path d="M10 27 13 17a4 4 0 0 1 4-3h32a4 4 0 0 1 4 3l4 10" stroke="currentColor" strokeWidth="2"/>
    <path d="M17 21h28v6H17z" stroke="currentColor" strokeWidth="2"/>
    <circle cx="18" cy="34" r="3" fill="currentColor"/>
    <circle cx="46" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// Shuttle / Bus
export const IconShuttle = ({ className }: IconProps) => (
  <Wrap className={className}>
    <rect x="6" y="10" width="52" height="22" rx="3" stroke="currentColor" strokeWidth="2"/>
    <path d="M10 14h44M10 22h44" stroke="currentColor" strokeWidth="2"/>
    <path d="M20 14v8M32 14v8M44 14v8" stroke="currentColor" strokeWidth="2"/>
    <circle cx="16" cy="34" r="3" fill="currentColor"/>
    <circle cx="48" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// Business / Premium Limousine
export const IconBusiness = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M4 27h56v5a2 2 0 0 1-2 2h-4a3 3 0 0 1-6 0H20a3 3 0 0 1-6 0H6a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="2"/>
    <path d="M9 27 14 15a4 4 0 0 1 4-3h28a4 4 0 0 1 3.5 2L55 27" stroke="currentColor" strokeWidth="2"/>
    <path d="M16 20h32" stroke="currentColor" strokeWidth="2"/>
    <path d="M30 12v8" stroke="currentColor" strokeWidth="2"/>
    <circle cx="18" cy="34" r="3.2" fill="currentColor"/>
    <circle cx="46" cy="34" r="3.2" fill="currentColor"/>
  </Wrap>
);

// Wheelchair / Barrierefrei
export const IconWheelchair = ({ className }: IconProps) => (
  <Wrap className={className}>
    <rect x="8" y="12" width="48" height="20" rx="3" stroke="currentColor" strokeWidth="2"/>
    <circle cx="24" cy="22" r="4" stroke="currentColor" strokeWidth="2"/>
    <path d="M24 26v3h6M28 31h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M36 18h12M36 22h12" stroke="currentColor" strokeWidth="2"/>
    <circle cx="16" cy="34" r="3" fill="currentColor"/>
    <circle cx="48" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// Pet
export const IconPet = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M6 27h52v5a2 2 0 0 1-2 2h-5a3 3 0 0 1-6 0H21a3 3 0 0 1-6 0H8a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="2"/>
    <path d="M10 27 14 15a4 4 0 0 1 4-3h28a4 4 0 0 1 3.5 2L54 27" stroke="currentColor" strokeWidth="2"/>
    <circle cx="26" cy="19" r="2" fill="currentColor"/>
    <circle cx="32" cy="17" r="1.6" fill="currentColor"/>
    <circle cx="38" cy="17" r="1.6" fill="currentColor"/>
    <circle cx="44" cy="19" r="2" fill="currentColor"/>
    <ellipse cx="35" cy="23" rx="4" ry="3" fill="currentColor"/>
    <circle cx="18" cy="34" r="3" fill="currentColor"/>
    <circle cx="46" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// Child seat
export const IconChildSeat = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M6 27h52v5a2 2 0 0 1-2 2h-5a3 3 0 0 1-6 0H21a3 3 0 0 1-6 0H8a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="2"/>
    <path d="M10 27 14 15a4 4 0 0 1 4-3h28a4 4 0 0 1 3.5 2L54 27" stroke="currentColor" strokeWidth="2"/>
    <rect x="28" y="14" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
    <circle cx="33" cy="11" r="2" fill="currentColor"/>
    <circle cx="18" cy="34" r="3" fill="currentColor"/>
    <circle cx="46" cy="34" r="3" fill="currentColor"/>
  </Wrap>
);

// VIP
export const IconVIP = ({ className }: IconProps) => (
  <Wrap className={className}>
    <path d="M4 27h56v5a2 2 0 0 1-2 2h-4a3 3 0 0 1-6 0H20a3 3 0 0 1-6 0H6a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="2"/>
    <path d="M9 27 14 15a4 4 0 0 1 4-3h28a4 4 0 0 1 3.5 2L55 27" stroke="currentColor" strokeWidth="2"/>
    <path d="M16 20h32" stroke="currentColor" strokeWidth="2"/>
    <path d="m32 8 1.3 2.6 2.8.4-2 2 .5 2.8L32 14.5l-2.6 1.3.5-2.8-2-2 2.8-.4L32 8Z" fill="currentColor"/>
    <circle cx="18" cy="34" r="3.2" fill="currentColor"/>
    <circle cx="46" cy="34" r="3.2" fill="currentColor"/>
  </Wrap>
);

const MAP: Record<string, (p: IconProps) => JSX.Element> = {
  STANDARD: IconStandard,
  VAN: IconVan,
  EXTRA_LUGGAGE: IconExtraLuggage,
  SHUTTLE: IconShuttle,
  BUSINESS: IconBusiness,
  WHEELCHAIR: IconWheelchair,
  PET: IconPet,
  CHILD_SEAT: IconChildSeat,
  VIP: IconVIP,
};

export function VehicleIcon({ classKey, className }: { classKey?: string | null; className?: string }) {
  const C = MAP[classKey ?? "STANDARD"] ?? IconStandard;
  return <C className={className ?? "h-8 w-12 text-ink-900"} />;
}
