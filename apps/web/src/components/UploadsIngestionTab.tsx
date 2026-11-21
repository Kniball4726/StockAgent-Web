import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { canUploadAndConfirm, isAdminOrMaster } from "../lib/rbac";
import { SimulationPreviewPanel } from "./uploads/SimulationPreviewPanel";
import { StoredFilesArchiveTable } from "./uploads/StoredFilesArchiveTable";
import { UploadDropzonePanel } from "./uploads/UploadDropzonePanel";

interface UploadsIngestionTabProps {
  api: StockAgentApiClient;
  user: UsuarioResponse;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `web-ing-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function UploadsIngestionTab({ api, user }: UploadsIngestionTabProps) {
  const [category, setCategory] =
    useState<FileUploadCategory>("remito_mayorista");
  const [failOnUnmatched, setFailOnUnmatched] = useState(false);
  const [sobrescribirStock, setSobrescribirStock] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [simResult, setSimResult] = useState<UploadAndSimulateResponse | null>(
    null
  );
  const [confirmResult, setConfirmResult] =
    useState<ConfirmIngestionResultDto | null>(null);
  const [storedFiles, setStoredFiles] = useState<StoredFileDto[]>([]);

  const [busy, setBusy] = useState<"idle" | "simulating" | "confirming">(
    "idle"
  );
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
        err instanceof Error
          ? err.message
          : "No se pudo eliminar el comprobante."
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">
          Cargar Archivos PC, Simulación y Confirmación
        </h2>
        <p className="text-xs text-slate-400">
          Flujo seguro en 2 pasos: 1) Subir, parsear y previsualizar impacto · 2)
          Confirmar atómicamente en PostgreSQL
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
            Unidades aplicadas:{" "}
            <strong>{confirmResult.totalUnidadesAplicadas}</strong> · Pedidos
            generados: <strong>{confirmResult.ordersCreated.length}</strong>
          </p>
        </div>
      )}

      {canOperate ? (
        <UploadDropzonePanel
          category={category}
          failOnUnmatched={failOnUnmatched}
          sobrescribirStock={sobrescribirStock}
          selectedFiles={selectedFiles}
          busy={busy}
          onCategoryChange={(next) => {
            setCategory(next);
            setSimResult(null);
            setConfirmResult(null);
          }}
          onFailOnUnmatchedChange={setFailOnUnmatched}
          onSobrescribirStockChange={setSobrescribirStock}
          onAttachFiles={attachFiles}
          onSimulate={() => void handleSimulate()}
        />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
          Tu rol <strong>{user.role}</strong> solo permite consultar
          comprobantes guardados.
        </div>
      )}

      {simResult && (
        <SimulationPreviewPanel
          simResult={simResult}
          canOperate={canOperate}
          confirmed={Boolean(confirmResult)}
          busy={busy}
          onConfirm={() => void handleConfirm()}
        />
      )}

      <StoredFilesArchiveTable
        files={storedFiles}
        isAdmin={isAdmin}
        onDownload={(f) => void handleDownloadFile(f)}
        onDelete={(id) => void handleDeleteFile(id)}
      />
    </div>
  );
}
