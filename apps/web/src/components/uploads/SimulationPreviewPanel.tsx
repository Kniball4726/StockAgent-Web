import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { UploadAndSimulateResponse } from "../../lib/api-client";

interface SimulationPreviewPanelProps {
  simResult: UploadAndSimulateResponse;
  canOperate: boolean;
  confirmed: boolean;
  busy: "idle" | "simulating" | "confirming";
  onConfirm: () => void;
}

export function SimulationPreviewPanel({
  simResult,
  canOperate,
  confirmed,
  busy,
  onConfirm,
}: SimulationPreviewPanelProps) {
  return (
    <section className="rounded-2xl border border-sky-500/30 bg-slate-900/85 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">
            Previsualización de Impacto (Solo Lectura)
          </h3>
          <p className="text-xs text-slate-400">
            Operación:{" "}
            <strong className="text-sky-300">{simResult.operation}</strong> ·{" "}
            {simResult.simulation.totalDocumentos} documento(s) ·{" "}
            {simResult.simulation.totalUnidades} unidades consolidadas
          </p>
        </div>

        {canOperate && !confirmed && (
          <button
            type="button"
            disabled={!simResult.simulation.canConfirm || busy !== "idle"}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldCheck className="h-4 w-4" />
            {busy === "confirming"
              ? "Confirmando..."
              : "Confirmar e Impactar Stock"}
          </button>
        )}
      </div>

      {simResult.uploadedFiles.some(
        (entry) => entry.file.deduplicated || entry.duplicateOfOrder
      ) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          {simResult.uploadedFiles.map((entry) => {
            if (!entry.file.deduplicated && !entry.duplicateOfOrder) return null;
            return (
              <p key={entry.file.id}>
                SHA-256 detectado para{" "}
                <strong>{entry.file.originalName}</strong>
                {entry.duplicateOfOrder
                  ? ` — coincide con pedido procesado ${entry.duplicateOfOrder}.`
                  : " — archivo reutilizado sin duplicar almacenamiento."}
              </p>
            );
          })}
        </div>
      )}

      {simResult.simulation.blockingErrors.length > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Errores bloqueantes (impiden confirmar):
          </p>
          {simResult.simulation.blockingErrors.map((msg, i) => (
            <p key={i}>• {msg}</p>
          ))}
        </div>
      )}

      {simResult.simulation.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
          {simResult.simulation.warnings.map((msg, i) => (
            <p key={i}>⚠ {msg}</p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Producto</th>
              <th className="py-2 pr-3 font-medium text-right">Anterior</th>
              <th className="py-2 pr-3 font-medium text-right">Impacto</th>
              <th className="py-2 pr-3 font-medium text-right">Proyectado</th>
              <th className="py-2 font-medium">Alertas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {simResult.simulation.matchedItems.map((item) => (
              <tr key={item.productId}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-300">
                  {item.codigoCatalogo}
                </td>
                <td className="py-2 pr-3 text-slate-200">{item.nombre}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-400">
                  {item.stockAnterior}
                </td>
                <td
                  className={`py-2 pr-3 text-right font-semibold tabular-nums ${
                    item.delta < 0 ? "text-rose-300" : "text-emerald-300"
                  }`}
                >
                  {item.delta > 0 ? `+${item.delta}` : item.delta}
                </td>
                <td className="py-2 pr-3 text-right font-bold tabular-nums text-white">
                  {item.stockNuevo}
                </td>
                <td className="py-2">
                  {item.quiebre ? (
                    <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                      QUIEBRE
                    </span>
                  ) : item.stockCritico ? (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      CRÍTICO
                    </span>
                  ) : (
                    <span className="text-slate-500">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {simResult.simulation.unmatchedItems.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-300">
            Ítems sin coincidencia en catálogo (
            {simResult.simulation.unmatchedItems.length})
          </p>
          <ul className="space-y-1 text-xs text-slate-300">
            {simResult.simulation.unmatchedItems.map((u, idx) => (
              <li key={`${u.codigo}-${idx}`}>
                <span className="font-mono text-amber-200">{u.codigo}</span> —{" "}
                {u.descripcion || "Sin descripción"} (x{u.cantidad}) ·{" "}
                <span className="text-slate-400">{u.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
