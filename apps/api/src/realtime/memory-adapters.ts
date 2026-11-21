import { randomUUID } from "node:crypto";
import type {
  DomainEvent,
  DomainEventHandler,
  EventBusAdapter,
  QueueAdapter,
  QueueJob,
  QueueStats,
} from "./types.js";

/**
 * Bus de eventos en memoria para desarrollo local e instancias de nodo único.
 */
export class InMemoryEventBus implements EventBusAdapter {
  public readonly driver = "memory" as const;
  private readonly listeners = new Set<DomainEventHandler>();
  private readonly history: DomainEvent[] = [];

  async publish<TPayload = Record<string, unknown>>(
    event: DomainEvent<TPayload>
  ): Promise<void> {
    this.history.push(event as DomainEvent);
    if (this.history.length > 500) {
      this.history.shift();
    }
    const snapshot = Array.from(this.listeners);
    await Promise.allSettled(
      snapshot.map(async (fn) => {
        await fn(event as DomainEvent);
      })
    );
  }

  subscribe(handler: DomainEventHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  getPublishedEvents(tenantId?: string): DomainEvent[] {
    if (!tenantId) {
      return [...this.history];
    }
    return this.history.filter((e) => e.tenantId === tenantId);
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }
}

interface InternalQueueBucket {
  pending: Array<{ id: string; job: QueueJob<unknown> }>;
  completed: number;
  failed: number;
  processing: boolean;
  worker?: (job: QueueJob<unknown>) => Promise<void>;
  idleWaiters: Array<() => void>;
}

/**
 * Cola de trabajos en memoria con reintentos configurables e interfaz compatible con BullMQ.
 */
export class InMemoryQueueAdapter implements QueueAdapter {
  public readonly driver = "memory" as const;
  private readonly queues = new Map<string, InternalQueueBucket>();
  private closed = false;

  private getOrCreateBucket(queueName: string): InternalQueueBucket {
    let bucket = this.queues.get(queueName);
    if (!bucket) {
      bucket = {
        pending: [],
        completed: 0,
        failed: 0,
        processing: false,
        idleWaiters: [],
      };
      this.queues.set(queueName, bucket);
    }
    return bucket;
  }

  private notifyIdle(bucket: InternalQueueBucket): void {
    if (!bucket.processing && bucket.pending.length === 0) {
      while (bucket.idleWaiters.length > 0) {
        bucket.idleWaiters.shift()?.();
      }
    }
  }

  private schedulePump(queueName: string): void {
    queueMicrotask(() => {
      void this.pump(queueName);
    });
  }

  private async pump(queueName: string): Promise<void> {
    if (this.closed) {
      return;
    }
    const bucket = this.queues.get(queueName);
    if (!bucket || bucket.processing || !bucket.worker) {
      return;
    }

    bucket.processing = true;
    try {
      while (!this.closed && bucket.pending.length > 0) {
        const entry = bucket.pending.shift();
        if (!entry) {
          break;
        }
        const maxAttempts = Math.max(1, entry.job.attempts ?? 1);
        const backoffMs = Math.max(0, entry.job.backoffMs ?? 0);
        let succeeded = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            await bucket.worker(entry.job);
            succeeded = true;
            break;
          } catch {
            if (attempt < maxAttempts && backoffMs > 0) {
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
        }

        if (succeeded) {
          bucket.completed += 1;
        } else {
          bucket.failed += 1;
        }
      }
    } finally {
      bucket.processing = false;
      this.notifyIdle(bucket);
    }
  }

  async enqueue<TData = Record<string, unknown>>(
    queueName: string,
    job: QueueJob<TData>
  ): Promise<string> {
    if (this.closed) {
      throw new Error("El adaptador de colas en memoria está cerrado.");
    }
    const bucket = this.getOrCreateBucket(queueName);
    const jobId = job.id?.trim() || randomUUID();
    const enriched: QueueJob<unknown> = { ...job, id: jobId };
    bucket.pending.push({ id: jobId, job: enriched });
    if (bucket.worker) {
      this.schedulePump(queueName);
    }
    return jobId;
  }

  async registerWorker<TData = Record<string, unknown>>(
    queueName: string,
    handler: (job: QueueJob<TData>) => Promise<void>
  ): Promise<void> {
    const bucket = this.getOrCreateBucket(queueName);
    bucket.worker = handler as (job: QueueJob<unknown>) => Promise<void>;
    if (bucket.pending.length > 0) {
      this.schedulePump(queueName);
    }
  }

  async getStats(queueName: string): Promise<QueueStats> {
    const bucket = this.queues.get(queueName);
    if (!bucket) {
      return { waiting: 0, completed: 0, failed: 0 };
    }
    return {
      waiting: bucket.pending.length,
      completed: bucket.completed,
      failed: bucket.failed,
    };
  }

  async waitForIdle(queueName?: string): Promise<void> {
    const targets = queueName
      ? [this.queues.get(queueName)].filter(
          (b): b is InternalQueueBucket => Boolean(b)
        )
      : Array.from(this.queues.values());

    await Promise.all(
      targets.map(
        (bucket) =>
          new Promise<void>((resolve) => {
            if (!bucket.processing && bucket.pending.length === 0) {
              resolve();
              return;
            }
            bucket.idleWaiters.push(resolve);
          })
      )
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const bucket of this.queues.values()) {
      bucket.pending.length = 0;
      bucket.processing = false;
      this.notifyIdle(bucket);
    }
    this.queues.clear();
  }
}
