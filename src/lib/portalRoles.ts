// Rollen & Rechte innerhalb eines B2B-Portals (Hotel/Event). Der Haupt-Account
// (Inhaber) gilt als OWNER mit allen Rechten. Sub-Nutzer haben eine der Rollen.

export type PortalRole = "OWNER" | "ADMIN" | "RECEPTION" | "ACCOUNTING" | "CONCIERGE" | "NIGHT" | "MANAGER";

export type PortalAction = "book" | "cancel" | "invoices" | "manageUsers" | "settings";

export const PORTAL_ROLES: { key: Exclude<PortalRole, "OWNER">; label: string; hint: string }[] = [
  { key: "ADMIN", label: "Admin", hint: "Alle Rechte" },
  { key: "RECEPTION", label: "Rezeption", hint: "Buchen & stornieren" },
  { key: "MANAGER", label: "Manager", hint: "Buchen, stornieren, Rechnungen" },
  { key: "CONCIERGE", label: "Concierge", hint: "Buchen" },
  { key: "NIGHT", label: "Nachtmanager", hint: "Buchen & stornieren" },
  { key: "ACCOUNTING", label: "Buchhaltung", hint: "Nur Rechnungen" },
];

const RIGHTS: Record<PortalRole, PortalAction[]> = {
  OWNER: ["book", "cancel", "invoices", "manageUsers", "settings"],
  ADMIN: ["book", "cancel", "invoices", "manageUsers", "settings"],
  MANAGER: ["book", "cancel", "invoices", "settings"],
  RECEPTION: ["book", "cancel"],
  NIGHT: ["book", "cancel"],
  CONCIERGE: ["book"],
  ACCOUNTING: ["invoices"],
};

export function portalRoleLabel(role: string | null | undefined): string {
  const r = (role ?? "OWNER") as PortalRole;
  if (r === "OWNER") return "Inhaber";
  return PORTAL_ROLES.find((x) => x.key === r)?.label ?? r;
}

export function portalCan(role: string | null | undefined, action: PortalAction): boolean {
  const r = (role ?? "OWNER") as PortalRole;
  return (RIGHTS[r] ?? RIGHTS.OWNER).includes(action);
}
