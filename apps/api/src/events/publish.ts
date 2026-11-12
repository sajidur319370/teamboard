import { logger } from '../lib/logger';
import type { Ctx } from '../types/ctx';
import type { DomainEvent } from './types';

export type EventHandler = (ctx: Ctx, event: DomainEvent) => void | Promise<void>;

const handlers = new Set<EventHandler>();

/**
 * Plug a side effect into the event pipe. Day 14 subscribes the socket broadcaster,
 * Day 17 the notifier, without touching any service. Returns an unsubscribe function.
 */
export function subscribe(handler: EventHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
 * Call AFTER a transaction commits. Side effects live here, never inside withTransaction
 * (the driver may retry the callback; a broadcast must never describe a rolled-back write).
 * A failing handler must not fail the request: the data is already saved.
 */
export async function publish(ctx: Ctx, events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    logger.debug({ type: event.type, workspaceId: String(ctx.workspaceId) }, 'domain event');
    for (const handler of handlers) {
      try {
        await handler(ctx, event);
      } catch (err) {
        logger.error({ err, type: event.type }, 'event handler failed');
      }
    }
  }
}
