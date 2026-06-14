import Link from "next/link";

export function Brand({
  href = "/",
  subtitle,
  tone = "dark",
}: {
  href?: string;
  subtitle?: string;
  tone?: "dark" | "light";
}) {
  const title = tone === "light" ? "text-white" : "text-ink-900";
  const sub = tone === "light" ? "text-ink-300" : "text-ink-500";
  return (
    <Link href={href} data-testid="brand-logo" className="group flex items-center gap-3">
      {/* Goldenes Taxi-App-Icon (zugleich Favicon, src/app/icon.png) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="TaxiOS"
        className="h-14 w-14 shrink-0 transition group-hover:-translate-y-0.5"
      />
      <span className="leading-tight">
        <span className={`block font-display text-lg font-extrabold tracking-tight ${title}`}>
          Taxi<span className="text-brand-500">OS</span>
        </span>
        {subtitle && <span className={`block text-xs font-semibold ${sub}`}>{subtitle}</span>}
      </span>
    </Link>
  );
}
