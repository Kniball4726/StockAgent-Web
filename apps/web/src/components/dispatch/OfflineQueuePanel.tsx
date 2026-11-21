import { CloudOff, Trash2, UploadCloud } from "lucide-react";
import type { QueuedDispatchScan } from "../../lib/offline-dispatch-queue";
import { formatDateTime } from "../../lib/rbac";

interface OfflineQueuePanelProps {
  pendingScans: QueuedDispatchScan[];
  isOnline: boolean;
  syncing: boolean;
  onFlush: () => void;
  onRemoveItem: (id: string) => void;
}

export function OfflineQueuePanel({
  pendingScans,
  isOnline,
  syncing,
  onFlush,
  onRemoveItem,
}: OfflineQueuePanelProps) {
  if (pendingScans.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
          <CloudOff className="h-4 w-4 text-amber-400" />
          Cola Offline ({pendingScans.length} escaneo/s pendiente/s)
        </div>
        <button
          type="button"
          disabled={!isOnline || syncing}
          onClick={onFlush}
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
              onClick={() => onRemoveItem(item.id)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
              aria-label={`Eliminar ${item.codigo} de la cola`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
