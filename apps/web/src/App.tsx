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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import { AdminIntegrationsTab } from "./components/AdminIntegrationsTab";
import { CatalogTab } from "./components/CatalogTab";
import { DashboardTab } from "./components/DashboardTab";
import { DispatchTab } from "./components/DispatchTab";
import { LoginView } from "./components/LoginView";
import { PhysicalInventoryTab } from "./components/PhysicalInventoryTab";
import { UploadsIngestionTab } from "./components/UploadsIngestionTab";
import { StockAgentApiClient } from "./lib/api-client";
import {
  OfflineDispatchQueue,
  type QueuedDispatchScan,
} from "./lib/offline-dispatch-queue";
import { canAccessTab, formatRoleLabel, type AppTabId } from "./lib/rbac";
import {
  StockAgentRealtimeClient,
  type WebSocketConnectionState,
} from "./lib/realtime-ws";

const SESSION_STORAGE_KEY = "stockagent_session_v1";

interface StoredSession {
  token: string;
  user: UsuarioResponse;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readInitialSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed && typeof parsed.token === "string" && parsed.user?.username) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveInitialTab(): AppTabId {
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

export interface AppProps {
  apiClient?: StockAgentApiClient;
  realtimeClient?: StockAgentRealtimeClient;
}

const NAV_ITEMS: Array<{
  id: AppTabId;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: "Tablero", shortLabel: "Inicio", icon: LayoutDashboard },
  { id: "catalogo", label: "Catálogo", shortLabel: "Stock", icon: Boxes },
  { id: "cargas", label: "Cargar Archivos", shortLabel: "Cargas", icon: FileUp },
  { id: "inventario", label: "Inventario Físico", shortLabel: "Conteo", icon: ClipboardList },
  { id: "despacho", label: "Despacho QR", shortLabel: "QR", icon: Truck },
  { id: "admin", label: "Administración", shortLabel: "Admin", icon: Settings },
];

