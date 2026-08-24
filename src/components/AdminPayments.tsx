"use client";

import { useEffect, useState } from "react";
import { formatEuro, formatDateTime } from "@/lib/format";

// Zahlungsuebersicht fuer das Taxiunternehmen: welche abgeschlossenen Fahrten
// sind bezahlt, welche stehen noch aus. Eine Fahrt gilt NICHT als bezahlt,
// solange die Kartenbelastung nicht durchgelaufen ist.

interface Ride {
  id: string;
  customerName: string;
  route: string;
  driver: string | null;
  completedAt: string | null;
  fare: number;
  tip: number;
  total: number;
  paymentMethod: string;
  paymentError: string | null;
  statusKey: "BEZAHLT" | "AUSSTEHEND" | "LAEUFT" | "BAR" | "FIRMA";
  statusText: string;
}

const BADGE: Record<string, string> = {
  BEZAHLT: "bg-green-100 text-green-800",
  AUSSTEHEND: "bg-red-100 text-red-700",
  LAEUFT: "bg-brand-100 text-ink-900",
  BAR: "bg-ink-100 text-ink-700",
  FIRMA: "bg-blue-100 text-blue-800",
};

export function AdminPayments() {
  const [data, setData] = useState<any | null>(null);
  const [filter, setFilter] = useState<"offen" | "alle">("offen");

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/payments")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
        .catch(() => {});
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, []);

  if (!data) return null;
  const rides: Ride[] = data.rides ?? [];
  const shown = filter === "offen" ? rides.filter((r) => r.statusKey === "AUSSTEHEND" || r.statusKey === "LAEUFT") : rides;

  return (
    <div className="card p-5" data-testid="admin-payments">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold text-ink-900">Zahlungen</h2>
          <p className="text-sm text-ink-500">Fahrpreise gehen zu 100 % an Sie – wir behalten keine Provision ein.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-ink-100 p-1">
          {(["offen", "alle"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              data-testid={`payments-filter-${f}`}
              className={`rounded-lg px-3 py-1 text-sm font-bold transition ${
                filter === f ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
              }`}
            >
              {f === "offen" ? `Offen (${data.openCount ?? 0})` : "Alle"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-green-50 p-3">
          <p className="text-xs font-semibold text-green-800">Bezahlt (30 Tage)</p>
          <p className="font-display text-xl font-extrabold text-green-900" data-testid="payments-paid">
            {formatEuro(data.paidAmount ?? 0)}
          </p>
        </div>
        <div className="rounded-xl bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-700">Zahlung ausstehend</p>
          <p className="font-display text-xl font-extrabold text-red-800" data-testid="payments-open">
            {formatEuro(data.openAmount ?? 0)}
          </p>
        </div>
        <div className="rounded-xl bg-ink-50 p-3">
          <p className="text-xs font-semibold text-ink-600">Bar erhalten</p>
          <p className="font-display text-xl font-extrabold text-ink-900" data-testid="payments-cash">
            {formatEuro(data.cashAmount ?? 0)}
          </p>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-xl bg-ink-50 px-3 py-3 text-sm text-ink-500">
          {filter === "offen" ? "Keine offenen Zahlungen." : "Noch keine abgeschlossenen Fahrten."}
        </p>
      ) : (
        <div className="mt-4 grid gap-2">
          {shown.slice(0, 50).map((r) => (
            <div
              key={r.id}
              data-testid={`payment-row-${r.id}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900">{r.route}</p>
                <p className="text-xs text-ink-500">
                  {r.customerName}
                  {r.driver ? ` · ${r.driver}` : ""} · {formatDateTime(r.completedAt)}
                </p>
                {r.paymentError && (
                  <p className="mt-1 text-xs font-semibold text-red-700">{r.paymentError}</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-bold text-ink-900">{formatEuro(r.total)}</p>
                {r.tip > 0 && <p className="text-[11px] text-ink-500">inkl. {formatEuro(r.tip)} Trinkgeld</p>}
              </div>
              <span
                data-testid={`payment-status-${r.id}`}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${BADGE[r.statusKey] ?? "bg-ink-100"}`}
              >
                {r.statusText}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
