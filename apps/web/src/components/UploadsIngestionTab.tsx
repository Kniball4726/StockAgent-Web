import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Play,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type {
  FileUploadCategory,
  StoredFileDto,
  UsuarioResponse,
} from "@stockagent/shared";
import type {
  ConfirmIngestionResultDto,
  StockAgentApiClient,
  UploadAndSimulateResponse,
} from "../lib/api-client";
import {
  canUploadAndConfirm,
  formatBytes,
  formatDateTime,
  isAdminOrMaster,
} from "../lib/rbac";

interface UploadsIngestionTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
}

const CATEGORY_OPTIONS: Array<{
  value: FileUploadCategory;
  label: string;
  hint: string;
}> = [
  {
    value: "remito_mayorista",
    label: "Remitos Mayoristas (PDF)",
    hint: "Descuenta stock por remitos o pedidos mayoristas en PDF.",
  },
  {
    value: "canje",
    label: "Canjes (DOCX / PDF)",
    hint: "Extrae notas de canje y logística desde documentos Word o PDF.",
  },
  {
    value: "mercado_libre",
    label: "Pedidos Mercado Libre (DOCX / PDF)",
    hint: "Empareja descripciones/SKUs de órdenes Mercado Libre.",
  },
  {
    value: "mercado_full",
    label: "Envíos Mercado Libre Full (.xls / .xlsx)",
    hint: "Consolida unidades y crea plan o descuento Full.",
  },
  {
    value: "ingreso_fabrica",
    label: "Ingresos de Fábrica (.xlsx / .pdf)",
    hint: "Suma stock recibido desde fábrica con trazabilidad.",
  },
  {
    value: "stock_fisico",
    label: "Conteo Stock Físico (.xlsx / .csv)",
    hint: "Importa planillas de inventario físico para reconciliar diferencias.",
  },
];

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `web-ing-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function UploadsIngestionTab({ api, user }: UploadsIngestionTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<FileUploadCategory>("remito_mayorista");
  const [failOnUnmatched, setFailOnUnmatched] = useState(false);
  const [sobrescribirStock, setSobrescribirStock] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const [simResult, setSimResult] = useState<UploadAndSimulateResponse | null>(
    null
  );
  const [confirmResult, setConfirmResult] =
    useState<ConfirmIngestionResultDto | null>(null);
  const [storedFiles, setStoredFiles] = useState<StoredFileDto[]>([]);

  const [busy, setBusy] = useState<"idle" | "simulating" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string>(() => createIdempotencyKey());

  const canOperate = canUploadAndConfirm(user.role);
  const isAdmin = isAdminOrMaster(user.role);

  const loadFilesArchive = useCallback(async () => {
    try {
      const res = await api.listStoredFiles("", 40);
      setStoredFiles(res.files);
    } catch {
      // No bloquear pantalla si el archivo de comprobantes falla momentáneamente
    }
  }, [api]);

  useEffect(() => {
    void loadFilesArchive();
  }, [loadFilesArchive]);

  function attachFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setSelectedFiles(Array.from(list));
    setSimResult(null);
    setConfirmResult(null);
    setError(null);
    setTxId(createIdempotencyKey());
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    attachFiles(e.dataTransfer.files);
  }

  async function handleSimulate() {
    if (selectedFiles.length === 0) {
      setError("Seleccioná al menos un archivo desde tu PC antes de simular.");
      return;
    }
    setBusy("simulating");
    setError(null);
    setConfirmResult(null);
    try {
      const res = await api.uploadAndSimulate({
        category,
        files: selectedFiles,
        failOnUnmatched,
      });
      setSimResult(res);
      setTxId(createIdempotencyKey());
      await loadFilesArchive();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo procesar ni simular el lote de archivos."
      );
    } finally {
      setBusy("idle");
    }
  }

  async function handleConfirm() {
    if (!simResult) return;
    setBusy("confirming");
    setError(null);
    try {
      const documents = simResult.parsedDocuments.map((env) => env.document);
      const res = await api.confirmIngestion(
        {
          txId,
          operation: simResult.operation,
          documents,
          failOnUnmatched,
          sobrescribirStock:
            simResult.operation === "stock_fisico" ? sobrescribirStock : false,
        },
        txId
      );
      setConfirmResult(res.result);
      setSelectedFiles([]);
      await loadFilesArchive();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "La confirmación en base de datos fue rechazada."
      );
    } finally {
      setBusy("idle");
    }
  }

  async function handleDownloadFile(file: StoredFileDto) {
    try {
      const blob = await api.downloadStoredFile(file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.originalName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo descargar el archivo."
      );
    }
  }

  async function handleDeleteFile(fileId: string) {
    try {
      await api.deleteStoredFile(fileId);
      await loadFilesArchive();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo eliminar el comprobante."
      );
    }
  }

  const currentHint =
    CATEGORY_OPTIONS.find((opt) => opt.value === category)?.hint ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">
          Cargar Archivos PC, Simulación y Confirmación
        </h2>
        <p className="text-xs text-slate-400">
          Flujo seguro en 2 pasos: 1) Subir, parsear y previsualizar impacto · 2) Confirmar atómicamente en PostgreSQL
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

      {confirmResult && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-100">
          <div className="flex items-center gap-2 font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Operación confirmada en PostgreSQL ({confirmResult.operation})
            {confirmResult.idempotentReplay ? " · Reproducción idempotente" : ""}
          </div>
          <p className="mt-1">{confirmResult.auditDetail}</p>
          <p className="mt-1 tabular-nums text-emerald-200/80">
            Unidades aplicadas: <strong>{confirmResult.totalUnidadesAplicadas}</strong>{" "}
            · Pedidos generados: <strong>{confirmResult.ordersCreated.length}</strong>
          </p>
        </div>
      )}

      {canOperate ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="upload-category"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Tipo de comprobante / documento
              </label>
              <select
                id="upload-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as FileUploadCategory);
                  setSimResult(null);
                  setConfirmResult(null);
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-slate-400">{currentHint}</p>
            </div>

            <div className="flex flex-col justify-center space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={failOnUnmatched}
                  onChange={(e) => setFailOnUnmatched(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-900 text-sky-500"
                />
                Bloquear confirmación si existen ítems sin coincidencia en catálogo
              </label>

              {category === "stock_fisico" && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-amber-200">
                  <input
                    type="checkbox"
                    checked={sobrescribirStock}
                    onChange={(e) => setSobrescribirStock(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-900 text-amber-500"
                  />
                  Sobrescribir stock digital con el conteo físico importado
                </label>
              )}
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
              dragging
                ? "border-sky-400 bg-sky-500/10"
                : "border-slate-700 bg-slate-950/60 hover:border-slate-500"
            }`}
          >
            <UploadCloud className="mb-2 h-8 w-8 text-sky-400" />
            <p className="text-sm font-medium text-white">
              Arrastrá remitos o planillas desde tu PC acá
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Soporta PDF, Excel (.xlsx / .xls), CSV, Word (.docx) y TXT
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.csv,.docx,.txt"
              onChange={(e) => attachFiles(e.target.files)}
              className="sr-only"
              data-testid="pc-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
            >
              Seleccionar archivos de la PC
            </button>
          </div>

          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex flex-wrap gap-2">
                {selectedFiles.map((f) => (
                  <span
                    key={`${f.name}-${f.size}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
                  >
                    <FileText className="h-3.5 w-3.5 text-sky-400" />
                    {f.name} ({formatBytes(f.size)})
                  </span>
                ))}
              </div>
              <button
                type="button"
                disabled={busy !== "idle"}
                onClick={() => void handleSimulate()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {busy === "simulating" ? "Analizando..." : "Subir y Simular"}
              </button>
            </div>
          )}
        </section>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
          Tu rol <strong>{user.role}</strong> solo permite consultar comprobantes guardados.
        </div>
      )}

      {simResult && (
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

            {canOperate && !confirmResult && (
              <button
                type="button"
                disabled={!simResult.simulation.canConfirm || busy !== "idle"}
                onClick={() => void handleConfirm()}
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
                    SHA-256 detectado para <strong>{entry.file.originalName}</strong>
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
                Ítems sin coincidencia en catálogo ({simResult.simulation.unmatchedItems.length})
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
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <FileSpreadsheet className="h-4 w-4 text-sky-400" />
          Repositorio de Comprobantes Subidos
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-3 font-medium">Archivo</th>
                <th className="py-2 pr-3 font-medium">Categoría</th>
                <th className="py-2 pr-3 font-medium text-right">Tamaño</th>
                <th className="py-2 pr-3 font-medium">Usuario</th>
                <th className="py-2 pr-3 font-medium">Fecha</th>
                <th className="py-2 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {storedFiles.map((f) => (
                <tr key={f.id} className="hover:bg-slate-800/30">
                  <td className="py-2 pr-3 font-medium text-slate-200">
                    {f.originalName}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-400">{f.category}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-400">
                    {formatBytes(f.sizeBytes)}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{f.uploadedBy}</td>
                  <td className="py-2 pr-3 text-slate-400">
                    {formatDateTime(f.createdAt)}
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDownloadFile(f)}
                        className="rounded-lg p-1.5 text-sky-400 hover:bg-slate-800"
                        title="Descargar archivo"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteFile(f.id)}
                          className="rounded-lg p-1.5 text-rose-400 hover:bg-slate-800"
                          title="Eliminar comprobante"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {storedFiles.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    Todavía no hay archivos almacenados en este tenant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
