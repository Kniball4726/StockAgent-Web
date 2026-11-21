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
