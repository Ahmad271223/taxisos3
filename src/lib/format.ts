export function formatEuro(value: number | null | undefined): string {
  if (value == null) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return "–";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "–";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} Std. ${m} Min.`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-DE", { timeStyle: "short" }).format(d);
}

// Flugzeiten (AviationStack) sind lokale Flughafenzeit, aber mit unzuverlässigem
// Offset (oft +00:00). Daher die Wandzeit literal aus dem ISO-String lesen, ohne
// Zeitzonen-Umrechnung – sonst verschiebt sich die Anzeige (z. B. 17:55 -> 19:55).
export function formatFlightLocal(iso: string | null | undefined): string {
  if (!iso) return "–";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return formatDateTime(iso);
  return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`;
}

export function flightLocalTimeOnly(iso: string | null | undefined): string {
  if (!iso) return "–";
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "–";
}
