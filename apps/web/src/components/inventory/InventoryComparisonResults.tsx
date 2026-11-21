import type { InventarioResultadoResponse } from "../../lib/api-client";

interface InventoryComparisonResultsProps {
  result: InventarioResultadoResponse;
}

export function InventoryComparisonResults({
  result,
}: InventoryComparisonResultsProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div className="rounded-xl bg-slate-950 p-3">
          <span className="text-slate-400">Total Evaluados</span>
          <p className="mt-1 text-lg font-bold text-white tabular-nums">
            {result.total_items}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-300">
          <span>Coinciden</span>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {result.coinciden}
          </p>
        </div>
        <div className="rounded-xl bg-rose-500/10 p-3 text-rose-300">
          <span>Faltantes</span>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {result.faltantes}
          </p>
        </div>
        <div className="rounded-xl bg-amber-500/10 p-3 text-amber-300">
          <span>Sobrantes</span>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {result.sobrantes}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Nombre</th>
              <th className="py-2 pr-3 font-medium text-right">Sistema</th>
              <th className="py-2 pr-3 font-medium text-right">Físico</th>
              <th className="py-2 pr-3 font-medium text-right">Diferencia</th>
              <th className="py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {result.comparativa.map((row) => (
              <tr key={row.codigo}>
                <td className="py-2 pr-3 font-mono text-sky-300">
                  {row.codigo}
                </td>
                <td className="py-2 pr-3 text-slate-200">{row.nombre}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-400">
                  {row.stock_sistema}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-white font-semibold">
                  {row.stock_fisico}
                </td>
                <td
                  className={`py-2 pr-3 text-right font-semibold tabular-nums ${
                    row.diferencia < 0
                      ? "text-rose-300"
                      : row.diferencia > 0
                        ? "text-amber-300"
                        : "text-emerald-300"
                  }`}
                >
                  {row.diferencia > 0 ? `+${row.diferencia}` : row.diferencia}
                </td>
                <td className="py-2 font-medium">{row.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