export function App({ apiClient, realtimeClient }: AppProps = {}) {
  const [session, setSession] = useState<StoredSession | null>(() =>
    readInitialSession()
  );
  const tokenRef = useRef<string | null>(session?.token ?? null);
  tokenRef.current = session?.token ?? null;

  const [activeTab, setActiveTab] = useState<AppTabId>(() => resolveInitialTab());
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wsState, setWsState] = useState<WebSocketConnectionState>("disconnected");
  const [lastEventTick, setLastEventTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const handleClearSession = useCallback(() => {
    setSession(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // noop
      }
    }
  }, []);

  const api = useMemo(
    () =>
      apiClient ??
      new StockAgentApiClient({
        getToken: () => tokenRef.current,
        onUnauthorized: handleClearSession,
      }),
    [apiClient, handleClearSession]
  );

  const realtime = useMemo(
    () => realtimeClient ?? new StockAgentRealtimeClient(),
    [realtimeClient]
  );

  const tenantId = session?.user.tenant_id ?? "default";
  const offlineQueue = useMemo(
    () => new OfflineDispatchQueue(tenantId),
    [tenantId]
  );
  const [pendingScans, setPendingScans] = useState<QueuedDispatchScan[]>(() =>
    offlineQueue.list()
  );

  const refreshPendingScans = useCallback(() => {
    setPendingScans(offlineQueue.list());
  }, [offlineQueue]);

  useEffect(() => {
    refreshPendingScans();
  }, [refreshPendingScans]);

  const flushOfflineQueue = useCallback(async () => {
    const summary = await offlineQueue.flush((items) =>
      api.scanDispatchBatch(items)
    );
    refreshPendingScans();
    if (summary.syncedCount > 0 || summary.rejected.length > 0) {
      const msg =
        summary.rejected.length > 0
          ? `Cola sincronizada: ${summary.syncedCount} ok, ${summary.rejected.length} rechazado(s).`
          : `Cola offline sincronizada (${summary.syncedCount} escaneo/s).`;
      setToast(msg);
      setLastEventTick((t) => t + 1);
    }
  }, [api, offlineQueue, refreshPendingScans]);

  // Verificar token guardado al montar
  useEffect(() => {
    if (!session?.token || session.user.must_change_password) return;
    let active = true;
    void api
      .getMe()
      .then((freshUser) => {
        if (!active) return;
        const next: StoredSession = { token: session.token, user: freshUser };
        setSession(next);
        try {
          window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // noop
        }
      })
      .catch(() => {
        // onUnauthorized limpia la sesión si expiró
      });
    return () => {
      active = false;
    };
  }, [api, session?.token, session?.user.must_change_password]);

  // Listeners de conectividad Online/Offline + auto-sync al volver
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      setIsOnline(true);
      if (tokenRef.current && offlineQueue.list().length > 0) {
        void flushOfflineQueue();
      }
    };
    const onOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushOfflineQueue, offlineQueue]);

  // PWA Install Prompt
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  // Conexión WebSocket multi-tenant en vivo
  useEffect(() => {
    if (!session?.token || session.user.must_change_password) {
      realtime.disconnect();
      return;
    }

    const unsubStatus = realtime.onStatusChange(setWsState);
    const unsubEvents = realtime.onEvent((msg) => {
      if (msg.event === "domain_event") {
        setLastEventTick((n) => n + 1);
      }
    });

    realtime.connect(api.getBaseUrl(), session.token);

    return () => {
      unsubStatus();
      unsubEvents();
      realtime.disconnect();
    };
  }, [api, realtime, session?.token, session?.user.must_change_password]);

  // Auto-ocultar toasts
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  function handleLoginSuccess(token: string, user: UsuarioResponse) {
    const next: StoredSession = { token, user };
    setSession(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // noop
      }
    }
    if (!canAccessTab(user.role, activeTab)) {
      setActiveTab("dashboard");
    }
  }

  function handlePasswordChanged() {
    if (!session) return;
    const updated: StoredSession = {
      token: session.token,
      user: { ...session.user, must_change_password: false },
    };
    setSession(updated);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // noop
      }
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Continuar limpiando sesión local aunque falle red
    }
    realtime.disconnect();
    handleClearSession();
  }

  async function handleInstallPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const res = await installPrompt.userChoice;
    if (res.outcome === "accepted") {
      setInstallPrompt(null);
    }
  }

  if (!session || session.user.must_change_password) {
    return (
      <LoginView
        api={api}
        pendingPasswordChangeUser={
          session?.user.must_change_password ? session.user : null
        }
        onLoginSuccess={handleLoginSuccess}
        onPasswordChanged={handlePasswordChanged}
        onLogout={() => void handleLogout()}
      />
    );
  }

  const user = session.user;
  const visibleNav = NAV_ITEMS.filter((item) => canAccessTab(user.role, item.id));
  const safeTab = canAccessTab(user.role, activeTab) ? activeTab : "dashboard";

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
              const isActive = safeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                    isActive
                      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                  {item.id === "despacho" && pendingScans.length > 0 && (
                    <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 tabular-nums">
                      {pendingScans.length}
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
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
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

          {installPrompt && (
            <button
              type="button"
              onClick={() => void handleInstallPwa()}
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
            onClick={() => void handleLogout()}
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
          {installPrompt && (
            <button
              type="button"
              onClick={() => void handleInstallPwa()}
              className="rounded-lg border border-sky-500/40 bg-sky-500/15 p-1.5 text-sky-300"
              aria-label="Instalar aplicación"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
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

          {safeTab === "dashboard" && (
            <DashboardTab
              api={api}
              user={user}
              offlinePendingCount={pendingScans.length}
              lastEventTick={lastEventTick}
              onGoToTab={(tab) => setActiveTab(tab)}
            />
          )}
          {safeTab === "catalogo" && (
            <CatalogTab
              api={api}
              user={user}
              lastEventTick={lastEventTick}
            />
          )}
          {safeTab === "cargas" && (
            <UploadsIngestionTab api={api} user={user} />
          )}
          {safeTab === "inventario" && (
            <PhysicalInventoryTab api={api} user={user} />
          )}
          {safeTab === "despacho" && (
            <DispatchTab
              api={api}
              user={user}
              isOnline={isOnline}
              offlineQueue={offlineQueue}
              pendingScans={pendingScans}
              lastEventTick={lastEventTick}
              onQueueChanged={refreshPendingScans}
              onFlushQueue={flushOfflineQueue}
            />
          )}
          {safeTab === "admin" && (
            <AdminIntegrationsTab api={api} user={user} />
          )}
        </div>
      </main>

      {/* Bottom Navigation Mobile */}
      <nav
        aria-label="Navegación móvil"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-800 bg-slate-900/95 px-1 pt-1.5 backdrop-blur md:hidden"
      >
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const isActive = safeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[10px] font-medium ${
                isActive ? "text-sky-400" : "text-slate-400"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.shortLabel}</span>
              {item.id === "despacho" && pendingScans.length > 0 && (
                <span className="absolute -right-0.5 top-0.5 rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
                  {pendingScans.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default App;
