import { Download, FileSpreadsheet, Trash2 } from "lucide-react";
import type { StoredFileDto } from "@stockagent/shared";
import { formatBytes, formatDateTime } from "../../lib/rbac";

interface StoredFilesArchiveTableProps {
  files: StoredFileDto[];
  isAdmin: boolean;
  onDownload: (file: StoredFileDto) => void;
  onDelete: (fileId: string) => void;
}

export function StoredFilesArchiveTable({
  files,
  isAdmin,
  onDownload,
  onDelete,
}: StoredFilesArchiveTableProps) {
  return (
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
            {files.map((f) => (
              <tr key={f.id} className="hover:bg-slate-800/30">
                <td className="py-2 pr-3 font-medium text-slate-200">
                  {f.originalName}
                </td>
                <td className="py-2 pr-3 font-mono text-slate-400">
                  {f.category}
                </td>
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
                      onClick={() => onDownload(f)}
                      className="rounded-lg p-1.5 text-sky-400 hover:bg-slate-800"
                      title="Descargar archivo"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => onDelete(f.id)}
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
            {files.length === 0 && (
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
  );
}
