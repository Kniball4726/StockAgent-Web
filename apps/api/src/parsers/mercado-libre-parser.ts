import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { DomainError } from "../repositories/base.js";
import { stripFileExtension } from "./spreadsheet-reader.js";
import type { ParsedRemitoItem, ParsedRemitoResult } from "./types.js";

const UMBRAL_SIMILITUD = 0.84;
const MARGEN_MINIMO_SIMILITUD = 0.08;
const SABORES = new Set([
  "banana",
  "coco",
  "chocolate",
  "dulce",
  "frambuesa",
  "frutilla",
  "leche",
  "limon",
  "naranja",
  "vainilla",
]);

export function normalizarDescripcionMl(descripcion: string): string {
  const sinAcentos = descripcion
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return sinAcentos
    .replace(/[^a-z0-9_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizarParaBusquedaMl(descripcion: string): string {
  let texto = normalizarDescripcionMl(descripcion).replace(
    /\b(\d+)(gramos?|grs?|g|kgs?|kg|ml|capsulas?|caps|comprimidos?|comp)\b/g,
    "$1 $2"
  );
  const equivalencias: Array<[RegExp, string]> = [
    [/\bultra\s+tech\b/g, "ut"],
    [/\bvitatech\b/g, "vt"],
    [/\bcreatina\b/g, "creatine"],
    [/\bcapsulas?\b/g, "caps"],
    [/\bcomprimidos?\b/g, "comp"],
    [/\bgramos?\b|\bgrs?\b/g, "g"],
    [/\bunidades\b/g, "unidad"],
  ];
  for (const [patron, reemplazo] of equivalencias) {
    texto = texto.replace(patron, reemplazo);
  }
  texto = texto.replace(/\b(de|del|x)\b/g, " ");
  return texto.trim().replace(/\s+/g, " ");
}

/**
 * Implementación Ratcliff/Obershelp equivalente a Python `difflib.SequenceMatcher(None, a, b).ratio()`.
 */
export function sequenceMatcherRatio(a: string, b: string): number {
  if (!a && !b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  function longestCommonMatch(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
  ): [number, number, number] {
    let bestI = aStart;
    let bestJ = bStart;
    let bestSize = 0;

    let run = new Map<number, number>();
    for (let i = aStart; i < aEnd; i += 1) {
      const nextRun = new Map<number, number>();
      const chA = a[i];
      for (let j = bStart; j < bEnd; j += 1) {
        if (chA === b[j]) {
          const k = (run.get(j - 1) ?? 0) + 1;
          nextRun.set(j, k);
          if (k > bestSize) {
            bestSize = k;
            bestI = i - k + 1;
            bestJ = j - k + 1;
          }
        }
      }
      run = nextRun;
    }
    return [bestI, bestJ, bestSize];
  }

  let matchedChars = 0;
  const queue: Array<[number, number, number, number]> = [
    [0, a.length, 0, b.length],
  ];

  while (queue.length > 0) {
    const [aStart, aEnd, bStart, bEnd] = queue.pop()!;
    const [i, j, k] = longestCommonMatch(aStart, aEnd, bStart, bEnd);
    if (k > 0) {
      matchedChars += k;
      if (aStart < i && bStart < j) {
        queue.push([aStart, i, bStart, j]);
      }
      if (i + k < aEnd && j + k < bEnd) {
        queue.push([i + k, aEnd, j + k, bEnd]);
      }
    }
  }

  return (2 * matchedChars) / (a.length + b.length);
}

/**
 * Busca el código de catálogo correspondiente a una descripción libre de Mercado Libre.
 */
export function buscarCodigoPorDescripcionMl(
  descripcion: string,
  descripcionesCatalogo: ReadonlyMap<string, readonly string[]>
): { codigo: string | null; motivo: string } {
  const clave = normalizarParaBusquedaMl(descripcion);
  const catalogoNorm = new Map<string, string[]>();
  for (const [codigo, nombres] of descripcionesCatalogo.entries()) {
    catalogoNorm.set(
      codigo,
      nombres.map((n) => normalizarParaBusquedaMl(n))
    );
  }

  const exactCodes: string[] = [];
  for (const [codigo, nombres] of catalogoNorm.entries()) {
    if (nombres.includes(clave)) {
      exactCodes.push(codigo);
    }
  }
  if (exactCodes.length === 1) {
    return { codigo: exactCodes[0]!, motivo: "" };
  }
  if (exactCodes.length > 1) {
    return {
      codigo: null,
      motivo: "Descripción coincidente con más de un código del catálogo",
    };
  }

  const tokens = clave ? clave.split(" ") : [];
  if (tokens.length === 0) {
    return {
      codigo: null,
      motivo: "No se encontró una coincidencia exacta en el catálogo",
    };
  }

  const tokensProducto = new Set(
    tokens.filter((t) => t !== "ut" && t !== "vt")
  );
  if (tokensProducto.size > 0) {
    const codigosPorTerminos: string[] = [];
    for (const [codigo, nombres] of catalogoNorm.entries()) {
      const matched = nombres.some((nombre) => {
        const nameSet = new Set(
          nombre.split(" ").filter((t) => t !== "ut" && t !== "vt")
        );
        for (const reqTok of tokensProducto) {
          if (!nameSet.has(reqTok)) {
            return false;
          }
        }
        return true;
      });
      if (matched) {
        codigosPorTerminos.push(codigo);
      }
    }
    if (codigosPorTerminos.length === 1) {
      return { codigo: codigosPorTerminos[0]!, motivo: "" };
    }
    if (codigosPorTerminos.length > 1) {
      return {
        codigo: null,
        motivo: "Coincidencia aproximada ambigua entre varios productos",
      };
    }
  }

  const numerosConsulta = new Set(tokens.filter((t) => /^\d+$/.test(t)));
  const saboresConsulta = new Set(tokens.filter((t) => SABORES.has(t)));
  const puntuaciones: Array<[string, number]> = [];

  for (const [codigo, nombres] of catalogoNorm.entries()) {
    let puntuacion = 0;
    for (const nombre of nombres) {
      const tokensNombre = nombre ? nombre.split(" ") : [];
      if (tokensNombre.length === 0 || tokensNombre[0] !== tokens[0]) {
        continue;
      }

      const numerosProducto = tokensNombre.filter((t) => /^\d+$/.test(t));
      if (numerosProducto.some((n) => !numerosConsulta.has(n))) {
        continue;
      }

      const saboresProducto = tokensNombre.filter((t) => SABORES.has(t));
      if (
        saboresConsulta.size > 0 &&
        saboresProducto.length > 0 &&
        !saboresProducto.some((s) => saboresConsulta.has(s))
      ) {
        continue;
      }

      const ratio = sequenceMatcherRatio(clave, nombre);
      if (ratio > puntuacion) {
        puntuacion = ratio;
      }
    }

    if (puntuacion >= UMBRAL_SIMILITUD) {
      puntuaciones.push([codigo, puntuacion]);
    }
  }

  puntuaciones.sort((a, b) => b[1] - a[1]);
  if (puntuaciones.length > 0) {
    const first = puntuaciones[0]!;
    const second = puntuaciones[1];
    if (second && first[1] - second[1] < MARGEN_MINIMO_SIMILITUD) {
      return {
        codigo: null,
        motivo: "Coincidencia aproximada ambigua entre varios productos",
      };
    }
    return { codigo: first[0], motivo: "" };
  }

  return {
    codigo: null,
    motivo: "No se encontró una coincidencia suficientemente clara en el catálogo",
  };
}

function extraerProductoNumerado(linea: string): [number, string] | null {
  const match = linea.match(/^\s*(\d+)[.)]?\s+(.+?)\s*$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const qty = Number(match[1]);
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }
  return [Math.trunc(qty), match[2].trim()];
}

type XmlOrderedNode = Record<string, unknown>;

function collectParagraphText(nodes: unknown): string {
  if (!Array.isArray(nodes)) {
    return "";
  }
  let out = "";
  for (const rawNode of nodes) {
    if (typeof rawNode !== "object" || rawNode === null) {
      continue;
    }
    const node = rawNode as XmlOrderedNode;
    if ("#text" in node) {
      out += String(node["#text"] ?? "");
      continue;
    }
    for (const [tag, value] of Object.entries(node)) {
      if (tag === ":@") {
        continue;
      }
      if (tag === "w:br" || tag === "w:cr") {
        out += "\n";
      } else if (tag === "w:tab") {
        out += " ";
      } else {
        out += collectParagraphText(value);
      }
    }
  }
  return out;
}

function extractParagraphsAndTablesFromDocXml(xmlText: string): {
  paragraphs: string[];
  tables: string[][][];
} {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false,
  });
  const docTree = parser.parse(xmlText) as XmlOrderedNode[];

  const paragraphs: string[] = [];
  const tables: string[][][] = [];

  function findNodesByTag(
    nodes: unknown,
    targetTag: string
  ): XmlOrderedNode[][] {
    const found: XmlOrderedNode[][] = [];
    if (!Array.isArray(nodes)) {
      return found;
    }
    for (const rawNode of nodes) {
      if (typeof rawNode !== "object" || rawNode === null) {
        continue;
      }
      const node = rawNode as XmlOrderedNode;
      if (targetTag in node && Array.isArray(node[targetTag])) {
        found.push(node[targetTag] as XmlOrderedNode[]);
      }
      for (const [tag, child] of Object.entries(node)) {
        if (tag !== ":@" && tag !== "#text" && Array.isArray(child)) {
          found.push(...findNodesByTag(child, targetTag));
        }
      }
    }
    return found;
  }

  function walkBody(nodes: unknown): void {
    if (!Array.isArray(nodes)) {
      return;
    }
    for (const rawNode of nodes) {
      if (typeof rawNode !== "object" || rawNode === null) {
        continue;
      }
      const node = rawNode as XmlOrderedNode;
      if ("w:document" in node) {
        walkBody(node["w:document"]);
        continue;
      }
      if ("w:body" in node) {
        walkBody(node["w:body"]);
        continue;
      }
      if ("w:p" in node) {
        paragraphs.push(collectParagraphText(node["w:p"]));
        continue;
      }
      if ("w:tbl" in node) {
        const tblRows = findNodesByTag(node["w:tbl"], "w:tr");
        const tableMatrix: string[][] = [];
        for (const trChildren of tblRows) {
          const tcCells = trChildren.filter(
            (c) => typeof c === "object" && c !== null && "w:tc" in c
          );
          const rowCells: string[] = [];
          for (const tcNode of tcCells) {
            const pList = findNodesByTag(tcNode["w:tc"], "w:p");
            const cellText = pList
              .map((p) => collectParagraphText(p))
              .join("\n");
            rowCells.push(cellText);
          }
          tableMatrix.push(rowCells);
        }
        tables.push(tableMatrix);
      }
    }
  }

  walkBody(docTree);
  return { paragraphs, tables };
}

/**
 * Parsea un documento `.docx` de Mercado Libre desde Buffer en memoria.
 */
export async function parsearPedidoMercadoLibreDocx(
  buffer: Buffer,
  fileName: string,
  productosCatalogo: ReadonlyArray<{ codigo: string; nombre: string }>
): Promise<ParsedRemitoResult> {
  let xmlText = "";
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      throw new Error("Falta word/document.xml en el paquete DOCX.");
    }
    xmlText = await docEntry.async("string");
  } catch (error) {
    throw new DomainError(
      "INVALID_DOCX",
      `No se pudo leer el archivo DOCX '${fileName}': ${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }

  const descripcionesCatalogo = new Map<string, string[]>();
  for (const prod of productosCatalogo) {
    if (!prod.nombre) {
      continue;
    }
    const existing = descripcionesCatalogo.get(prod.codigo);
    if (!existing) {
      descripcionesCatalogo.set(prod.codigo, [prod.nombre]);
    } else if (!existing.includes(prod.nombre)) {
      existing.push(prod.nombre);
    }
  }

  const { paragraphs, tables } = extractParagraphsAndTablesFromDocXml(xmlText);
  const registros: Array<[number, string]> = [];

  for (const paraText of paragraphs) {
    for (const linea of paraText.split(/\r?\n/)) {
      const producto = extraerProductoNumerado(linea);
      if (producto) {
        registros.push(producto);
      }
    }
  }

  for (const table of tables) {
    for (const rawRow of table) {
      const celdas = rawRow.map((cellText) =>
        cellText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      );
      const productosFila: Array<[number, string]> = [];
      const vistosEnFila = new Set<string>();

      for (let indice = 0; indice < celdas.length; indice += 1) {
        const lineasCelda = celdas[indice] ?? [];
        for (const linea of lineasCelda) {
          const producto = extraerProductoNumerado(linea);
          if (producto) {
            const key = `${producto[0]}\0${producto[1]}`;
            if (!vistosEnFila.has(key)) {
              vistosEnFila.add(key);
              productosFila.push(producto);
            }
          } else if (/^\s*\d+\s*[.)]?\s*$/.test(linea)) {
            let siguiente = indice + 1;
            while (
              siguiente < celdas.length &&
              (celdas[siguiente]?.length ?? 0) === 0
            ) {
              siguiente += 1;
            }
            const nextLines = celdas[siguiente];
            if (nextLines && nextLines.length > 0) {
              const descripcion = nextLines.join(" ");
              const qtyMatch = linea.match(/\d+/);
              if (qtyMatch?.[0]) {
                const cantidad = Number(qtyMatch[0]);
                const key = `${cantidad}\0${descripcion}`;
                if (cantidad > 0 && !vistosEnFila.has(key)) {
                  vistosEnFila.add(key);
                  productosFila.push([cantidad, descripcion]);
                }
              }
            }
          }
        }
      }
      registros.push(...productosFila);
    }
  }

  const stem = stripFileExtension(fileName);
  const numeroRemito = `ML-${stem}`;
  const items: ParsedRemitoItem[] = [];
  const sinCoincidencia = new Map<
    string,
    { cantidad: number; descripcion: string; motivo: string }
  >();

  for (const [cantidad, descripcion] of registros) {
    const { codigo, motivo } = buscarCodigoPorDescripcionMl(
      descripcion,
      descripcionesCatalogo
    );
    if (!codigo) {
      const clave = normalizarDescripcionMl(descripcion);
      const prev = sinCoincidencia.get(clave);
      if (prev) {
        prev.cantidad += cantidad;
      } else {
        sinCoincidencia.set(clave, {
          cantidad,
          descripcion,
          motivo,
        });
      }
      continue;
    }
    items.push({
      codigo,
      descripcion,
      cantidad,
      origenRemito: numeroRemito,
    });
  }

  const totalDeclarados = registros.reduce((acc, [c]) => acc + c, 0);
  const totalExtraidos = items.reduce((acc, it) => acc + it.cantidad, 0);

  return {
    archivo: fileName,
    numeroRemito,
    fecha: "Mercado Libre",
    cliente: "Mercado Libre",
    articulosDeclarados: totalDeclarados,
    articulosExtraidos: totalExtraidos,
    verificacionOk: sinCoincidencia.size === 0,
    items,
    descripcionesSinCoincidencia: Array.from(sinCoincidencia.values()).map(
      (v) => [`${v.cantidad} ${v.descripcion}`, v.motivo]
    ),
    discrepancia: sinCoincidencia.size > 0,
    codigoCliente: "",
    direccion: "",
    fechaDespacho: "",
  };
}
