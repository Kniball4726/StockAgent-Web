import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  PedidoDetalleResponse,
  ProductoItemResponse,
  UsuarioResponse,
} from "@stockagent/shared";
import type {
  AdminNotificationRow,
  ChatMessageRow,
  ReplenishmentItemDto,
  StockAgentApiClient,
} from "../lib/api-client";
import { isAdminOrMaster } from "../lib/rbac";
import { AdminAlertsAndChatPanel } from "./dashboard/AdminAlertsAndChatPanel";
import { KpiSummaryGrid } from "./dashboard/KpiSummaryGrid";
import { ReplenishmentTablePanel } from "./dashboard/ReplenishmentTablePanel";

interface DashboardTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
  offlinePendingCount: number;
  lastEventTick: number;
  onGoToTab: (tab: "catalogo" | "cargas" | "inventario" | "despacho") => void;
}

export function DashboardTab({
  api,
  user,
  offlinePendingCount,
  lastEventTick,
  onGoToTab,
}: DashboardTabProps) {
  const [products, setProducts] = useState<ProductoItemResponse[]>([]);
  const [replenishment, setReplenishment] = useState<ReplenishmentItemDto[]>([]);
  const [onlyCritical, setOnlyCritical] = useState(true);
  const [orders, setOrders] = useState<PedidoDetalleResponse[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [notifications, setNotifications] = useState<AdminNotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = isAdminOrMaster(user.role);

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const [prodRes, repRes, ordRes, chatRes] = await Promise.all([
        api.searchProducts("", 500),
        api.getReplenishmentAnalysis(onlyCritical),
        api.listDispatchOrders("", 100),
        api.listChatMessages(40),
      ]);
      setProducts(prodRes.productos);
      setReplenishment(repRes.items);
      setOrders(ordRes.pedidos);
      setChatMessages(chatRes.mensajes);

      if (isAdmin) {
        const notifRes = await api.listNotifications(false, 20);
        setNotifications(notifRes.notificaciones);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar las métricas del tablero."
      );
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin, onlyCritical]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, lastEventTick]);

  async function handleSendChat(message: string) {
    try {
      await api.sendChatMessage(message, "Todos");
      const chatRes = await api.listChatMessages(40);
      setChatMessages(chatRes.mensajes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar mensaje.");
    }
  }

  async function handleMarkNotificationsRead() {
    try {
      await api.markNotificationsRead();
      const notifRes = await api.listNotifications(false, 20);
      setNotifications(notifRes.notificaciones);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudieron marcar alertas."
      );
    }
  }

  const totalUnits = products.reduce((sum, item) => sum + item.stock, 0);
  const zeroStockCount = products.filter((item) => item.stock <= 0).length;
  const armadosCount = orders.filter(
    (o) => o.estado_despacho === "armado"
  ).length;
  const despachadosCount = orders.filter(
    (o) => o.estado_despacho === "despachado"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Panel Operativo</h2>
          <p className="text-xs text-slate-400">
            Resumen en tiempo real del depósito · Tenant activo
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      <KpiSummaryGrid
        productsCount={products.length}
        totalUnits={totalUnits}
        replenishmentCount={replenishment.length}
        zeroStockCount={zeroStockCount}
        armadosCount={armadosCount}
        despachadosCount={despachadosCount}
        offlinePendingCount={offlinePendingCount}
        onGoToTab={onGoToTab}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <ReplenishmentTablePanel
          items={replenishment}
          onlyCritical={onlyCritical}
          onOnlyCriticalChange={setOnlyCritical}
        />
        <AdminAlertsAndChatPanel
          isAdmin={isAdmin}
          notifications={notifications}
          chatMessages={chatMessages}
          onMarkNotificationsRead={handleMarkNotificationsRead}
          onSendChatMessage={handleSendChat}
        />
      </div>
    </div>
  );
}
