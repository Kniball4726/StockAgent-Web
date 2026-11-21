import {
  FileUploadCategorySchema,
  type FileUploadCategory,
  type StoredFileDto,
} from "@stockagent/shared";
import { AuditChatRepository } from "../repositories/audit-chat-repository.js";
import {
  ConflictError,
  DomainError,
  NotFoundError,
  runInTenantTx,
  type TenantScope,
} from "../repositories/base.js";
import { OrderRepository } from "../repositories/order-repository.js";
import { hashSha256 } from "../security/crypto.js";
import {
  assertKeyBelongsToTenant,
  resolveMimeTypeByFilename,
  sanitizeUploadFilename,
  type StorageAdapter,
} from "../storage/index.js";

function mapStoredFileRow(
  row: {
    id: string;
    tenantId: string;
    category: string;
    originalName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedBy: string;
    createdAt: Date;
  },
  deduplicated = false
): StoredFileDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    category: row.category,
    originalName: row.originalName,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    deduplicated,
  };
}

export interface UploadFileInput {
  category: FileUploadCategory;
  originalName: string;
  buffer: Buffer;
  mimeType?: string | undefined;
  uploadedBy: string;
  rejectDuplicateOrder?: boolean | undefined;
  rejectDuplicateFile?: boolean | undefined;
}

export interface UploadFileResult {
  file: StoredFileDto;
  duplicateOfOrder: string | null;
}

export class FileUploadService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly auditRepo: AuditChatRepository,
    private readonly orderRepo: OrderRepository,
    private readonly maxFileBytes = 25 * 1024 * 1024
  ) {}

  async uploadFile(
    scope: TenantScope,
    input: UploadFileInput
  ): Promise<UploadFileResult> {
    const category = FileUploadCategorySchema.parse(input.category);
    const { safeName } = sanitizeUploadFilename(input.originalName);

    if (input.buffer.byteLength <= 0) {
      throw new DomainError(
        "EMPTY_FILE",
        `El archivo '${safeName}' está vacío.`,
        400
      );
    }
    if (input.buffer.byteLength > this.maxFileBytes) {
      throw new DomainError(
        "FILE_TOO_LARGE",
        `El archivo '${safeName}' supera el máximo permitido (${Math.round(this.maxFileBytes / (1024 * 1024))} MB).`,
        413
      );
    }

    const mimeType = resolveMimeTypeByFilename(safeName, input.mimeType);
    const sha256 = hashSha256(input.buffer);
    let newlyWrittenKey: string | null = null;

    try {
      return await runInTenantTx(scope, async (tx, tenantId) => {
        const txScope: TenantScope = { db: scope.db, tenantId, tx };

        const confirmedMap = await this.orderRepo.findConfirmedOrdersByHashes(
          txScope,
          [sha256]
        );
        const duplicateOfOrder = confirmedMap.get(sha256) ?? null;
        if (duplicateOfOrder && input.rejectDuplicateOrder) {
          throw new ConflictError(
            `El comprobante ya fue confirmado en el pedido '${duplicateOfOrder}'.`,
            "DUPLICATE_CONFIRMED_ORDER"
          );
        }

        const existingFile = await this.auditRepo.findStoredFileBySha256(
          txScope,
          sha256
        );
        if (existingFile) {
          if (input.rejectDuplicateFile) {
            throw new ConflictError(
              `Ya existe un archivo idéntico registrado (${existingFile.originalName}).`,
              "DUPLICATE_STORED_FILE"
            );
          }

          assertKeyBelongsToTenant(existingFile.storageKey, tenantId);
          const head = await this.storage.headObject(existingFile.storageKey);
          if (!head) {
            await this.storage.putObject({
              key: existingFile.storageKey,
              body: input.buffer,
              contentType: mimeType,
              metadata: { tenantId, category, sha256 },
            });
          }

          return {
            file: mapStoredFileRow(existingFile, true),
            duplicateOfOrder,
          };
        }

        const storageKey = this.storage.buildTenantKey({
          tenantId,
          category,
          sha256,
          originalName: safeName,
        });

        await this.storage.putObject({
          key: storageKey,
          body: input.buffer,
          contentType: mimeType,
          metadata: { tenantId, category, sha256 },
        });
        newlyWrittenKey = storageKey;

        const inserted = await this.auditRepo.registerStoredFile(txScope, {
          category,
          originalName: safeName,
          storageKey,
          mimeType,
          sizeBytes: input.buffer.byteLength,
          sha256,
          uploadedBy: input.uploadedBy.trim() || "sistema",
        });

        await this.auditRepo.logAudit(
          txScope,
          input.uploadedBy,
          "SUBIR_ARCHIVO",
          `Archivo '${safeName}' (${category}, ${input.buffer.byteLength} bytes, sha256:${sha256.slice(0, 12)}).`
        );

        return {
          file: mapStoredFileRow(inserted, false),
          duplicateOfOrder,
        };
      });
    } catch (error) {
      if (newlyWrittenKey) {
        await this.storage.deleteObject(newlyWrittenKey).catch(() => undefined);
      }
      throw error;
    }
  }

  async listFiles(
    scope: TenantScope,
    options: { category?: string | undefined; limit?: number | undefined } = {}
  ): Promise<StoredFileDto[]> {
    const rows = await this.auditRepo.listStoredFiles(scope, options);
    return rows.map((r) => mapStoredFileRow(r, false));
  }

  async getFileContent(
    scope: TenantScope,
    fileId: string
  ): Promise<{ file: StoredFileDto; body: Buffer; contentType: string }> {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const txScope: TenantScope = { db: scope.db, tenantId, tx };
      const row = await this.auditRepo.getStoredFileById(txScope, fileId);
      if (!row) {
        throw new NotFoundError(`Archivo '${fileId}' no encontrado.`);
      }
      assertKeyBelongsToTenant(row.storageKey, tenantId);
      const { body, metadata } = await this.storage.getObject(row.storageKey);
      return {
        file: mapStoredFileRow(row, false),
        body,
        contentType: row.mimeType || metadata.contentType,
      };
    });
  }

  async deleteFile(
    scope: TenantScope,
    fileId: string,
    usuario: string
  ): Promise<{ deletedId: string; storageKey: string }> {
    const deleted = await runInTenantTx(scope, async (tx, tenantId) => {
      const txScope: TenantScope = { db: scope.db, tenantId, tx };
      const row = await this.auditRepo.deleteStoredFileById(txScope, fileId);
      assertKeyBelongsToTenant(row.storageKey, tenantId);
      await this.auditRepo.logAudit(
        txScope,
        usuario,
        "ELIMINAR_ARCHIVO",
        `Archivo '${row.originalName}' (${row.id}) eliminado.`
      );
      return row;
    });

    await this.storage.deleteObject(deleted.storageKey);
    return { deletedId: deleted.id, storageKey: deleted.storageKey };
  }
}
