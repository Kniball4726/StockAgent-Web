import {
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  normalizarCodigo,
  normalizarCodigoLector,
  type UsuarioResponse,
} from "@stockagent/shared";
import type {
  InventarioResultadoResponse,
  StockAgentApiClient,
} from "../lib/api-client";
import { canRunPhysicalInventory } from "../lib/rbac";
import { CameraScannerModal } from "./CameraScannerModal";

interface PhysicalInventoryTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
}

export function PhysicalInventoryTab({ api, user }: PhysicalInventoryTabProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [sessionName, setSessionName] = useState(
    () => `conteo-web-${new Date().toISOString().slice(0, 10)}`
  );
  const [scannerOpen, setScannerOpen] = useState(false);

  const [prelimResult, setPrelimResult] =
    useState<InventarioResultadoResponse | null>(null);
  const [finalResult, setFinalResult] =
    useState<InventarioResultadoResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canOperate = canRunPhysicalInventory(user.role);

  async function addScannedCode(rawCode: string, qtyToAdd: number) {
    const cleaned = normalizarCodigoLector(rawCode);
    if (!cleaned) return;
    setError(null);
    let resolvedKey = normalizarCodigo(cleaned);
    try {
      const prod = await api.getProduct(cleaned);
      resolvedKey = prod.code;
    } catch {
      // Permitir registrar códigos NO_CATALOGADO para que la comparativa lo detecte
    }
    setCounts((prev) => ({
      ...prev,
      [resolvedKey]: (prev[resolvedKey] ?? 0) + Math.max(1, Math.trunc(qtyToAdd)),
    }));
    setScanCode("");
    setPrelimResult(null);
    setFinalResult(null);
  }

  async function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = Number(scanQty);
    await addScannedCode(scanCode, Number.isFinite(qty) && qty > 0 ? qty : 1);
  }

  async function handleComparePreliminary() {
    if (Object.keys(counts).length === 0) {
      setError("Agregá al menos un producto al conteo físico.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.comparePreliminaryInventory(counts, sessionName);
      setPrelimResult(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error comparando inventario preliminar."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    if (Object.keys(counts).length === 0) {
      setError("No hay conteo físico cargado para finalizar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.finalizePhysicalInventory(counts, sessionName);
      setFinalResult(res);
      setPrelimResult(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo finalizar el inventario."
      );
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(counts);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">
          Inventario Físico en Vivo
        </h2>
        <p className="text-xs text-slate-400">
          Conteo rápido por pistola USB HID o cámara con comparativa instantánea frente a PostgreSQL
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          {error}
        </div>
      )}

      {finalResult && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-100">
          <p className="flex items-center gap-2 font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Inventario guardado en base de datos ({finalResult.mensaje})
          </p>
          <p className="mt-1 tabular-nums">
            Total ítems: {finalResult.total_items} · Coinciden:{" "}
            {finalResult.coinciden} · Faltantes: {finalResult.faltantes} · Sobrantes:{" "}
            {finalResult.sobrantes}
          </p>
        </div>
      )}

      {canOperate ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Nombre del relevamiento"
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || entries.length === 0}
                onClick={() => void handleComparePreliminary()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25 disabled:opacity-40"
              >
                <Scale className="h-4 w-4" />
                Comparar Preliminar
              </button>
              <button
                type="button"
                disabled={busy || entries.length === 0}
                onClick={() => void handleFinalize()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                <ClipboardCheck className="h-4 w-4" />
                Finalizar Inventario
              </button>
            </div>
          </div>

          <form onSubmit={handleAddSubmit} className="flex flex-wrap gap-2">
            <input
              type="text"
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              placeholder="Escanear SKU o código de barras..."
              className="flex-1 min-w-[200px] rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
            />
            <input
              type="number"
              min={1}
              value={scanQty}
              onChange={(e) => setScanQty(e.target.value)}
              aria-label="Cantidad contada"
              className="w-24 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white tabular-nums"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <Plus className="h-4 w-4" />
              Sumar
            </button>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
            >
              <Camera className="h-4 w-4" />
              Cámara
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">Código Relevado</th>
                  <th className="py-2 pr-3 font-medium">Cantidad Contada</th>
                  <th className="py-2 text-right font-medium">Quitar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {entries.map(([codigo, qty]) => (
                  <tr key={codigo}>
                    <td className="py-2 pr-3 font-mono font-semibold text-sky-300">
                      {codigo}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => {
                          const nextVal = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                          setCounts((prev) => ({ ...prev, [codigo]: nextVal }));
                        }}
                        className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white tabular-nums"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setCounts((prev) => {
                            const copy = { ...prev };
                            delete copy[codigo];
                            return copy;
                          })
                        }
                        className="rounded-lg p-1.5 text-rose-400 hover:bg-slate-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-slate-500">
                      Escaneá o agregá SKUs para iniciar la planilla de conteo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
          Tu rol <strong>{user.role}</strong> no tiene permisos para ejecutar conteos físicos.
        </div>
      )}

      {prelimResult && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
            <div className="rounded-xl bg-slate-950 p-3">
              <span className="text-slate-400">Total Evaluados</span>
              <p className="mt-1 text-lg font-bold text-white tabular-nums">
                {prelimResult.total_items}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-300">
              <span>Coinciden</span>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {prelimResult.coinciden}
              </p>
            </div>
            <div className="rounded-xl bg-rose-500/10 p-3 text-rose-300">
              <span>Faltantes</span>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {prelimResult.faltantes}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-amber-300">
              <span>Sobrantes</span>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {prelimResult.sobrantes}
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
                {prelimResult.comparativa.map((row) => (
                  <tr key={row.codigo}>
                    <td className="py-2 pr-3 font-mono text-sky-300">{row.codigo}</td>
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
      )}

      <CameraScannerModal
        open={scannerOpen}
        title="Escanear Ítem para Conteo Físico"
        onDetected={(raw) => {
          setScannerOpen(false);
          void addScannedCode(raw, 1);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
