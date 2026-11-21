import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { PedidoDetalleResponse, UsuarioResponse } from "@stockagent/shared";
import { ApiClientError, type StockAgentApiClient } from "../lib/api-client";
import { extraerCodigoDespacho } from "../lib/barcode-scanner";
import type {
  DispatchStatusTarget,
  OfflineDispatchQueue,
  QueuedDispatchScan,
} from "../lib/offline-dispatch-queue";
import { canOperateDispatch } from "../lib/rbac";
import { CameraScannerModal } from "./CameraScannerModal";
import { DispatchOrdersPanel } from "./dispatch/DispatchOrdersPanel";
import { DispatchScanForm } from "./dispatch/DispatchScanForm";
import { OfflineQueuePanel } from "./dispatch/OfflineQueuePanel";

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
        text:
          err instanceof Error
            ? err.message
            : "Error gestionando lock del pedido.",
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
            Escaneo continuo de remitos/etiquetas con resiliencia ante cortes de
            Wi-Fi
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

      <OfflineQueuePanel
        pendingScans={pendingScans}
        isOnline={isOnline}
        syncing={syncing}
        onFlush={() => void handleFlush()}
        onRemoveItem={(id) => {
          offlineQueue.remove(id);
          onQueueChanged();
        }}
      />

      {canScan && (
        <DispatchScanForm
          targetState={targetState}
          qrInput={qrInput}
          isOnline={isOnline}
          onTargetStateChange={setTargetState}
          onQrInputChange={setQrInput}
          onSubmit={handleQrSubmit}
          onOpenCamera={() => setScannerOpen(true)}
        />
      )}

      <DispatchOrdersPanel
        orders={orders}
        selectedOrder={selectedOrder}
        statusFilter={statusFilter}
        canScan={canScan}
        onFilterChange={setStatusFilter}
        onSelectOrder={setSelectedOrder}
        onToggleLock={(ord, lock) => void handleToggleLock(ord, lock)}
      />

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
