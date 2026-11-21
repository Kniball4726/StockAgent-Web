import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type {
  DomainEvent,
  DomainEventHandler,
  EventBusAdapter,
  QueueAdapter,
  QueueJob,
  QueueStats,
} from "./types.js";

export const DEFAULT_EVENT_CHANNEL = "stockagent:domain_events";

/**
 * Bus de eventos distribuido basado en Redis Pub/Sub para multi-instancia SaaS.
 */
export class RedisPubSubEventBus implements EventBusAdapter {
  public readonly driver = "redis" as const;
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly channel: string;
  private readonly listeners = new Set<DomainEventHandler>();
  private subscribed = false;

  constructor(redisUrl: string, channel = DEFAULT_EVENT_CHANNEL) {
    if (!redisUrl.trim()) {
      throw new Error(
        "REDIS_URL es obligatoria cuando EVENT_BUS_DRIVER=redis."
      );
    }
    this.channel = channel;
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });

    this.sub.on("message", (msgChannel, message) => {
      if (msgChannel !== this.channel) {
        return;
      }
      try {
        const parsed = JSON.parse(message) as DomainEvent;
        for (const handler of Array.from(this.listeners)) {
          Promise.resolve(handler(parsed)).catch(() => undefined);
        }
      } catch {
        // Ignorar mensajes malformados en el canal compartido
      }
    });
  }

  private async ensureSubscribed(): Promise<void> {
    if (this.subscribed) {
      return;
    }
    this.subscribed = true;
    await this.sub.subscribe(this.channel);
  }

  async publish<TPayload = Record<string, unknown>>(
    event: DomainEvent<TPayload>
  ): Promise<void> {
    await this.pub.publish(this.channel, JSON.stringify(event));
  }

  subscribe(handler: DomainEventHandler): () => void {
    this.listeners.add(handler);
    void this.ensureSubscribed().catch(() => undefined);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    await Promise.allSettled([this.sub.quit(), this.pub.quit()]);
  }
}

/**
 * Adaptador de colas persistentes respaldado por BullMQ y Redis.
 */
export class BullMQQueueAdapter implements QueueAdapter {
  public readonly driver = "bullmq" as const;
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly prefix: string;

  constructor(redisUrl: string, prefix = "stockagent") {
    if (!redisUrl.trim()) {
      throw new Error("REDIS_URL es obligatoria cuando QUEUE_DRIVER=bullmq.");
    }
    this.prefix = prefix;
    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  private getQueue(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.connection as never,
        prefix: this.prefix,
      });
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  async enqueue<TData = Record<string, unknown>>(
    queueName: string,
    job: QueueJob<TData>
  ): Promise<string> {
    const queue = this.getQueue(queueName);
    const added = await queue.add(
      job.name,
      { tenantId: job.tenantId, data: job.data },
      {
        ...(job.id ? { jobId: job.id } : {}),
        attempts: job.attempts ?? 3,
        backoff: job.backoffMs
          ? { type: "exponential", delay: job.backoffMs }
          : { type: "exponential", delay: 1000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      }
    );
    return String(added.id ?? "");
  }

  async registerWorker<TData = Record<string, unknown>>(
    queueName: string,
    handler: (job: QueueJob<TData>) => Promise<void>
  ): Promise<void> {
    const worker = new Worker(
      queueName,
      async (bullJob: Job) => {
        const raw = bullJob.data as { tenantId: string; data: TData };
        await handler({
          id: bullJob.id ? String(bullJob.id) : undefined,
          name: bullJob.name,
          tenantId: raw.tenantId,
          data: raw.data,
        });
      },
      {
        connection: this.connection as never,
        prefix: this.prefix,
      }
    );
    this.workers.push(worker);
  }

  async getStats(queueName: string): Promise<QueueStats> {
    const queue = this.getQueue(queueName);
    const [waiting, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);
    return { waiting, completed, failed };
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled(
      Array.from(this.queues.values()).map((q) => q.close())
    );
    await Promise.allSettled([this.connection.quit()]);
  }
}
