import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  auditLogs,
  chatMessageReads,
  chatMessages,
  orders,
  storedFiles,
} from "../db/schema/index.js";
import {
  ConflictError,
  NotFoundError,
  runInTenantTx,
  type TenantScope,
} from "./base.js";

export class AuditChatRepository {
  async logAudit(
    scope: TenantScope,
    usuario: string,
    accion: string,
    detalle: string
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .insert(auditLogs)
        .values({
          tenantId,
          usuario: usuario.trim() || "sistema",
          accion: accion.trim(),
          detalle: detalle.trim(),
        })
        .returning();
      return row ?? null;
    });
  }

  async listAuditLogs(scope: TenantScope, limit = 100) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      return tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, tenantId))
        .orderBy(desc(auditLogs.id))
        .limit(limit);
    });
  }

  async sendChatMessage(
    scope: TenantScope,
    input: {
      emisor: string;
      mensaje: string;
      destinatario?: string | undefined;
    }
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [msg] = await tx
        .insert(chatMessages)
        .values({
          tenantId,
          emisor: input.emisor.trim(),
          destinatario: (input.destinatario ?? "Todos").trim() || "Todos",
          mensaje: input.mensaje.trim(),
        })
        .returning();
      if (!msg) {
        throw new Error("No se pudo enviar el mensaje de chat.");
      }
      return msg;
    });
  }

  async listChatMessages(
    scope: TenantScope,
    usuario: string,
    limit = 60
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      return tx
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.tenantId, tenantId),
            sql`(${chatMessages.destinatario} = 'Todos' OR lower(${chatMessages.destinatario}) = lower(${usuario}) OR lower(${chatMessages.emisor}) = lower(${usuario}))`
          )
        )
        .orderBy(desc(chatMessages.id))
        .limit(limit);
    });
  }

  async markChatMessagesRead(scope: TenantScope, usuario: string) {
    await runInTenantTx(scope, async (tx, tenantId) => {
      const unread = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.tenantId, tenantId),
            sql`lower(${chatMessages.emisor}) <> lower(${usuario})`,
            sql`(${chatMessages.destinatario} = 'Todos' OR lower(${chatMessages.destinatario}) = lower(${usuario}))`
          )
        );

      if (unread.length === 0) {
        return;
      }

      await tx
        .insert(chatMessageReads)
        .values(
          unread.map((m) => ({
            tenantId,
            messageId: m.id,
            usuario: usuario.trim(),
          }))
        )
        .onConflictDoNothing();
    });
  }

  async registerStoredFile(
    scope: TenantScope,
    input: {
      category: string;
      originalName: string;
      storageKey: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      uploadedBy: string;
    }
  ) {
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .insert(storedFiles)
        .values({
          tenantId,
          category: input.category,
          originalName: input.originalName,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          uploadedBy: input.uploadedBy,
        })
        .returning();
      if (!row) {
        throw new Error("No se pudo registrar el metadato del archivo.");
      }
      return row;
    });
  }

  async findStoredFileBySha256(scope: TenantScope, sha256: string) {
    const clean = sha256.trim();
    if (!clean) {
      return null;
    }
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .select()
        .from(storedFiles)
        .where(
          and(eq(storedFiles.tenantId, tenantId), eq(storedFiles.sha256, clean))
        )
        .limit(1);
      return row ?? null;
    });
  }

  async listStoredFiles(
    scope: TenantScope,
    options: { category?: string | undefined; limit?: number | undefined } = {}
  ) {
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const categoryClean = options.category?.trim();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const whereClause = categoryClean
        ? and(
            eq(storedFiles.tenantId, tenantId),
            eq(storedFiles.category, categoryClean)
          )
        : eq(storedFiles.tenantId, tenantId);

      return tx
        .select()
        .from(storedFiles)
        .where(whereClause)
        .orderBy(desc(storedFiles.createdAt))
        .limit(limit);
    });
  }

  async getStoredFileById(scope: TenantScope, fileId: string) {
    const cleanId = fileId.trim();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .select()
        .from(storedFiles)
        .where(
          and(eq(storedFiles.tenantId, tenantId), eq(storedFiles.id, cleanId))
        )
        .limit(1);
      return row ?? null;
    });
  }

  async getStoredFileByKey(scope: TenantScope, storageKey: string) {
    const cleanKey = storageKey.trim();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [row] = await tx
        .select()
        .from(storedFiles)
        .where(
          and(
            eq(storedFiles.tenantId, tenantId),
            eq(storedFiles.storageKey, cleanKey)
          )
        )
        .limit(1);
      return row ?? null;
    });
  }

  async deleteStoredFileById(scope: TenantScope, fileId: string) {
    const cleanId = fileId.trim();
    return runInTenantTx(scope, async (tx, tenantId) => {
      const [existing] = await tx
        .select()
        .from(storedFiles)
        .where(
          and(eq(storedFiles.tenantId, tenantId), eq(storedFiles.id, cleanId))
        )
        .limit(1);

      if (!existing) {
        throw new NotFoundError(`Archivo '${cleanId}' no encontrado.`);
      }

      const [linkedOrder] = await tx
        .select({ id: orders.id, notaPedido: orders.notaPedido })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, tenantId),
            eq(orders.estado, "descontado"),
            or(
              eq(orders.archivoDescuentoKey, existing.storageKey),
              existing.sha256 ? eq(orders.archivoHash, existing.sha256) : sql`false`
            )
          )
        )
        .limit(1);

      if (linkedOrder) {
        throw new ConflictError(
          `No se puede eliminar el comprobante porque respalda al pedido '${linkedOrder.notaPedido}'.`
        );
      }

      await tx
        .delete(storedFiles)
        .where(
          and(eq(storedFiles.tenantId, tenantId), eq(storedFiles.id, cleanId))
        );

      return existing;
    });
  }
}
