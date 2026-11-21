import { useState, type FormEvent } from "react";
import { normalizarCodigoLector } from "@stockagent/shared";
import type { StockAgentApiClient } from "../../lib/api-client";

interface CreateProductFormProps {
  api: StockAgentApiClient;
  onSuccess: (message: string) => Promise<void>;
  onError: (message: string) => void;
}

export function CreateProductForm({
  api,
  onSuccess,
  onError,
}: CreateProductFormProps) {
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newStock, setNewStock] = useState("0");
  const [newMin, setNewMin] = useState("5");
  const [newLoc, setNewLoc] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) {
      onError("SKU y nombre son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      await api.upsertProduct({
        code: newCode.trim(),
        name: newName.trim(),
        stock: Math.max(0, Math.trunc(Number(newStock) || 0)),
        stock_minimo: Math.max(0, Math.trunc(Number(newMin) || 0)),
        ubicacion: newLoc.trim().toUpperCase(),
        cod_barras: normalizarCodigoLector(newBarcode),
      });
      const savedCode = newCode.trim();
      setNewCode("");
      setNewName("");
      setNewStock("0");
      setNewLoc("");
      setNewBarcode("");
      await onSuccess(`Producto ${savedCode} guardado en PostgreSQL.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error creando producto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
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
  );
}
