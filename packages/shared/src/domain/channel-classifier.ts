import { CANAL_PEDIDO_OPCIONES, type CanalPedido } from "./constants.js";

export interface ClasificarCanalInput {
  tipoArchivo?: string | undefined;
  cliente?: string | undefined;
  nombreArchivo?: string | undefined;
  notaPedido?: string | undefined;
  logistica?: string | undefined;
  canalExplicito?: string | undefined;
}

/**
 * Clasifica determinísticamente el canal operativo de un pedido.
 */
export function clasificarCanalPedido(input: ClasificarCanalInput): CanalPedido {
  const canalClean = (input.canalExplicito ?? "").trim().toLowerCase();
  if ((CANAL_PEDIDO_OPCIONES as readonly string[]).includes(canalClean)) {
    return canalClean as CanalPedido;
  }

  const tipo = (input.tipoArchivo ?? "").trim().toLowerCase();
  const cli = (input.cliente ?? "").trim().toLowerCase();
  const arch = (input.nombreArchivo ?? "").trim().toLowerCase();
  const nota = (input.notaPedido ?? "").trim().toLowerCase();
  const log = (input.logistica ?? "").trim().toLowerCase();
  const texto = `${cli} ${arch} ${nota}`;

  if (texto.includes("full")) {
    return "full";
  }
  if (
    tipo === "docx" ||
    cli.includes("mercado libre") ||
    nota.startsWith("ml") ||
    arch.startsWith("ml_")
  ) {
    return "mercado_libre";
  }
  if (log === "canje" || tipo === "excel") {
    return "canje";
  }
  if (tipo === "pdf" || cli.length > 0 || nota.length > 0) {
    return "mayorista";
  }
  return "otro";
}
