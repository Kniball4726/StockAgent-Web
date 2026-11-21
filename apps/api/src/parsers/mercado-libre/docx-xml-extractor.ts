import { XMLParser } from "fast-xml-parser";

type XmlOrderedNode = Record<string, unknown>;

export function extraerProductoNumerado(
  linea: string
): [number, string] | null {
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

export function extractParagraphsAndTablesFromDocXml(xmlText: string): {
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

export function extractNumberedItemsFromDocXml(
  xmlText: string
): Array<[number, string]> {
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

  return registros;
}
