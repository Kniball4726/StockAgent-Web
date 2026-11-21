import { randomUUID } from "node:crypto";
import type {
  DomainEventType,
  EventBusDriver,
  QueueDriver,
} from "@stockagent/shared";

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  tenantId: string;
  type: DomainEventType;
  actor: string;
  occurredAt: string;
  payload: TPayload;
}

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBusAdapter {
  readonly driver: EventBusDriver;
  publish<TPayload = Record<string, unknown>>(
    event: DomainEvent<TPayload>
  ): Promise<void>;
  subscribe(handler: DomainEventHandler): () => void;
  close(): Promise<void>;
}

export interface QueueJob<TData = Record<string, unknown>> {
  id?: string | undefined;
  name: string;
  tenantId: string;
  data: TData;
  attempts?: number | undefined;
  backoffMs?: number | undefined;
}

export interface QueueStats {
  waiting: number;
  completed: number;
  failed: number;
}

export interface QueueAdapter {
  readonly driver: QueueDriver;
  enqueue<TData = Record<string, unknown>>(
    queueName: string,
    job: QueueJob<TData>
  ): Promise<string>;
  registerWorker<TData = Record<string, unknown>>(
    queueName: string,
    handler: (job: QueueJob<TData>) => Promise<void>
  ): Promise<void>;
  getStats(queueName: string): Promise<QueueStats>;
  close(): Promise<void>;
}

export function createDomainEvent<TPayload = Record<string, unknown>>(params: {
  tenantId: string;
  type: DomainEventType;
  actor: string;
  payload: TPayload;
}): DomainEvent<TPayload> {
  return {
    id: randomUUID(),
    tenantId: params.tenantId,
    type: params.type,
    actor: params.actor,
    occurredAt: new Date().toISOString(),
    payload: params.payload,
  };
}
