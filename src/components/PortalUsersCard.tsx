"use client";

import { useCallback, useEffect, useState } from "react";
import { PORTAL_ROLES, portalRoleLabel } from "@/lib/portalRoles";

// Sub-Nutzer-/Rollen-Verwaltung für Hotel- und Event-Portal. Selbst-gated:
// liefert die API 403 (keine Berechtigung), wird die Karte nicht angezeigt.
export function PortalUsersCard() {
  const [allowed, setAllowed] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const empty = { name: "", email: "", password: "", role: "RECEPTION" };
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    const res = await fetch("/api/portal/users").catch(() => null);
    if (!res || !res.ok) { setAllowed(false); return; }
    setAllowed(true);
    const d = await res.json();
    setUsers(d.users ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/portal/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json(); setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Fehlgeschlagen.");
    setForm(empty); setOpen(false); load();
  }
  async function remove(u: any) {
    if (!window.confirm(`Nutzer „${u.name}" löschen?`)) return;
    await fetch(`/api/portal/users/${u.id}`, { method: "DELETE" }).catch(() => {});
    load();
  }
  async function toggle(u: any) {
    await fetch(`/api/portal/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !u.active }) }).catch(() => {});
    load();
  }

  if (!allowed) return null;

  return (
    <div className="card p-6" data-testid="portal-users">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Benutzer &amp; Rollen</h2>
        <button onClick={() => setOpen((o) => !o)} className="text-sm font-bold text-brand-700 hover:underline">{open ? "Schließen" : "+ Neuer Nutzer"}</button>
      </div>
      <p className="mb-3 text-xs text-ink-500">Sub-Nutzer (z. B. Rezeption, Buchhaltung) mit eigenem Login. Jede Rolle darf nur bestimmte Aktionen.</p>
      {open && (
        <div className="mb-4 grid gap-2 rounded-2xl border border-ink-100 p-3 sm:grid-cols-2">
          <input className="field" data-testid="pu-name" placeholder="Name *" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input className="field" type="email" data-testid="pu-email" placeholder="E-Mail (Login) *" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input className="field" type="password" data-testid="pu-password" placeholder="Passwort (min. 6) *" value={form.password} onChange={(e) => set("password", e.target.value)} />
          <select className="field" data-testid="pu-role" value={form.role} onChange={(e) => set("role", e.target.value)}>
            {PORTAL_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label} – {r.hint}</option>)}
          </select>
          {msg && <p className="text-sm font-semibold text-red-600 sm:col-span-2" data-testid="pu-msg">{msg}</p>}
          <button onClick={add} disabled={busy} data-testid="pu-save" className="btn-primary sm:col-span-2 disabled:opacity-60">{busy ? "…" : "Nutzer anlegen"}</button>
        </div>
      )}
      <div className="grid gap-2">
        {users.map((u) => (
          <div key={u.id} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${u.active ? "bg-ink-50" : "bg-white opacity-60"}`} data-testid={`pu-${u.id}`}>
            <span className="min-w-0">
              <span className="font-bold text-ink-900">{u.name}</span>
              <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-ink-900">{portalRoleLabel(u.role)}</span>
              <span className="block truncate text-xs text-ink-500">{u.email}{!u.active ? " · deaktiviert" : ""}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <button onClick={() => toggle(u)} className="text-xs font-bold text-ink-600 hover:underline">{u.active ? "Deaktivieren" : "Aktivieren"}</button>
              <button onClick={() => remove(u)} className="text-xs font-bold text-red-600 hover:underline">Löschen</button>
            </span>
          </div>
        ))}
        {users.length === 0 && <p className="text-sm text-ink-400">Noch keine Sub-Nutzer.</p>}
      </div>
    </div>
  );
}
