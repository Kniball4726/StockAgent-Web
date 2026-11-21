import {
  Barcode,
  Camera,
  History,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  normalizarCodigoLector,
  type ProductoItemResponse,
  type UsuarioResponse,
} from "@stockagent/shared";
import type { StockAgentApiClient, StockMovementRow } from "../lib/api-client";
import {
  canMutateCatalog,
  formatDateTime,
  isAdminOrMaster,
} from "../lib/rbac";
import { CameraScannerModal } from "./CameraScannerModal";

interface CatalogTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
  lastEventTick: number;
}

export function CatalogTab({ api, user, lastEventTick }: CatalogTabProps) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductoItemResponse[]>([]);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [selected, setSelected] = useState<ProductoItemResponse | null>(null);
  const [showMovements, setShowMovements] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [locationDraft, setLocationDraft] = useState("");
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustType, setAdjustType] = useState<
    "ingreso_rapido" | "salida_rapida" | "ajuste_manual"
  >("ingreso_rapido");
  const [adjustDetail, setAdjustDetail] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newStock, setNewStock] = useState("0");
  const [newMin, setNewMin] = useState("5");
  const [newLoc, setNewLoc] = useState("");
  const [newBarcode, setNewBarcode] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const selectedCodeRef = useRef<string | null>(null);
  selectedCodeRef.current = selected?.code ?? null;

  const canEdit = canMutateCatalog(user.role);
  const isAdmin = isAdminOrMaster(user.role);

  const loadCatalog = useCallback(
    async (searchTerm: string) => {
      setLoading(true);
      try {
        const [res, movRes] = await Promise.all([
          api.searchProducts(searchTerm, 200),
          showMovements ? api.getMovementsHistory(60) : Promise.resolve(null),
        ]);
        setProducts(res.productos);
        if (movRes) {
          setMovements(movRes.movimientos);
        }
        if (selectedCodeRef.current) {
          const refreshed = res.productos.find(
            (p) => p.code === selectedCodeRef.current
          );
          if (refreshed) {
            setSelected(refreshed);
            setLocationDraft(refreshed.ubicacion);
            setBarcodeDraft(refreshed.cod_barras);
          }
        }
      } catch (err) {
        setBanner({
          type: "err",
          text:
            err instanceof Error ? err.message : "Error cargando catálogo.",
        });
      } finally {
        setLoading(false);
      }
    },
    [api, showMovements]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog(query);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadCatalog, query, lastEventTick]);

  function selectProduct(prod: ProductoItemResponse) {
    setSelected(prod);
    setLocationDraft(prod.ubicacion);
    setBarcodeDraft(prod.cod_barras);
    setAdjustDetail("");
  }

  async function resolveScannerQuery(raw: string) {
    const code = normalizarCodigoLector(raw);
    if (!code) return;
    setQuery(code);
    setBanner(null);
    try {
      const exact = await api.getProduct(code);
      selectProduct(exact);
      setBanner({
        type: "ok",
        text: `Producto encontrado: ${exact.code} — ${exact.name}`,
      });
    } catch {
      await loadCatalog(code);
    }
  }

  async function handleSaveLocation(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.updateProductLocation(selected.code, locationDraft.trim());
      setBanner({
        type: "ok",
        text: `Ubicación actualizada para ${res.code}: ${res.ubicacion}`,
      });
      await loadCatalog(query);
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error al guardar ubicación.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBarcode(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.associateProductBarcode(
        selected.code,
        normalizarCodigoLector(barcodeDraft)
      );
      setBanner({
        type: "ok",
        text: `Código de barras actualizado para ${res.code}: ${res.cod_barras}`,
      });
      await loadCatalog(query);
    } catch (err) {
      setBanner({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Error al asociar código de barras.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjustStock(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const rawDelta = Number(adjustDelta);
    if (!Number.isFinite(rawDelta) || rawDelta === 0) {
      setBanner({ type: "err", text: "Ingresá una cantidad válida distinta de cero." });
      return;
    }
    const delta =
      adjustType === "salida_rapida" && rawDelta > 0
        ? -Math.abs(Math.trunc(rawDelta))
        : Math.trunc(rawDelta);

    setSaving(true);
    setBanner(null);
    try {
      const res = await api.adjustProductStock(selected.code, {
        delta,
        movement_type: adjustType,
        ...(adjustDetail.trim() ? { detalle: adjustDetail.trim() } : {}),
      });
      setBanner({
        type: "ok",
        text: `Stock de ${res.code} actualizado: ${res.stock_anterior} → ${res.stock_nuevo}`,
      });
      setAdjustDetail("");
      await loadCatalog(query);
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "No se pudo ajustar el stock.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) {
      setBanner({ type: "err", text: "SKU y nombre son obligatorios." });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      await api.upsertProduct({
        code: newCode.trim(),
        name: newName.trim(),
        stock: Math.max(0, Math.trunc(Number(newStock) || 0)),
        stock_minimo: Math.max(0, Math.trunc(Number(newMin) || 0)),
        ubicacion: newLoc.trim().toUpperCase(),
        cod_barras: normalizarCodigoLector(newBarcode),
      });
      setBanner({
        type: "ok",
        text: `Producto ${newCode.trim()} guardado en PostgreSQL.`,
      });
      setNewCode("");
      setNewName("");
      setNewStock("0");
      setNewLoc("");
      setNewBarcode("");
      setShowCreateForm(false);
      await loadCatalog(query);
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Error creando producto.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Catálogo y Ubicaciones</h2>
          <p className="text-xs text-slate-400">
            Búsqueda por SKU, descripción o pistola EAN-13 / UPC-A
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setShowMovements((v) => !v);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium ${
              showMovements
                ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Movimientos
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo SKU
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div
          role={banner.type === "err" ? "alert" : "status"}
          className={`rounded-xl border p-3 text-xs ${
            banner.type === "err"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {showCreateForm && isAdmin && (
        <form
          onSubmit={handleCreateProduct}
          className="grid gap-3 rounded-2xl border border-sky-500/30 bg-slate-900/90 p-4 sm:grid-cols-3"
        >
          <input
            type="text"
            placeholder="SKU *"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            required
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
          <input
            type="text"
            placeholder="Descripción *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white sm:col-span-2"
          />
          <input
            type="number"
            placeholder="Stock inicial"
            value={newStock}
            onChange={(e) => setNewStock(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
          <input
            type="number"
            placeholder="Stock mínimo"
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
          <input
            type="text"
            placeholder="Ubicación (ej: D-04-2)"
            value={newLoc}
            onChange={(e) => setNewLoc(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          />
          <input
            type="text"
            placeholder="Código de barras"
            value={newBarcode}
            onChange={(e) => setNewBarcode(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white sm:col-span-2"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Guardar Producto
          </button>
        </form>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void resolveScannerQuery(query);
        }}
        className="flex flex-wrap gap-2"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escanear código o buscar por SKU / nombre / estantería..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
        >
          <Camera className="h-4 w-4" />
          Cámara
        </button>
      </form>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">SKU</th>
                  <th className="py-2 pr-3 font-medium">Descripción</th>
                  <th className="py-2 pr-3 font-medium text-right">Stock</th>
                  <th className="py-2 pr-3 font-medium">Ubicación</th>
                  <th className="py-2 font-medium">Código Barras</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {products.map((prod) => {
                  const isLow = prod.stock <= prod.stock_minimo;
                  const isSelected = selected?.code === prod.code;
                  return (
                    <tr
                      key={prod.code}
                      onClick={() => selectProduct(prod)}
                      className={`cursor-pointer transition ${
                        isSelected
                          ? "bg-sky-500/15"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="py-2.5 pr-3 font-mono font-semibold text-sky-300">
                        {prod.code}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-200">{prod.name}</td>
                      <td
                        className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                          prod.stock <= 0
                            ? "text-rose-400"
                            : isLow
                              ? "text-amber-300"
                              : "text-emerald-300"
                        }`}
                      >
                        {prod.stock}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-slate-300">
                        {prod.ubicacion || "—"}
                      </td>
                      <td className="py-2.5 font-mono text-slate-400">
                        {prod.cod_barras || "—"}
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Sin productos que coincidan con "{query}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

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
                  <form onSubmit={handleSaveLocation} className="space-y-2 border-t border-slate-800 pt-3">
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

                  <form onSubmit={handleSaveBarcode} className="space-y-2 border-t border-slate-800 pt-3">
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

                  <form onSubmit={handleAdjustStock} className="space-y-2 border-t border-slate-800 pt-3">
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
                  Tu rol <strong>{user.role}</strong> tiene acceso de solo lectura en catálogo.
                </p>
              )}
            </>
          ) : (
            <p className="py-6 text-center text-xs text-slate-400">
              Seleccioná o escaneá un producto de la tabla para ver o editar su ubicación, código de barras y stock.
            </p>
          )}
        </aside>
      </div>

      {showMovements && (
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
      )}

      <CameraScannerModal
        open={scannerOpen}
        title="Escanear SKU o Código de Barras"
        onDetected={(raw) => {
          setScannerOpen(false);
          void resolveScannerQuery(raw);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
