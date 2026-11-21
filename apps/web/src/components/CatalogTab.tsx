import { Camera, History, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizarCodigoLector,
  type ProductoItemResponse,
  type UsuarioResponse,
} from "@stockagent/shared";
import type { StockAgentApiClient, StockMovementRow } from "../lib/api-client";
import { canMutateCatalog, isAdminOrMaster } from "../lib/rbac";
import { CameraScannerModal } from "./CameraScannerModal";
import { CatalogProductTable } from "./catalog/CatalogProductTable";
import { CreateProductForm } from "./catalog/CreateProductForm";
import { MovementsHistoryPanel } from "./catalog/MovementsHistoryPanel";
import { ProductInspectorPanel } from "./catalog/ProductInspectorPanel";

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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
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
          }
        }
      } catch (err) {
        setBanner({
          type: "err",
          text: err instanceof Error ? err.message : "Error cargando catálogo.",
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

  async function resolveScannerQuery(raw: string) {
    const code = normalizarCodigoLector(raw);
    if (!code) return;
    setQuery(code);
    setBanner(null);
    try {
      const exact = await api.getProduct(code);
      setSelected(exact);
      setBanner({
        type: "ok",
        text: `Producto encontrado: ${exact.code} — ${exact.name}`,
      });
    } catch {
      await loadCatalog(code);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Catálogo y Ubicaciones
          </h2>
          <p className="text-xs text-slate-400">
            Búsqueda por SKU, descripción o pistola EAN-13 / UPC-A
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowMovements((v) => !v)}
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
        <CreateProductForm
          api={api}
          onSuccess={async (msg) => {
            setBanner({ type: "ok", text: msg });
            setShowCreateForm(false);
            await loadCatalog(query);
          }}
          onError={(msg) => setBanner({ type: "err", text: msg })}
        />
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
        <CatalogProductTable
          products={products}
          selectedCode={selected?.code ?? null}
          query={query}
          onSelect={setSelected}
        />
        <ProductInspectorPanel
          api={api}
          selected={selected}
          canEdit={canEdit}
          userRole={user.role}
          onSuccess={async (msg) => {
            setBanner({ type: "ok", text: msg });
            await loadCatalog(query);
          }}
          onError={(msg) => setBanner({ type: "err", text: msg })}
        />
      </div>

      {showMovements && <MovementsHistoryPanel movements={movements} />}

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
