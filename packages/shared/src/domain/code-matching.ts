/**
 * Limpia un código numérico o SKU removiendo espacios y sufijos `.0`.
 */
export function normalizarCodigo(raw: unknown): string {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return "";
  }
  const text =
    typeof raw === "number"
      ? Number.isFinite(raw)
        ? Number.isInteger(raw)
          ? String(Math.trunc(raw))
          : String(raw)
        : ""
      : String(raw);
  const trimmed = text.trim();
  return trimmed.replace(/^(-?\d+)\.0+$/, "$1");
}

/**
 * Normaliza lecturas provenientes de pistolas HID / colectores / escáner cámara.
 * Elimina prefijos AIM (`]C1`, `]e0`), caracteres de control y delimitadores Code-39 `*...*`.
 */
export function normalizarCodigoLector(raw: unknown): string {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return "";
  }

  let text = "";
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return "";
    }
    text = Number.isInteger(raw) ? String(Math.trunc(raw)) : String(raw);
  } else {
    text = String(raw);
  }

  text = text.trim();
  if (!text) {
    return "";
  }

  // Eliminar prefijo estándar AIM Symbology Identifier (ej. ]C1, ]e0, ]E0)
  text = text.replace(/^\][A-Za-z][0-9]/, "");

  // Eliminar caracteres ASCII de control no imprimibles (0x00..0x1F y 0x7F)
  let printable = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code >= 32 && code <= 126) || code > 127) {
      printable += ch;
    }
  }
  text = printable.trim();

  // Eliminar delimitadores Start/Stop de Code 39 (*CODIGO*)
  if (text.length >= 3 && text.startsWith("*") && text.endsWith("*")) {
    text = text.slice(1, -1).trim();
  }

  return text.replace(/^(-?\d+)\.0+$/, "$1").trim();
}

/**
 * Genera variantes ordenadas para matching tolerante a teclado HID US->ES/LA y EAN-13/UPC-A.
 */
export function generarVariantesCodigoLector(raw: unknown): string[] {
  const base = normalizarCodigoLector(raw);
  if (!base) {
    return [];
  }

  const variantes: string[] = [];
  const vistos = new Set<string>();

  const agregar = (candidato: string) => {
    const limpio = candidato.trim();
    if (limpio && !vistos.has(limpio)) {
      vistos.add(limpio);
      variantes.push(limpio);
    }
  };

  agregar(base);

  const basesTeclado: string[] = [base];
  const sinAimEs = base.replace(/^[+}´][A-Za-z][0-9]/, "").trim();
  if (sinAimEs && sinAimEs !== base) {
    agregar(sinAimEs);
    basesTeclado.push(sinAimEs);
  }

  for (let i = 0; i < basesTeclado.length; i += 1) {
    const origen = basesTeclado[i];
    if (!origen) {
      continue;
    }
    if (origen.includes("'") || origen.includes("?")) {
      const corregido = origen.replaceAll("'", "-").replaceAll("?", "_");
      agregar(corregido);
      if (!basesTeclado.includes(corregido)) {
        basesTeclado.push(corregido);
      }
    }
    const sinEspacios = origen.replace(/\s+/g, "");
    if (sinEspacios !== origen) {
      agregar(sinEspacios);
      if (!basesTeclado.includes(sinEspacios)) {
        basesTeclado.push(sinEspacios);
      }
    }
  }

  const actuales = [...variantes];
  for (const cand of actuales) {
    if (/^\d+$/.test(cand)) {
      if (cand.length === 13 && cand.startsWith("0")) {
        agregar(cand.slice(1));
      } else if (cand.length === 12) {
        agregar(`0${cand}`);
      }
      const sinCeros = cand.replace(/^0+/, "") || "0";
      agregar(sinCeros);
    }
  }

  return variantes;
}

export function coincideCodigoOBarras(
  producto: {
    code?: string | null;
    codBarras?: string | null;
    cod_barras?: string | null;
  },
  rawQuery: unknown
): boolean {
  const variantesQuery = generarVariantesCodigoLector(rawQuery);
  if (variantesQuery.length === 0) {
    return false;
  }

  const candidatosProd = new Set<string>();
  const fields = [producto.code, producto.codBarras ?? producto.cod_barras];
  for (const field of fields) {
    for (const variant of generarVariantesCodigoLector(field)) {
      candidatosProd.add(variant.toLowerCase());
    }
  }

  return variantesQuery.some((v) => candidatosProd.has(v.toLowerCase()));
}
