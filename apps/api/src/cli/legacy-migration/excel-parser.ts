import { normalizarCodigo } from "@stockagent/shared";
import ExcelJS from "exceljs";
import type { LegacyProductSeed } from "./types.js";

export function normalizeHeaderName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function toIntOrDefault(raw: unknown, fallback: number): number {
  const num = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : fallback;
}

/**
 * Parsea un archivo heredado `Productos.xlsx` para migración ÚNICA inicial hacia PostgreSQL.
 * No sincroniza ni reescribe Excel en tiempo de ejecución.
 */
export async function parseLegacyCatalogXlsx(
  buffer: Buffer
): Promise<{ items: LegacyProductSeed[]; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  await wb.xlsx.load(ab as ArrayBuffer);

  const sheet = wb.worksheets[0];
  if (!sheet) {
    return { items: [], warnings: ["El libro Excel no contiene hojas."] };
  }

  let headerRowIdx = -1;
  let colMap: Record<string, number> = {};

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowIdx !== -1) return;
    const candidateMap: Record<string, number> = {};
    row.eachCell((cell, colNumber) => {
      const h = normalizeHeaderName(cell.text ?? cell.value);
      if (h) {
        candidateMap[h] = colNumber;
      }
    });
    const keys = Object.keys(candidateMap);
    const hasCode = keys.some(
      (k) =>
        k === "codigo" ||
        k === "sku" ||
        k === "cod" ||
        k === "code" ||
        k.includes("articulo")
    );
    const hasStock = keys.some((k) => k.includes("stock"));
    if (hasCode && hasStock) {
      headerRowIdx = rowNumber;
      colMap = candidateMap;
    }
  });

  if (headerRowIdx === -1) {
    return {
      items: [],
      warnings: ["No se detectó fila de encabezados (código/stock) en Productos.xlsx."],
    };
  }

  const findCol = (predicates: string[]): number | undefined => {
    for (const [header, col] of Object.entries(colMap)) {
      if (predicates.some((p) => header === p || header.includes(p))) {
        return col;
      }
    }
    return undefined;
  };

  const codeCol = findCol(["codigo", "sku", "cod", "code", "articulo"]);
  const nameCol = findCol(["descripcion", "producto", "nombre", "name", "detalle"]);
  const stockCol = findCol(["stock", "cantidad", "saldo"]);
  const minCol = findCol(["minimo", "min", "alerta"]);
  const maxCol = findCol(["maximo", "max"]);
  const barcodeCol = findCol(["barra", "ean", "barcode", "upc"]);
  const locCol = findCol(["ubicacion", "estanteria", "pasillo", "location"]);

  const items: LegacyProductSeed[] = [];
  const warnings: string[] = [];
  const seenCodes = new Set<string>();

  for (let r = headerRowIdx + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const rawCode = codeCol ? row.getCell(codeCol).text || row.getCell(codeCol).value : "";
    const code = normalizarCodigo(rawCode);
    if (!code) continue;

    if (seenCodes.has(code.toLowerCase())) {
      warnings.push(`Fila ${r}: código duplicado '${code}' omitido.`);
      continue;
    }
    seenCodes.add(code.toLowerCase());

    const rawName = nameCol ? row.getCell(nameCol).text || row.getCell(nameCol).value : "";
    const rawStock = stockCol ? row.getCell(stockCol).value : 0;
    const rawMin = minCol ? row.getCell(minCol).value : 5;
    const rawMax = maxCol ? row.getCell(maxCol).value : 100;
    const rawBarcode = barcodeCol
      ? row.getCell(barcodeCol).text || row.getCell(barcodeCol).value
      : "";
    const rawLoc = locCol
      ? row.getCell(locCol).text || row.getCell(locCol).value
      : "";

    items.push({
      code,
      name: String(rawName ?? "").trim() || `Producto ${code}`,
      stock: toIntOrDefault(rawStock, 0),
      stockMinimo: toIntOrDefault(rawMin, 5),
      stockMaximo: Math.max(
        toIntOrDefault(rawMin, 5),
        toIntOrDefault(rawMax, 100)
      ),
      codBarras: String(rawBarcode ?? "").trim(),
      ubicacion: String(rawLoc ?? "").trim().toUpperCase(),
    });
  }

  return { items, warnings };
}
