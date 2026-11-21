import {
  Camera,
  CloudOff,
  Lock,
  QrCode,
  RefreshCw,
  Trash2,
  Unlock,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { PedidoDetalleResponse, UsuarioResponse } from "@stockagent/shared";
import { ApiClientError, type StockAgentApiClient } from "../lib/api-client";
import { extraerCodigoDespacho } from "../lib/barcode-scanner";
import type {
  DispatchStatusTarget,
  OfflineDispatchQueue,
  QueuedDispatchScan,
} from "../lib/offline-dispatch-queue";
import { canOperateDispatch, formatDateTime } from "../lib/rbac";
import { CameraScannerModal } from "./CameraScannerModal";

interface DispatchTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
  isOnline: boolean;
  offlineQueue: OfflineDispatchQueue;
  pendingScans: QueuedDispatchScan[];
  lastEventTick: number;
  onQueueChanged: () => void;
  onFlushQueue: () => Promise<void>;
}

export function DispatchTab({
  api,
  user,
  isOnline,
  offlineQueue,
  pendingScans,
  lastEventTick,
  onQueueChanged,
  onFlushQueue,
}: DispatchTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [orders, setOrders] = useState<PedidoDetalleResponse[]>([]);
  const [selectedOrder, setSelectedOrder] =
    useState<PedidoDetalleResponse | null>(null);
  const [qrInput, setQrInput] = useState("");
  const [targetState, setTargetState] =
    useState<DispatchStatusTarget>("despachado");
  const [scannerOpen, setScannerOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<{
    type: "ok" | "warn" | "err";
    text: string;
  } | null>(null);

  const canScan = canOperateDispatch(user.role);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDispatchOrders(statusFilter, 120);
      setOrders(res.pedidos);
    } catch (err) {
      if (isOnline) {
        setBanner({
          type: "err",
          text:
            err instanceof Error
              ? err.message
              : "No se pudieron cargar los pedidos de despacho.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [api, isOnline, statusFilter]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders, lastEventTick]);

  async function processQrCode(raw: string) {
    const cleaned = extraerCodigoDespacho(raw);
    if (!cleaned) return;
    setQrInput("");

    if (!isOnline) {
      offlineQueue.enqueue(cleaned, targetState, "Modo offline activo");
      onQueueChanged();
      setBanner({
        type: "warn",
        text: `Sin conexión: ${cleaned} (${targetState}) guardado en la cola offline para sincronizar luego.`,
      });
      return;
    }

    try {
      const res = await api.scanDispatch(cleaned, targetState);
      setSelectedOrder(res.pedido);
      setBanner({
        type: "ok",
        text: `${res.mensaje} — Pedido ${res.pedido.nota_pedido} → ${res.pedido.estado_despacho.toUpperCase()}`,
      });
      await loadOrders();
    } catch (err) {
      if (err instanceof ApiClientError && err.isNetworkError) {
        offlineQueue.enqueue(cleaned, targetState, err.message);
        onQueueChanged();
        setBanner({
          type: "warn",
          text: `Fallo de red: ${cleaned} guardado en cola offline.`,
        });
        return;
      }
      setBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo procesar el escaneo de despacho.",
      });
    }
  }

  async function handleQrSubmit(e: FormEvent) {
    e.preventDefault();
    await processQrCode(qrInput);
  }

  async function handleFlush() {
    setSyncing(true);
    try {
      await onFlushQueue();
      await loadOrders();
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleLock(order: PedidoDetalleResponse, lock: boolean) {
    try {
      if (lock) {
        const res = await api.acquireOrderLock(order.id);
        setBanner({
          type: res.acquired ? "ok" : "warn",
          text: res.acquired
            ? `Lock adquirido para pedido ${order.nota_pedido}.`
            : `El pedido está bloqueado por ${res.lockedBy || "otro usuario"}.`,
        });
      } else {
        await api.releaseOrderLock(order.id);
        setBanner({
          type: "ok",
          text: `Lock liberado para pedido ${order.nota_pedido}.`,
        });
      }
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error gestionando lock del pedido.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Despacho QR y Cola Offline
          </h2>
          <p className="text-xs text-slate-400">
            Escaneo continuo de remitos/etiquetas con resiliencia ante cortes de Wi-Fi
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadOrders()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refrescar
        </button>
      </div>

      {banner && (
        <div
          role={banner.type === "err" ? "alert" : "status"}
          className={`rounded-xl border p-3 text-xs ${
            banner.type === "err"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : banner.type === "warn"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {pendingScans.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <CloudOff className="h-4 w-4 text-amber-400" />
              Cola Offline ({pendingScans.length} escaneo/s pendiente/s)
            </div>
            <button
              type="button"
              disabled={!isOnline || syncing}
              onClick={() => void handleFlush()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-40"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              {syncing ? "Sincronizando..." : "Sincronizar Lote Ahora"}
            </button>
          </div>
          <div className="space-y-1.5">
            {pendingScans.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl bg-slate-950/70 px-3 py-2 text-xs text-slate-200"
              >
                <div>
                  <span className="font-mono font-semibold text-amber-300">
                    {item.codigo}
                  </span>{" "}
                  → <span className="uppercase">{item.nuevo_estado}</span> ·{" "}
                  <span className="text-slate-400">
                    {formatDateTime(item.queuedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    offlineQueue.remove(item.id);
                    onQueueChanged();
                  }}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
                  aria-label={`Eliminar ${item.codigo} de la cola`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {canScan && (
        <form
          onSubmit={handleQrSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 flex flex-wrap gap-2 items-center"
        >
          <select
            value={targetState}
            onChange={(e) => setTargetState(e.target.value as DispatchStatusTarget)}
            aria-label="Estado destino del escaneo"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"
          >
            <option value="despachado">Marcar Despachado</option>
            <option value="entregado">Marcar Entregado</option>
            <option value="armado">Volver a Armado</option>
          </select>

          <div className="relative flex-1 min-w-[220px]">
            <QrCode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-400" />
            <input
              type="text"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="Escanear QR remito (ej: REMITO:NP-001|BULTO:1/2 o NP-001)..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            {isOnline ? "Confirmar QR" : "Encolar Offline"}
          </button>

          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
          >
            <Camera className="h-4 w-4" />
            Cámara QR
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          { value: "", label: "Todos" },
          { value: "armado", label: "Armados" },
          { value: "despachado", label: "Despachados" },
          { value: "entregado", label: "Entregados" },
        ].map((pill) => (
          <button
            key={pill.value || "all"}
            type="button"
            onClick={() => setStatusFilter(pill.value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              statusFilter === pill.value
                ? "bg-sky-500 text-slate-950"
                : "border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 lg:col-span-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3 font-medium">Nota Pedido</th>
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Logística</th>
                <th className="py-2 pr-3 font-medium text-right">Bultos</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                {canScan && <th className="py-2 font-medium text-right">Lock</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {orders.map((ord) => (
                <tr
                  key={ord.id}
                  onClick={() => setSelectedOrder(ord)}
                  className={`cursor-pointer transition ${
                    selectedOrder?.id === ord.id
                      ? "bg-sky-500/15"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  <td className="py-2.5 pr-3 font-mono font-semibold text-sky-300">
                    {ord.nota_pedido}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-200">{ord.cliente || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-400">{ord.logistica || "—"}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-white">
                    {ord.bultos}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        ord.estado_despacho === "entregado"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : ord.estado_despacho === "despachado"
                            ? "bg-sky-500/20 text-sky-300"
                            : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {ord.estado_despacho}
                    </span>
                  </td>
                  {canScan && (
                    <td
                      className="py-2 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => void handleToggleLock(ord, true)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-amber-300"
                          title="Tomar lock de picking"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleLock(ord, false)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-emerald-300"
                          title="Liberar lock"
                        >
                          <Unlock className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No hay pedidos registrados en este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 h-fit space-y-3">
          {selectedOrder ? (
            <>
              <div>
                <span className="font-mono text-xs text-sky-400">
                  {selectedOrder.nota_pedido}
                </span>
                <h3 className="text-base font-semibold text-white">
                  {selectedOrder.cliente || "Pedido sin cliente"}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Estado:{" "}
                  <strong className="uppercase text-white">
                    {selectedOrder.estado_despacho}
                  </strong>{" "}
                  · Bultos: {selectedOrder.bultos}
                </p>
              </div>
              <div className="border-t border-slate-800 pt-3">
                <p className="mb-2 text-xs font-medium text-slate-300">
                  Detalle de artículos ({selectedOrder.items.length})
                </p>
                <ul className="space-y-1.5 text-xs">
                  {selectedOrder.items.map((it, i) => (
                    <li
                      key={`${it.codigo}-${i}`}
                      className="flex items-center justify-between rounded-lg bg-slate-950/70 px-2.5 py-1.5"
                    >
                      <div>
                        <span className="font-mono text-sky-300">{it.codigo}</span>
                        <p className="text-[11px] text-slate-400">
                          {it.descripcion}
                        </p>
                      </div>
                      <span className="font-bold text-white tabular-nums">
                        x{it.cantidad}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-xs text-slate-400">
              Seleccioná o escaneá un pedido para inspeccionar sus bultos e ítems.
            </p>
          )}
        </aside>
      </div>

      <CameraScannerModal
        open={scannerOpen}
        title="Escanear Etiqueta QR de Despacho"
        onDetected={(raw) => {
          setScannerOpen(false);
          void processQrCode(raw);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
