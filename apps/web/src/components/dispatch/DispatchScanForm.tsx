import { Camera, QrCode } from "lucide-react";
import type { FormEvent } from "react";
import type { DispatchStatusTarget } from "../../lib/offline-dispatch-queue";

interface DispatchScanFormProps {
  targetState: DispatchStatusTarget;
  qrInput: string;
  isOnline: boolean;
  onTargetStateChange: (next: DispatchStatusTarget) => void;
  onQrInputChange: (next: string) => void;
  onSubmit: (e: FormEvent) => void;
  onOpenCamera: () => void;
}

export function DispatchScanForm({
  targetState,
  qrInput,
  isOnline,
  onTargetStateChange,
  onQrInputChange,
  onSubmit,
  onOpenCamera,
}: DispatchScanFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 flex flex-wrap gap-2 items-center"
    >
      <select
        value={targetState}
        onChange={(e) =>
          onTargetStateChange(e.target.value as DispatchStatusTarget)
        }
        aria-label="Estado destino del escaneo"
        className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"
      >
        <option value="despachado">Marcar Despachado</option>
        <option value="entregado">Marcar Entregado</option>
        <option value="armado">Volver a Armado</option>
      </select>

      <div className="relative flex-1 min-w-[220px]">
        <QrCode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-400" />
        <input
          type="text"
          value={qrInput}
          onChange={(e) => onQrInputChange(e.target.value)}
          placeholder="Escanear QR remito (ej: REMITO:NP-001|BULTO:1/2 o NP-001)..."
          className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        className="rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
      >
        {isOnline ? "Confirmar QR" : "Encolar Offline"}
      </button>

      <button
        type="button"
        onClick={onOpenCamera}
        className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
      >
        <Camera className="h-4 w-4" />
        Cámara QR
      </button>
    </form>
  );
}
