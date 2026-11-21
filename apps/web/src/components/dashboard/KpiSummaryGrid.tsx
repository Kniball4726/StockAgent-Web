import { AlertTriangle, Boxes, PackageCheck, Truck } from "lucide-react";

interface KpiSummaryGridProps {
  productsCount: number;
  totalUnits: number;
  replenishmentCount: number;
  zeroStockCount: number;
  armadosCount: number;
  despachadosCount: number;
  offlinePendingCount: number;
  onGoToTab: (tab: "catalogo" | "cargas" | "inventario" | "despacho") => void;
}

export function KpiSummaryGrid({
  productsCount,
  totalUnits,
  replenishmentCount,
  zeroStockCount,
  armadosCount,
  despachadosCount,
  offlinePendingCount,
  onGoToTab,
}: KpiSummaryGridProps) {
  return (
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
          {productsCount}
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
          {replenishmentCount}
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
  );
}
