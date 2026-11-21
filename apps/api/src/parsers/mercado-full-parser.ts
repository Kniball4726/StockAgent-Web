import {
  extractRowsFromSpreadsheetGrid,
  readSpreadsheetGrid,
  stripFileExtension,
} from "./spreadsheet-reader.js";
import type { ParsedSpreadsheetSummary } from "./types.js";

const IGNORAR_CODIGOS_FULL = new Set([
  "TOTAL",
  "TOTALES",
  "SUBTOTAL",
  "RESUMEN",
]);

/**
 * Parsea planillas Excel/CSV de Mercado Envíos Full (.xlsx, .xls, .csv).
 */
export async function parsearArchivoMercadoFull(
  buffer: Buffer,
  fileName: string
): Promise<ParsedSpreadsheetSummary> {
  const grid = await readSpreadsheetGrid(buffer, fileName);
  const { consolidado, detalle, totalUnidades } =
    extractRowsFromSpreadsheetGrid(grid, {
      maxHeaderRows: 20,
      codeKeywords: [
        "SKU",
        "CODIGO",
        "CÓDIGO",
        "COD",
        "PUBLICACION",
        "PUBLICACIÓN",
        "ARTICULO",
        "ARTÍCULO",
        "MLC",
        "MLA",
      ],
      descKeywords: [
        "TITULO",
        "TÍTULO",
        "DESCRIPCION",
        "DESCRIPCIÓN",
        "PRODUCTO",
        "NOMBRE",
        "DETALLE",
      ],
      qtyKeywords: [
        "CANTIDAD",
        "CANT",
        "UNIDADES",
        "ENVIADAS",
        "ENVIAR",
        "DECLARADA",
        "DECLARADAS",
        "PIEZAS",
        "BULTOS",
      ],
      minQty: 1,
      ignoreCodes: IGNORAR_CODIGOS_FULL,
    });

  return {
    archivo: fileName,
    numeroDocumento: `FULL-${stripFileExtension(fileName)}`,
    consolidado,
    detalle,
    totalUnidades,
  };
}
