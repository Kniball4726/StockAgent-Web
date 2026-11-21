import { Barcode, MapPin, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  normalizarCodigoLector,
  type ProductoItemResponse,
  type UserRole,
} from "@stockagent/shared";
import type { StockAgentApiClient } from "../../lib/api-client";

interface ProductInspectorPanelProps {
  api: StockAgentApiClient;
  selected: ProductoItemResponse | null;
  canEdit: boolean;
  userRole: UserRole;
  onSuccess: (message: string) => Promise<void>;
  onError: (message: string) => void;
}

export function ProductInspectorPanel({
  api,
  selected,
  canEdit,
  userRole,
  onSuccess,
  onError,
}: ProductInspectorPanelProps) {
  const [locationDraft, setLocationDraft] = useState("");
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustType, setAdjustType] = useState<
    "ingreso_rapido" | "salida_rapida" | "ajuste_manual"
  >("ingreso_rapido");
  const [adjustDetail, setAdjustDetail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setLocationDraft(selected.ubicacion);
    setBarcodeDraft(selected.cod_barras);
    setAdjustDetail("");
  }, [selected?.code, selected?.ubicacion, selected?.cod_barras]);

  async function handleSaveLocation(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.updateProductLocation(
        selected.code,
        locationDraft.trim()
      );
      await onSuccess(`Ubicación actualizada para ${res.code}: ${res.ubicacion}`);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Error al guardar ubicación."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBarcode(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.associateProductBarcode(
        selected.code,
        normalizarCodigoLector(barcodeDraft)
      );
      await onSuccess(
        `Código de barras actualizado para ${res.code}: ${res.cod_barras}`
      );
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : "Error al asociar código de barras."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjustStock(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const rawDelta = Number(adjustDelta);
    if (!Number.isFinite(rawDelta) || rawDelta === 0) {
      onError("Ingresá una cantidad válida distinta de cero.");
      return;
    }
    const delta =
      adjustType === "salida_rapida" && rawDelta > 0
        ? -Math.abs(Math.trunc(rawDelta))
        : Math.trunc(rawDelta);

    setSaving(true);
    try {
      const res = await api.adjustProductStock(selected.code, {
        delta,
        movement_type: adjustType,
        ...(adjustDetail.trim() ? { detalle: adjustDetail.trim() } : {}),
      });
      setAdjustDetail("");
      await onSuccess(
        `Stock de ${res.code} actualizado: ${res.stock_anterior} → ${res.stock_nuevo}`
      );
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "No se pudo ajustar el stock."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4 h-fit">
      {selected ? (
        <>
          <div>
            <span className="font-mono text-xs font-semibold text-sky-400">
              SKU {selected.code}
            </span>
            <h3 className="mt-0.5 text-base font-semibold text-white">
              {selected.name}
            </h3>
            <p className="mt-1 text-xs text-slate-400 tabular-nums">
              Stock actual:{" "}
              <strong className="text-white">{selected.stock}</strong> (mín{" "}
              {selected.stock_minimo})
            </p>
          </div>

          {canEdit ? (
            <>
              <form
                onSubmit={handleSaveLocation}
                className="space-y-2 border-t border-slate-800 pt-3"
              >
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <MapPin className="h-3.5 w-3.5 text-sky-400" />
                  Ubicación en depósito
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={locationDraft}
                    onChange={(e) => setLocationDraft(e.target.value)}
                    placeholder="Ej: D-04-2"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white uppercase"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Guardar
                  </button>
                </div>
              </form>

              <form
                onSubmit={handleSaveBarcode}
                className="space-y-2 border-t border-slate-800 pt-3"
              >
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Barcode className="h-3.5 w-3.5 text-sky-400" />
                  Asociar Código de Barras
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={barcodeDraft}
                    onChange={(e) => setBarcodeDraft(e.target.value)}
                    placeholder="EAN-13 / UPC-A"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Asociar
                  </button>
                </div>
              </form>

              <form
                onSubmit={handleAdjustStock}
                className="space-y-2 border-t border-slate-800 pt-3"
              >
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-amber-400" />
                  Ajuste Rápido de Stock
                </label>
                <select
                  value={adjustType}
                  onChange={(e) =>
                    setAdjustType(
                      e.target.value as
                        | "ingreso_rapido"
                        | "salida_rapida"
                        | "ajuste_manual"
                    )
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                >
                  <option value="ingreso_rapido">Ingreso Rápido (+)</option>
                  <option value="salida_rapida">Salida Rápida (-)</option>
                  <option value="ajuste_manual">Ajuste Manual (+/-)</option>
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                    className="w-24 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white tabular-nums"
                  />
                  <input
                    type="text"
                    value={adjustDetail}
                    onChange={(e) => setAdjustDetail(e.target.value)}
                    placeholder="Motivo opcional..."
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                >
                  Aplicar Ajuste
                </button>
              </form>
            </>
          ) : (
            <p className="border-t border-slate-800 pt-3 text-xs text-slate-400">
              Tu rol <strong>{userRole}</strong> tiene acceso de solo lectura en
              catálogo.
            </p>
          )}
        </>
      ) : (
        <p className="py-6 text-center text-xs text-slate-400">
          Seleccioná o escaneá un producto de la tabla para ver o editar su
          ubicación, código de barras y stock.
        </p>
      )}
    </aside>
  );
}
