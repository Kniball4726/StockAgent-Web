import type { StockMovementRow } from "../../lib/api-client";
import { formatDateTime } from "../../lib/rbac";

interface MovementsHistoryPanelProps {
  movements: StockMovementRow[];
}

export function MovementsHistoryPanel({
  movements,
}: MovementsHistoryPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">
        Historial Reciente de Movimientos
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2 pr-3 font-medium">Fecha</th>
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium text-right">Cant.</th>
              <th className="py-2 pr-3 font-medium">Usuario</th>
              <th className="py-2 font-medium">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="py-2 pr-3 text-slate-400">
                  {formatDateTime(m.registeredAt)}
                </td>
                <td className="py-2 pr-3 font-mono text-sky-300">
                  {m.productCode}
                </td>
                <td className="py-2 pr-3 text-slate-300">{m.movementType}</td>
                <td
                  className={`py-2 pr-3 text-right font-semibold tabular-nums ${
                    m.quantity < 0 ? "text-rose-300" : "text-emerald-300"
                  }`}
                >
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </td>
                <td className="py-2 pr-3 text-slate-300">{m.usuario}</td>
                <td className="py-2 text-slate-400">{m.detalle || "—"}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  Sin movimientos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
