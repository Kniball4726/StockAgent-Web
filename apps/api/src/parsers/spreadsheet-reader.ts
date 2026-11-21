import { extname } from "node:path";
import ExcelJS from "exceljs";
import { normalizarCodigo } from "@stockagent/shared";
import { readFirstSheet } from "xls-reader";
import { DomainError } from "../repositories/base.js";

function coerceExcelJsValue(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) {
    return "";
  }
  if (
    typeof val === "string" ||
    typeof val === "number" ||
    typeof val === "boolean"
  ) {
    return String(val);
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === "object") {
    if ("richText" in val && Array.isArray(val.richText)) {
      return val.richText.map((part) => part.text ?? "").join("");
    }
    if ("result" in val) {
      return coerceExcelJsValue(
        (val.result ?? null) as ExcelJS.CellValue
      );
    }
    if ("text" in val && typeof val.text === "string") {
      return val.text;
    }
    if ("error" in val) {
      return String(val.error);
    }
  }
  return "";
}

function coerceXlsCell(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val);
}

function detectCsvDelimiter(sample: string): string {
  const candidates = [",", ";", "\t"] as const;
  const firstLines = sample.split(/\r?\n/).slice(0, 5).join("\n");
  let bestDelim = ",";
  let bestCount = -1;

  for (const delim of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLines.length; i += 1) {
      const ch = firstLines[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && ch === delim) {
        count += 1;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestDelim = delim;
    }
  }
  return bestCount > 0 ? bestDelim : ",";
}

export function parseCsvToGrid(buffer: Buffer): string[][] {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (!text.trim()) {
    return [];
  }

  const delim = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v.length > 0)) {
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1]!.every((v) => v.length === 0)) {
    rows.pop();
  }
  return rows;
}

/**
 * Lee la primera hoja de `.xlsx`, `.xls` o `.csv` devolviendo una matriz normalizada `string[][]` (base 0).
 */
export async function readSpreadsheetGrid(
  buffer: Buffer,
  filename: string
): Promise<string[][]> {
  const ext = extname(filename).toLowerCase();

  if (ext === ".csv") {
    return parseCsvToGrid(buffer);
  }

  if (ext === ".xls") {
    const sheet = readFirstSheet(new Uint8Array(buffer));
    if (!sheet) {
      return [];
    }
    return sheet.rows.map((r) => r.map((c) => coerceXlsCell(c).trim()));
  }

  if (ext === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return [];
    }

    const rowCount = sheet.rowCount;
    const colCount = Math.max(sheet.columnCount, 1);
    const grid: string[][] = [];

    for (let r = 1; r <= rowCount; r += 1) {
      const wsRow = sheet.getRow(r);
      const rowValues: string[] = [];
      for (let c = 1; c <= colCount; c += 1) {
        const val = wsRow.getCell(c).value;
        rowValues.push(coerceExcelJsValue(val).trim());
      }
      grid.push(rowValues);
    }
    return grid;
  }

  throw new DomainError(
    "UNSUPPORTED_SPREADSHEET_FORMAT",
    `Formato de planilla no soportado: '${ext || "(sin extensión)"}'. Use .xlsx, .xls o .csv.`,
    400
  );
}

export function parsePositiveOrZeroInt(raw: string): number | null {
  const clean = raw.trim().replace(",", ".");
  if (!clean) {
    return null;
  }
  const num = Number(clean);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.trunc(num);
}

export function stripFileExtension(filename: string): string {
  const ext = extname(filename);
  const base = ext ? filename.slice(0, filename.length - ext.length) : filename;
  return base.trim() || "documento";
}

export interface SpreadsheetColumnSpec {
  maxHeaderRows: number;
  codeKeywords: readonly string[];
  descKeywords: readonly string[];
  priorityQtyKeywords?: readonly string[] | undefined;
  qtyKeywords: readonly string[];
  minQty: number;
  ignoreCodes?: ReadonlySet<string> | undefined;
  requireNonEmptyQty?: boolean | undefined;
}

export interface SpreadsheetExtractedRow {
  codigo: string;
  descripcion: string;
  cantidad: number;
}

/**
 * Detecta columnas por encabezado (o fallback posicional) y extrae filas normalizadas de una grilla.
 */
export function extractRowsFromSpreadsheetGrid(
  grid: readonly string[][],
  spec: SpreadsheetColumnSpec
): {
  consolidado: Record<string, number>;
  detalle: SpreadsheetExtractedRow[];
  totalUnidades: number;
} {
  if (grid.length === 0) {
    return { consolidado: {}, detalle: [], totalUnidades: 0 };
  }

  let colCod = -1;
  let colDesc = -1;
  let colCant = -1;
  let filaInicio = 0;

  for (let r = 0; r < Math.min(spec.maxHeaderRows, grid.length); r += 1) {
    const vals = (grid[r] ?? []).map((v) => v.trim().toUpperCase());
    let candCod = -1;
    let candDesc = -1;
    let candCantPrio = -1;
    let candCantFallback = -1;

    for (let c = 0; c < vals.length; c += 1) {
      const val = vals[c];
      if (!val) continue;
      if (candCod === -1 && spec.codeKeywords.some((k) => val.includes(k))) {
        candCod = c;
      } else if (
        candDesc === -1 &&
        spec.descKeywords.some((k) => val.includes(k))
      ) {
        candDesc = c;
      } else if (
        candCantPrio === -1 &&
        spec.priorityQtyKeywords?.some((k) => val.includes(k))
      ) {
        candCantPrio = c;
      } else if (
        candCantFallback === -1 &&
        spec.qtyKeywords.some((k) => val.includes(k))
      ) {
        candCantFallback = c;
      }
    }

    const candCant = candCantPrio !== -1 ? candCantPrio : candCantFallback;
    if (candCod !== -1 && candCant !== -1 && candCod !== candCant) {
      colCod = candCod;
      colDesc = candDesc;
      colCant = candCant;
      filaInicio = r + 1;
      break;
    }
  }

  const maxCols = grid.reduce((acc, row) => Math.max(acc, row.length), 0);
  if (colCod === -1 || colCant === -1) {
    colCod = 0;
    colDesc = maxCols > 2 ? 1 : -1;
    colCant = maxCols > 2 ? 2 : maxCols > 1 ? 1 : 0;
    filaInicio = 0;
  }

  const detalle: SpreadsheetExtractedRow[] = [];
  const consolidado: Record<string, number> = {};
  let totalUnidades = 0;

  for (let r = filaInicio; r < grid.length; r += 1) {
    const rawCod = (grid[r]?.[colCod] ?? "").trim();
    const rawCant = (grid[r]?.[colCant] ?? "").trim();
    const rawDesc = colDesc !== -1 ? (grid[r]?.[colDesc] ?? "").trim() : "";

    if (!rawCod || spec.ignoreCodes?.has(rawCod.toUpperCase())) {
      continue;
    }
    if (spec.requireNonEmptyQty && !rawCant) {
      continue;
    }

    const cod = normalizarCodigo(rawCod);
    const cant = parsePositiveOrZeroInt(rawCant);
    if (!cod || cant === null || cant < spec.minQty) {
      continue;
    }

    detalle.push({ codigo: cod, descripcion: rawDesc, cantidad: cant });
    consolidado[cod] = (consolidado[cod] ?? 0) + cant;
    totalUnidades += cant;
  }

  return { consolidado, detalle, totalUnidades };
}
