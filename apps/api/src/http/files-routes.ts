import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FileUploadCategorySchema,
  type FileUploadCategory,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import { DomainError } from "../repositories/base.js";
import type { FileUploadService } from "../services/file-service.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

const FileIdParamsSchema = z.object({
  id: z.string().uuid("El identificador del archivo debe ser un UUID válido."),
});

const ListFilesQuerySchema = z.object({
  category: FileUploadCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const ContentQuerySchema = z.object({
  download: z
    .enum(["true", "false", "1", "0"])
    .optional(),
});

export function registerFilesRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    fileService: FileUploadService;
  }
): void {
  app.post("/api/v1/files/upload", async (request, reply) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador", "operador", "picker"]);

    if (!request.isMultipart()) {
      throw new DomainError(
        "INVALID_MULTIPART",
        "La carga debe enviarse como multipart/form-data.",
        400
      );
    }

    const fields: Record<string, string> = {};
    const pendingFiles: Array<{
      filename: string;
      mimetype: string;
      buffer: Buffer;
    }> = [];

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        pendingFiles.push({
          filename: part.filename,
          mimetype: part.mimetype,
          buffer,
        });
      } else if (part.type === "field" && typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }

    if (pendingFiles.length === 0) {
      throw new DomainError(
        "NO_FILES_UPLOADED",
        "Debe adjuntar al menos un archivo.",
        400
      );
    }

    const category: FileUploadCategory = FileUploadCategorySchema.parse(
      (fields.category ?? "adjunto").trim()
    );
    const rejectDuplicateOrder = fields.rejectDuplicateOrder === "true";
    const rejectDuplicateFile = fields.rejectDuplicateFile === "true";

    const results = [];
    for (const item of pendingFiles) {
      const uploaded = await deps.fileService.uploadFile(
        { db: deps.db, tenantId: auth.tenantId },
        {
          category,
          originalName: item.filename,
          buffer: item.buffer,
          mimeType: item.mimetype,
          uploadedBy: auth.username,
          rejectDuplicateOrder,
          rejectDuplicateFile,
        }
      );
      results.push(uploaded);
    }

    return reply.code(201).send({
      ok: true,
      files: results,
    });
  });

  app.get("/api/v1/files", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const query = ListFilesQuerySchema.parse(request.query);
    const files = await deps.fileService.listFiles(
      { db: deps.db, tenantId: auth.tenantId },
      { category: query.category, limit: query.limit }
    );
    return { ok: true, files };
  });

  app.get("/api/v1/files/:id/content", async (request, reply) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    const { id } = FileIdParamsSchema.parse(request.params);
    const query = ContentQuerySchema.parse(request.query);
    const forceDownload = query.download === "true" || query.download === "1";

    const { file, body, contentType } = await deps.fileService.getFileContent(
      { db: deps.db, tenantId: auth.tenantId },
      id
    );

    const disposition = forceDownload ? "attachment" : "inline";
    const quoted = encodeURIComponent(file.originalName);

    reply.header("Content-Type", contentType);
    reply.header(
      "Content-Disposition",
      `${disposition}; filename="${file.originalName}"; filename*=UTF-8''${quoted}`
    );
    reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(body);
  });

  app.delete("/api/v1/files/:id", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador", "operador"]);
    const { id } = FileIdParamsSchema.parse(request.params);

    const deleted = await deps.fileService.deleteFile(
      { db: deps.db, tenantId: auth.tenantId },
      id,
      auth.username
    );
    return { ok: true, ...deleted };
  });
}
