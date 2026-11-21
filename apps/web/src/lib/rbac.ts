import type { UserRole } from "@stockagent/shared";

export type AppTabId =
  | "dashboard"
  | "catalogo"
  | "cargas"
  | "inventario"
  | "despacho"
  | "admin";

export function isAdminOrMaster(role: UserRole): boolean {
  return role === "master" || role === "administrador";
}

export function canMutateCatalog(role: UserRole): boolean {
  return role === "master" || role === "administrador" || role === "operador";
}

export function canUploadAndConfirm(role: UserRole): boolean {
  return (
    role === "master" ||
    role === "administrador" ||
    role === "operador" ||
    role === "picker"
  );
}

export function canOperateDispatch(role: UserRole): boolean {
  return (
    role === "master" ||
    role === "administrador" ||
    role === "operador" ||
    role === "picker"
  );
}

export function canRunPhysicalInventory(role: UserRole): boolean {
  return (
    role === "master" ||
    role === "administrador" ||
    role === "operador" ||
    role === "picker"
  );
}

export function canAccessTab(role: UserRole, tab: AppTabId): boolean {
  if (tab === "admin") {
    return isAdminOrMaster(role);
  }
  return true;
}

export function formatRoleLabel(role: UserRole): string {
  switch (role) {
    case "master":
      return "Master";
    case "administrador":
      return "Administrador";
    case "operador":
      return "Operador";
    case "picker":
      return "Picker";
    case "consulta":
      return "Consulta";
  }
}

export function formatDateTime(isoOrDate: string | Date | null | undefined): string {
  if (!isoOrDate) return "—";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** idx;
  return `${idx === 0 ? val : val.toFixed(1)} ${units[idx]}`;
}
