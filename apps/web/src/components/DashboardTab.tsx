import {
  AlertTriangle,
  Bell,
  Boxes,
  CheckCheck,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Send,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { formatDateTime, isAdminOrMaster } from "../lib/rbac";

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
  const [chatDraft, setChatDraft] = useState("");
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

  async function handleSendChat(e: FormEvent) {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    try {
      await api.sendChatMessage(chatDraft.trim(), "Todos");
      setChatDraft("");
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
      setError(err instanceof Error ? err.message : "No se pudieron marcar alertas.");
    }
  }

  const totalUnits = products.reduce((sum, item) => sum + item.stock, 0);
  const zeroStockCount = products.filter((item) => item.stock <= 0).length;
  const armadosCount = orders.filter((o) => o.estado_despacho === "armado").length;
  const despachadosCount = orders.filter((o) => o.estado_despacho === "despachado").length;
  const unreadNotifs = notifications.filter((n) => !n.isRead).length;

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onGoToTab("catalogo")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left transition hover:border-sky-500/40"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Catálogo Activo</span>
            <Boxes className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white tabular-nums">
            {products.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
            {totalUnits.toLocaleString("es-AR")} unidades totales
          </p>
        </button>

        <button
          type="button"
          onClick={() => onGoToTab("catalogo")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left transition hover:border-amber-500/40"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Alertas de Reposición</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-300 tabular-nums">
            {replenishment.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
            {zeroStockCount} agotados (stock ≤ 0)
          </p>
        </button>

        <button
          type="button"
          onClick={() => onGoToTab("despacho")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left transition hover:border-emerald-500/40"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Pedidos Armados</span>
            <PackageCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white tabular-nums">
            {armadosCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
            {despachadosCount} despachados
          </p>
        </button>

        <button
          type="button"
          onClick={() => onGoToTab("despacho")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left transition hover:border-sky-500/40"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Cola Offline QR</span>
            <Truck className="h-4 w-4 text-sky-400" />
          </div>
          <p
            className={`mt-2 text-2xl font-bold tabular-nums ${
              offlinePendingCount > 0 ? "text-amber-300" : "text-emerald-300"
            }`}
          >
            {offlinePendingCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {offlinePendingCount > 0
              ? "Pendientes de sincronizar"
              : "Sin escaneos pendientes"}
          </p>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Análisis de Reposición Inteligente
              </h3>
              <p className="text-xs text-slate-400">
                Basado en stock mínimo y máximo configurado en PostgreSQL
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={onlyCritical}
                onChange={(e) => setOnlyCritical(e.target.checked)}
                className="rounded border-slate-600 bg-slate-950 text-sky-500"
              />
              Solo críticos / agotados
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">SKU</th>
                  <th className="py-2 pr-3 font-medium">Producto</th>
                  <th className="py-2 pr-3 font-medium text-right">Stock</th>
                  <th className="py-2 pr-3 font-medium text-right">Mín</th>
                  <th className="py-2 pr-3 font-medium text-right">Pedir</th>
                  <th className="py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {replenishment.slice(0, 12).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="py-2 pr-3 font-mono font-medium text-sky-300">
                      {item.code}
                    </td>
                    <td className="py-2 pr-3 text-slate-200">{item.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white font-semibold">
                      {item.stock}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-400">
                      {item.stockMinimo}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-emerald-300 font-medium">
                      {item.cantidadSugeridaPedir > 0
                        ? `+${item.cantidadSugeridaPedir}`
                        : "—"}
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.estadoInventario === "AGOTADO"
                            ? "bg-rose-500/20 text-rose-300"
                            : item.estadoInventario === "QUIEBRE_INMINENTE"
                              ? "bg-amber-500/20 text-amber-300"
                              : item.estadoInventario === "SOBRESTOCK"
                                ? "bg-indigo-500/20 text-indigo-300"
                                : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {item.estadoInventario}
                      </span>
                    </td>
                  </tr>
                ))}
                {replenishment.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No hay alertas críticas de reposición.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          {isAdmin && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Alertas Admin ({unreadNotifs})
                  </h3>
                </div>
                {unreadNotifs > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleMarkNotificationsRead()}
                    className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Marcar leídas
                  </button>
                )}
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {notifications.slice(0, 6).map((n) => (
                  <div
                    key={n.id}
                    className={`rounded-xl border p-2.5 text-xs ${
                      n.isRead
                        ? "border-slate-800 bg-slate-950/50 text-slate-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                    }`}
                  >
                    <p className="font-semibold">{n.title}</p>
                    <p className="mt-0.5 opacity-90">{n.message}</p>
                    <p className="mt-1 text-[10px] opacity-70">
                      {n.operatorUsername} · {formatDateTime(n.createdAt)}
                    </p>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <p className="text-xs text-slate-500">Sin notificaciones registradas.</p>
                )}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-semibold text-white">
                Chat del Depósito
              </h3>
            </div>
            <div className="mb-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {chatMessages.slice(-15).map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-800/80 bg-slate-950/70 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-semibold text-sky-300">{m.emisor}</span>
                    <span>{formatDateTime(m.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-slate-200">{m.mensaje}</p>
                </div>
              ))}
              {chatMessages.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-500">
                  Aún no hay mensajes internos.
                </p>
              )}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-2">
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder="Mensaje para el equipo..."
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl bg-sky-500 px-3 py-2 text-slate-950 hover:bg-sky-400"
                aria-label="Enviar mensaje"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
