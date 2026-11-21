import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { StockAgentApiClient } from "../lib/api-client";
import {
  OfflineDispatchQueue,
  type QueuedDispatchScan,
} from "../lib/offline-dispatch-queue";
import type {
  StockAgentRealtimeClient,
  WebSocketConnectionState,
} from "../lib/realtime-ws";
import type { StoredSession } from "./useSession";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useConnectivityAndRealtime(params: {
  api: StockAgentApiClient;
  realtime: StockAgentRealtimeClient;
  session: StoredSession | null;
  tokenRef: RefObject<string | null>;
}) {
  const { api, realtime, session, tokenRef } = params;

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wsState, setWsState] =
    useState<WebSocketConnectionState>("disconnected");
  const [lastEventTick, setLastEventTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

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
  }, [flushOfflineQueue, offlineQueue, tokenRef]);

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

  const handleInstallPwa = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const res = await installPrompt.userChoice;
    if (res.outcome === "accepted") {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  return {
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
  };
}
