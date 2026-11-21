import type { ReplenishmentItemDto } from "../../lib/api-client";

interface ReplenishmentTablePanelProps {
  items: ReplenishmentItemDto[];
  onlyCritical: boolean;
  onOnlyCriticalChange: (next: boolean) => void;
}

export function ReplenishmentTablePanel({
  items,
  onlyCritical,
  onOnlyCriticalChange,
}: ReplenishmentTablePanelProps) {
  return (
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
            onChange={(e) => onOnlyCriticalChange(e.target.checked)}
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
            {items.slice(0, 12).map((item) => (
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
            {items.length === 0 && (
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
  );
}
