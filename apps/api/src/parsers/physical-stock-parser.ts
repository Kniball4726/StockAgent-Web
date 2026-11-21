import {
  extractRowsFromSpreadsheetGrid,
  readSpreadsheetGrid,
  stripFileExtension,
} from "./spreadsheet-reader.js";
import type { ParsedSpreadsheetSummary } from "./types.js";

const IGNORAR_CODIGOS_FISICO = new Set([
  "TOTAL",
  "TOTALES",
  "SUBTOTAL",
  "RESUMEN",
  "CODIGO",
  "CÓDIGO",
]);

/**
 * Parsea planillas Excel/CSV de relevamiento de Stock Físico (admite valores >= 0).
 */
export async function parsearStockFisicoSpreadsheet(
  buffer: Buffer,
  fileName: string
): Promise<ParsedSpreadsheetSummary> {
  const grid = await readSpreadsheetGrid(buffer, fileName);
  const { consolidado, detalle, totalUnidades } =
    extractRowsFromSpreadsheetGrid(grid, {
      maxHeaderRows: 20,
      codeKeywords: [
        "CODIGO",
        "CÓDIGO",
        "COD",
        "SKU",
        "ARTICULO",
        "ARTÍCULO",
        "ID",
      ],
      descKeywords: [
        "PRODUCTOS",
        "PRODUCTO",
        "DESCRIPCION",
        "DESCRIPCIÓN",
        "NOMBRE",
        "DETALLE",
        "TITULO",
        "TÍTULO",
      ],
      priorityQtyKeywords: [
        "STOCK FISICO",
        "STOCK FÍSICO",
        "FISICO",
        "FÍSICO",
        "CONTEO",
        "REAL",
        "RELEVADO",
      ],
      qtyKeywords: ["CANTIDAD", "CANT", "UNIDADES", "STOCK", "EXISTENCIA"],
      minQty: 0,
      ignoreCodes: IGNORAR_CODIGOS_FISICO,
      requireNonEmptyQty: true,
    });

  return {
    archivo: fileName,
    numeroDocumento: `FISICO-${stripFileExtension(fileName)}`,
    consolidado,
    detalle,
    totalUnidades,
  };
}
