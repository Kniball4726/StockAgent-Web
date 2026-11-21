import { normalizarCodigo } from "../domain.js";
import type { ConsolidatedItem } from "./schemas.js";

export interface ConsolidationResult {
  items: ConsolidatedItem[];
  duplicados: ConsolidatedItem[];
  totalUnidades: number;
}

/**
 * Agrupa ítems de uno o más documentos por código normalizado, sumando cantidades
 * y conservando la trazabilidad de remitos de origen.
 */
export function consolidarDocumentos(
  documents: ReadonlyArray<{
    notaPedido: string;
    nombreArchivo?: string | undefined;
    items: ReadonlyArray<{
      codigo: string;
      descripcion?: string | undefined;
      cantidad: number;
      origenRemito?: string | undefined;
    }>;
  }>,
  options: { allowZero?: boolean | undefined } = {}
): ConsolidationResult {
  const allowZero = options.allowZero ?? false;
  const agrupados = new Map<string, ConsolidatedItem>();
  let totalUnidades = 0;

  for (const doc of documents) {
    const fallbackOrigen =
      doc.notaPedido.trim() || (doc.nombreArchivo ?? "").trim();

    for (const rawItem of doc.items) {
      const code = normalizarCodigo(rawItem.codigo);
      const qty = Math.trunc(rawItem.cantidad);
      if (!code || qty < 0 || (!allowZero && qty === 0)) {
        continue;
      }

      const key = code.toLowerCase();
      const origen = (rawItem.origenRemito ?? "").trim() || fallbackOrigen;
      const desc = (rawItem.descripcion ?? "").trim();
      totalUnidades += qty;

      const existing = agrupados.get(key);
      if (!existing) {
        agrupados.set(key, {
          codigo: code,
          descripcion: desc,
          cantidadTotal: qty,
          repeticiones: 1,
          remitosOrigen: origen ? [origen] : [],
        });
      } else {
        existing.cantidadTotal += qty;
        existing.repeticiones += 1;
        if (!existing.descripcion && desc) {
          existing.descripcion = desc;
        }
        if (origen && !existing.remitosOrigen.includes(origen)) {
          existing.remitosOrigen.push(origen);
        }
      }
    }
  }

  const items = Array.from(agrupados.values());
  const duplicados = items.filter((it) => it.repeticiones > 1);
  return { items, duplicados, totalUnidades };
}
