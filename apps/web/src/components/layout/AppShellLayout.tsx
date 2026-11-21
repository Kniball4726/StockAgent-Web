import {
  Boxes,
  ClipboardList,
  Download,
  FileUp,
  LayoutDashboard,
  LogOut,
  Radio,
  Settings,
  Truck,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import { canAccessTab, formatRoleLabel, type AppTabId } from "../../lib/rbac";
import type { WebSocketConnectionState } from "../../lib/realtime-ws";

export const NAV_ITEMS: Array<{
  id: AppTabId;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: "Tablero", shortLabel: "Inicio", icon: LayoutDashboard },
  { id: "catalogo", label: "Catálogo", shortLabel: "Stock", icon: Boxes },
  { id: "cargas", label: "Cargar Archivos", shortLabel: "Cargas", icon: FileUp },
  {
    id: "inventario",
    label: "Inventario Físico",
    shortLabel: "Conteo",
    icon: ClipboardList,
  },
  { id: "despacho", label: "Despacho QR", shortLabel: "QR", icon: Truck },
  { id: "admin", label: "Administración", shortLabel: "Admin", icon: Settings },
];

export function resolveInitialTab(): AppTabId {
  if (typeof window === "undefined") return "dashboard";
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (
    tab === "dashboard" ||
    tab === "catalogo" ||
    tab === "cargas" ||
    tab === "inventario" ||
    tab === "despacho" ||
    tab === "admin"
  ) {
    return tab;
  }
  return "dashboard";
}

interface AppShellLayoutProps {
  user: UsuarioResponse;
  activeTab: AppTabId;
  onSelectTab: (tab: AppTabId) => void;
  isOnline: boolean;
  wsState: WebSocketConnectionState;
  pendingScansCount: number;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
  onLogout: () => void;
  toast: string | null;
  children: ReactNode;
}

export function AppShellLayout({
  user,
  activeTab,
  onSelectTab,
  isOnline,
  wsState,
  pendingScansCount,
  canInstallPwa,
  onInstallPwa,
  onLogout,
  toast,
  children,
}: AppShellLayoutProps) {
  const visibleNav = NAV_ITEMS.filter((item) =>
    canAccessTab(user.role, item.id)
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-slate-800 bg-slate-900/90 p-4 md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">
                StockAgent
              </h1>
              <p className="text-[11px] text-slate-400">Depósito Multi-Tenant</p>
            </div>
          </div>

          <nav className="space-y-1" aria-label="Navegación principal">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                    isActive
                      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                  {item.id === "despacho" && pendingScansCount > 0 && (
                    <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 tabular-nums">
                      {pendingScansCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                isOnline
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {isOnline ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              {isOnline ? "Online" : "Offline"}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                wsState === "connected"
                  ? "bg-sky-500/15 text-sky-300"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              <Radio className="h-3 w-3" />
              {wsState === "connected"
                ? "WS Live"
                : wsState === "reconnecting"
                  ? "Reconectando"
                  : "WS Off"}
            </span>
          </div>

          {canInstallPwa && (
            <button
              type="button"
              onClick={onInstallPwa}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
            >
              <Download className="h-3.5 w-3.5" />
              Instalar PWA
            </button>
          )}

          <div className="rounded-xl bg-slate-950/70 p-2.5 text-xs">
            <p className="font-semibold text-white truncate">
              {user.nombre || user.username}
            </p>
            <p className="text-[11px] text-slate-400">
              @{user.username} · {formatRoleLabel(user.role)}
            </p>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Topbar Mobile */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-sky-400" />
          <span className="text-sm font-bold text-white">StockAgent</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isOnline
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-rose-500/20 text-rose-300"
            }`}
          >
            {isOnline ? "Online" : "Offline"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canInstallPwa && (
            <button
              type="button"
              onClick={onInstallPwa}
              className="rounded-lg border border-sky-500/40 bg-sky-500/15 p-1.5 text-sky-300"
              aria-label="Instalar aplicación"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-slate-700 p-1.5 text-slate-300"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-4 py-5 pb-24 md:px-8 md:py-6 md:pb-8">
        <div className="mx-auto max-w-6xl">
          {toast && (
            <div
              role="status"
              className="mb-4 rounded-xl border border-sky-500/40 bg-sky-500/15 px-4 py-2.5 text-xs font-medium text-sky-200"
            >
              {toast}
            </div>
          )}
          {children}
        </div>
      </main>

      {/* Bottom Navigation Mobile */}
      <nav
        aria-label="Navegación móvil"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-800 bg-slate-900/95 px-1 pt-1.5 backdrop-blur md:hidden"
      >
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[10px] font-medium ${
                isActive ? "text-sky-400" : "text-slate-400"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.shortLabel}</span>
              {item.id === "despacho" && pendingScansCount > 0 && (
                <span className="absolute -right-0.5 top-0.5 rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
                  {pendingScansCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
