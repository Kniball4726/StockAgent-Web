import { useMemo, useState } from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import { AdminIntegrationsTab } from "./components/AdminIntegrationsTab";
import { CatalogTab } from "./components/CatalogTab";
import { DashboardTab } from "./components/DashboardTab";
import { DispatchTab } from "./components/DispatchTab";
import {
  AppShellLayout,
  resolveInitialTab,
} from "./components/layout/AppShellLayout";
import { LoginView } from "./components/LoginView";
import { PhysicalInventoryTab } from "./components/PhysicalInventoryTab";
import { UploadsIngestionTab } from "./components/UploadsIngestionTab";
import { useConnectivityAndRealtime } from "./hooks/useConnectivityAndRealtime";
import { useSessionState, useVerifyStoredSession } from "./hooks/useSession";
import { StockAgentApiClient } from "./lib/api-client";
import { canAccessTab, type AppTabId } from "./lib/rbac";
import { StockAgentRealtimeClient } from "./lib/realtime-ws";

export interface AppProps {
  apiClient?: StockAgentApiClient;
  realtimeClient?: StockAgentRealtimeClient;
}

export function App({ apiClient, realtimeClient }: AppProps = {}) {
  const {
    session,
    tokenRef,
    setSession,
    clearSession,
    saveLoginSession,
    markPasswordChanged,
  } = useSessionState();

  const [activeTab, setActiveTab] = useState<AppTabId>(() =>
    resolveInitialTab()
  );

  const api = useMemo(
    () =>
      apiClient ??
      new StockAgentApiClient({
        getToken: () => tokenRef.current,
        onUnauthorized: clearSession,
      }),
    [apiClient, clearSession, tokenRef]
  );

  const realtime = useMemo(
    () => realtimeClient ?? new StockAgentRealtimeClient(),
    [realtimeClient]
  );

  useVerifyStoredSession(api, session, setSession);

  const {
    isOnline,
    wsState,
    lastEventTick,
    toast,
    installPrompt,
    offlineQueue,
    pendingScans,
    refreshPendingScans,
    flushOfflineQueue,
    handleInstallPwa,
  } = useConnectivityAndRealtime({ api, realtime, session, tokenRef });

  function handleLoginSuccess(token: string, user: UsuarioResponse) {
    saveLoginSession(token, user);
    if (!canAccessTab(user.role, activeTab)) {
      setActiveTab("dashboard");
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Continuar limpiando sesión local aunque falle red
    }
    realtime.disconnect();
    clearSession();
  }

  if (!session || session.user.must_change_password) {
    return (
      <LoginView
        api={api}
        pendingPasswordChangeUser={
          session?.user.must_change_password ? session.user : null
        }
        onLoginSuccess={handleLoginSuccess}
        onPasswordChanged={markPasswordChanged}
        onLogout={() => void handleLogout()}
      />
    );
  }

  const user = session.user;
  const safeTab = canAccessTab(user.role, activeTab) ? activeTab : "dashboard";

  return (
    <AppShellLayout
      user={user}
      activeTab={safeTab}
      onSelectTab={setActiveTab}
      isOnline={isOnline}
      wsState={wsState}
      pendingScansCount={pendingScans.length}
      canInstallPwa={Boolean(installPrompt)}
      onInstallPwa={() => void handleInstallPwa()}
      onLogout={() => void handleLogout()}
      toast={toast}
    >
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
        <CatalogTab api={api} user={user} lastEventTick={lastEventTick} />
      )}
      {safeTab === "cargas" && <UploadsIngestionTab api={api} user={user} />}
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
      {safeTab === "admin" && <AdminIntegrationsTab api={api} user={user} />}
    </AppShellLayout>
  );
}

export default App;
