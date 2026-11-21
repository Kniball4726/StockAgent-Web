import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FileUploadCategorySchema,
  IngestionOperationSchema,
  type FileUploadCategory,
  type IngestionOperation,
} from "@stockagent/shared";
import type { Database } from "../db/client.js";
import { parseUploadedDocumentBuffer } from "../parsers/index.js";
import { DomainError } from "../repositories/base.js";
import { ProductRepository } from "../repositories/product-repository.js";
import type { FileUploadService } from "../services/file-service.js";
import type { IngestionService } from "../services/ingestion-service.js";
import {
  assertRoles,
  authenticateRequest,
  type AuthResolver,
} from "./auth-context.js";

const ParseStoredBodySchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(20),
  category: FileUploadCategorySchema.optional(),
  operation: IngestionOperationSchema.optional(),
  simulate: z.boolean().default(true),
  failOnUnmatched: z.boolean().default(false),
});

export function registerParsersRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    authResolver: AuthResolver;
    fileService: FileUploadService;
    ingestionService: IngestionService;
    productRepo: ProductRepository;
  }
): void {
  app.post("/api/v1/parsers/upload-and-simulate", async (request) => {
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
        "Debe adjuntar al menos un archivo para parsear.",
        400
      );
    }

    const category: FileUploadCategory = FileUploadCategorySchema.parse(
      (fields.category ?? "adjunto").trim()
    );
    const operationOverride = fields.operation?.trim()
      ? IngestionOperationSchema.parse(fields.operation.trim())
      : undefined;
    const failOnUnmatched = fields.failOnUnmatched === "true";
    const rejectDuplicateOrder = fields.rejectDuplicateOrder === "true";

    const scope = { db: deps.db, tenantId: auth.tenantId };
    const catalogRows = await deps.productRepo.listProducts(scope, true);
    const catalogSimple = catalogRows.map((p) => ({
      codigo: p.code,
      nombre: p.name,
    }));

    const uploadedFiles = [];
    const parsedEnvelopes = [];

    for (const item of pendingFiles) {
      const uploaded = await deps.fileService.uploadFile(scope, {
        category,
        originalName: item.filename,
        buffer: item.buffer,
        mimeType: item.mimetype,
        uploadedBy: auth.username,
        rejectDuplicateOrder,
      });
      uploadedFiles.push(uploaded);

      const envelope = await parseUploadedDocumentBuffer({
        category,
        buffer: item.buffer,
        filename: item.filename,
        sha256: uploaded.file.sha256,
        sourceFileId: uploaded.file.id,
        operationOverride,
        catalog: catalogSimple,
      });
      parsedEnvelopes.push(envelope);
    }

    const operation: IngestionOperation =
      operationOverride ??
      parsedEnvelopes[0]?.suggestedOperation ??
      "descuento_pedidos";

    const simulation = await deps.ingestionService.simulate(scope, {
      operation,
      documents: parsedEnvelopes.map((e) => e.document),
      failOnUnmatched,
    });

    return {
      ok: true,
      operation,
      uploadedFiles,
      parsedDocuments: parsedEnvelopes,
      simulation,
    };
  });

  app.post("/api/v1/parsers/parse-stored", async (request) => {
    const auth = await authenticateRequest(request, deps.authResolver);
    assertRoles(auth, ["administrador", "operador", "picker"]);

    const body = ParseStoredBodySchema.parse(request.body);
    const scope = { db: deps.db, tenantId: auth.tenantId };

    const catalogRows = await deps.productRepo.listProducts(scope, true);
    const catalogSimple = catalogRows.map((p) => ({
      codigo: p.code,
      nombre: p.name,
    }));

    const parsedEnvelopes = [];
    for (const fileId of body.fileIds) {
      const { file, body: buffer } = await deps.fileService.getFileContent(
        scope,
        fileId
      );
      const effectiveCat =
        body.category ??
        FileUploadCategorySchema.parse(file.category || "adjunto");

      const envelope = await parseUploadedDocumentBuffer({
        category: effectiveCat,
        buffer,
        filename: file.originalName,
        sha256: file.sha256,
        sourceFileId: file.id,
        operationOverride: body.operation,
        catalog: catalogSimple,
      });
      parsedEnvelopes.push(envelope);
    }

    const operation: IngestionOperation =
      body.operation ??
      parsedEnvelopes[0]?.suggestedOperation ??
      "descuento_pedidos";

    const simulation = body.simulate
      ? await deps.ingestionService.simulate(scope, {
          operation,
          documents: parsedEnvelopes.map((e) => e.document),
          failOnUnmatched: body.failOnUnmatched,
        })
      : null;

    return {
      ok: true,
      operation,
      parsedDocuments: parsedEnvelopes,
      simulation,
    };
  });
}
