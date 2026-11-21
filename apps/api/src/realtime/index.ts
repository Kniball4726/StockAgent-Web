import type { AppConfig } from "../config/env.js";
import {
  BullMQQueueAdapter,
  RedisPubSubEventBus,
} from "./bullmq-redis-adapters.js";
import {
  InMemoryEventBus,
  InMemoryQueueAdapter,
} from "./memory-adapters.js";
import type { EventBusAdapter, QueueAdapter } from "./types.js";

export * from "./bullmq-redis-adapters.js";
export * from "./memory-adapters.js";
export * from "./types.js";
export * from "./websocket-hub.js";

export interface RealtimeAdapters {
  eventBus: EventBusAdapter;
  queue: QueueAdapter;
}

export function createEventBusAdapter(config: AppConfig): EventBusAdapter {
  return config.eventBusDriver === "redis"
    ? new RedisPubSubEventBus(config.redisUrl)
    : new InMemoryEventBus();
}

export function createQueueAdapter(config: AppConfig): QueueAdapter {
  return config.queueDriver === "bullmq"
    ? new BullMQQueueAdapter(config.redisUrl)
    : new InMemoryQueueAdapter();
}

export function createRealtimeAdapters(config: AppConfig): RealtimeAdapters {
  return {
    eventBus: createEventBusAdapter(config),
    queue: createQueueAdapter(config),
  };
}
