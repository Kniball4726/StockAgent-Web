import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { DomainError } from "../repositories/base.js";

export function sendFormattedError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  issues?: unknown
) {
  return reply.code(statusCode).send({
    ok: false,
    detail: message,
    message,
    error: {
      code,
      message,
      ...(issues !== undefined ? { issues } : {}),
    },
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return sendFormattedError(
        reply,
        error.statusCode,
        error.code,
        error.message
      );
    }

    if (error instanceof ZodError) {
      return sendFormattedError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Los datos enviados no cumplen con el contrato esperado.",
        error.issues
      );
    }

    const fastifyErr = error as FastifyError;
    if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendFormattedError(
        reply,
        413,
        "FILE_TOO_LARGE",
        "El archivo supera el tamaño máximo permitido."
      );
    }

    const status =
      typeof fastifyErr.statusCode === "number" &&
      fastifyErr.statusCode >= 400 &&
      fastifyErr.statusCode < 500
        ? fastifyErr.statusCode
        : 500;

    return sendFormattedError(
      reply,
      status,
      fastifyErr.code ?? "INTERNAL_ERROR",
      status >= 500 ? "Error interno del servidor." : fastifyErr.message
    );
  });
}
