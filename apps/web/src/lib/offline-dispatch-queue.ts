import { normalizarCodigoLector } from "@stockagent/shared";

export type DispatchStatusTarget = "armado" | "despachado" | "entregado";

export interface QueuedDispatchScan {
  id: string;
  codigo: string;
  nuevo_estado: DispatchStatusTarget;
  queuedAt: string;
  attempts: number;
  lastError?: string | undefined;
}

export interface DispatchBatchItemResult {
  ok: boolean;
  codigo: string;
  message?: string | undefined;
  nota_pedido?: string | undefined;
  estado_despacho?: string | undefined;
}

export interface DispatchBatchResponse {
  ok: boolean;
  total_procesados?: number;
  total?: number;
  exitosos: number;
  fallidos: number;
  resultados: DispatchBatchItemResult[];
}

export interface QueueFlushSummary {
  syncedCount: number;
  rejected: Array<{ item: QueuedDispatchScan; reason: string }>;
  remainingCount: number;
  networkFailed: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEFAULT_QUEUE_PREFIX = "stockagent_offline_dispatch_v1";

function createScanId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class OfflineDispatchQueue {
  private readonly storageKey: string;
  private readonly storage: StorageLike;

  constructor(tenantId = "default", storage?: StorageLike) {
    this.storageKey = `${DEFAULT_QUEUE_PREFIX}:${tenantId}`;
    if (storage) {
      this.storage = storage;
    } else if (typeof window !== "undefined" && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      const mem = new Map<string, string>();
      this.storage = {
        getItem: (k) => mem.get(k) ?? null,
        setItem: (k, v) => {
          mem.set(k, v);
        },
        removeItem: (k) => {
          mem.delete(k);
        },
      };
    }
  }

  list(): QueuedDispatchScan[] {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (entry): entry is QueuedDispatchScan =>
          Boolean(entry) &&
          typeof entry.id === "string" &&
          typeof entry.codigo === "string" &&
          (entry.nuevo_estado === "armado" ||
            entry.nuevo_estado === "despachado" ||
            entry.nuevo_estado === "entregado") &&
          typeof entry.queuedAt === "string" &&
          typeof entry.attempts === "number"
      );
    } catch {
      return [];
    }
  }

  private save(items: QueuedDispatchScan[]): void {
    if (items.length === 0) {
      this.storage.removeItem(this.storageKey);
      return;
    }
    this.storage.setItem(this.storageKey, JSON.stringify(items));
  }

  enqueue(
    rawCodigo: string,
    nuevo_estado: DispatchStatusTarget,
    lastError?: string
  ): { item: QueuedDispatchScan; deduplicated: boolean; items: QueuedDispatchScan[] } {
    const codigo = normalizarCodigoLector(rawCodigo);
    if (!codigo) {
      throw new Error("El código de despacho a encolar está vacío.");
    }

    const items = this.list();
    const existingIdx = items.findIndex(
      (entry) =>
        entry.codigo.toUpperCase() === codigo.toUpperCase() &&
        entry.nuevo_estado === nuevo_estado
    );

    if (existingIdx >= 0) {
      const existing = items[existingIdx]!;
      const updated: QueuedDispatchScan = {
        ...existing,
        queuedAt: new Date().toISOString(),
        ...(lastError ? { lastError } : {}),
      };
      items[existingIdx] = updated;
      this.save(items);
      return { item: updated, deduplicated: true, items };
    }

    const created: QueuedDispatchScan = {
      id: createScanId(),
      codigo,
      nuevo_estado,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      ...(lastError ? { lastError } : {}),
    };
    items.push(created);
    this.save(items);
    return { item: created, deduplicated: false, items };
  }

  remove(id: string): QueuedDispatchScan[] {
    const filtered = this.list().filter((entry) => entry.id !== id);
    this.save(filtered);
    return filtered;
  }

  clear(): void {
    this.storage.removeItem(this.storageKey);
  }

  async flush(
    sendBatch: (
      items: Array<{ codigo: string; nuevo_estado: DispatchStatusTarget }>
    ) => Promise<DispatchBatchResponse>
  ): Promise<QueueFlushSummary> {
    const pending = this.list();
    if (pending.length === 0) {
      return {
        syncedCount: 0,
        rejected: [],
        remainingCount: 0,
        networkFailed: false,
      };
    }

    try {
      const response = await sendBatch(
        pending.map((entry) => ({
          codigo: entry.codigo,
          nuevo_estado: entry.nuevo_estado,
        }))
      );

      let syncedCount = 0;
      const rejected: Array<{ item: QueuedDispatchScan; reason: string }> = [];

      pending.forEach((item, index) => {
        const res = response.resultados[index];
        if (!res || res.ok) {
          syncedCount += 1;
        } else {
          rejected.push({
            item,
            reason: res.message || "Rechazado por el servidor al sincronizar.",
          });
        }
      });

      this.save([]);
      return {
        syncedCount,
        rejected,
        remainingCount: 0,
        networkFailed: false,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Error de red al sincronizar la cola offline.";
      const updated = pending.map((entry) => ({
        ...entry,
        attempts: entry.attempts + 1,
        lastError: message,
      }));
      this.save(updated);
      return {
        syncedCount: 0,
        rejected: [],
        remainingCount: updated.length,
        networkFailed: true,
      };
    }
  }
}
