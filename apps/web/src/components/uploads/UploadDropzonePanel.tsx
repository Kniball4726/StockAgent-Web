import { FileText, Play, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import type { FileUploadCategory } from "@stockagent/shared";
import { formatBytes } from "../../lib/rbac";

export const CATEGORY_OPTIONS: Array<{
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

interface UploadDropzonePanelProps {
  category: FileUploadCategory;
  failOnUnmatched: boolean;
  sobrescribirStock: boolean;
  selectedFiles: File[];
  busy: "idle" | "simulating" | "confirming";
  onCategoryChange: (next: FileUploadCategory) => void;
  onFailOnUnmatchedChange: (next: boolean) => void;
  onSobrescribirStockChange: (next: boolean) => void;
  onAttachFiles: (files: FileList | null) => void;
  onSimulate: () => void;
}

export function UploadDropzonePanel({
  category,
  failOnUnmatched,
  sobrescribirStock,
  selectedFiles,
  busy,
  onCategoryChange,
  onFailOnUnmatchedChange,
  onSobrescribirStockChange,
  onAttachFiles,
  onSimulate,
}: UploadDropzonePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const currentHint =
    CATEGORY_OPTIONS.find((opt) => opt.value === category)?.hint ?? "";

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    onAttachFiles(e.dataTransfer.files);
  }

  return (
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
            onChange={(e) =>
              onCategoryChange(e.target.value as FileUploadCategory)
            }
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
              onChange={(e) => onFailOnUnmatchedChange(e.target.checked)}
              className="rounded border-slate-600 bg-slate-900 text-sky-500"
            />
            Bloquear confirmación si existen ítems sin coincidencia en catálogo
          </label>

          {category === "stock_fisico" && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-amber-200">
              <input
                type="checkbox"
                checked={sobrescribirStock}
                onChange={(e) => onSobrescribirStockChange(e.target.checked)}
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
          onChange={(e) => onAttachFiles(e.target.files)}
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
            onClick={onSimulate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {busy === "simulating" ? "Analizando..." : "Subir y Simular"}
          </button>
        </div>
      )}
    </section>
  );
}
