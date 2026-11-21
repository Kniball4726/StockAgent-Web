import { Lock, Unlock } from "lucide-react";
import type { PedidoDetalleResponse } from "@stockagent/shared";

interface DispatchOrdersPanelProps {
  orders: PedidoDetalleResponse[];
  selectedOrder: PedidoDetalleResponse | null;
  statusFilter: string;
  canScan: boolean;
  onFilterChange: (next: string) => void;
  onSelectOrder: (order: PedidoDetalleResponse) => void;
  onToggleLock: (order: PedidoDetalleResponse, lock: boolean) => void;
}

const FILTER_PILLS = [
  { value: "", label: "Todos" },
  { value: "armado", label: "Armados" },
  { value: "despachado", label: "Despachados" },
  { value: "entregado", label: "Entregados" },
];

export function DispatchOrdersPanel({
  orders,
  selectedOrder,
  statusFilter,
  canScan,
  onFilterChange,
  onSelectOrder,
  onToggleLock,
}: DispatchOrdersPanelProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {FILTER_PILLS.map((pill) => (
          <button
            key={pill.value || "all"}
            type="button"
            onClick={() => onFilterChange(pill.value)}
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
                {canScan && (
                  <th className="py-2 font-medium text-right">Lock</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {orders.map((ord) => (
                <tr
                  key={ord.id}
                  onClick={() => onSelectOrder(ord)}
                  className={`cursor-pointer transition ${
                    selectedOrder?.id === ord.id
                      ? "bg-sky-500/15"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  <td className="py-2.5 pr-3 font-mono font-semibold text-sky-300">
                    {ord.nota_pedido}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-200">
                    {ord.cliente || "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-400">
                    {ord.logistica || "—"}
                  </td>
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
                          onClick={() => onToggleLock(ord, true)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-amber-300"
                          title="Tomar lock de picking"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleLock(ord, false)}
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
                        <span className="font-mono text-sky-300">
                          {it.codigo}
                        </span>
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
              Seleccioná o escaneá un pedido para inspeccionar sus bultos e
              ítems.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
