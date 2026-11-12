import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db, Tx } from "@platform/db";
import { JobsService } from "../jobs/jobs.service";
import { DB } from "../tokens";
import { platformOutbox } from "./outbox.schema";

export interface DomainEvent<T = unknown> {
  name: string;
  payload: T;
}

/** Data of one `platform.events` job. */
export interface EventJob {
  eventId: string;
  name: string;
  payload: unknown;
}

export const EVENTS_JOB = "platform.events";
const BATCH = 100;

@Injectable()
export class EventBus {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
  ) {}

  /** Writes the events to the outbox inside the caller's transaction, so a rollback discards them. */
  async publish(tx: Tx, events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await tx.insert(platformOutbox).values(events.map((e) => ({ name: e.name, payload: e.payload })));
  }

  /**
   * Enqueues one `platform.events` job per undispatched row and returns how many it sent.
   *
   * Each batch is claimed (`FOR UPDATE SKIP LOCKED`, marked dispatched) and enqueued inside one
   * transaction, so concurrent callers never take the same row. If an enqueue fails the transaction
   * rolls back and the whole batch stays pending for the next call: no event is lost. Rows enqueued
   * before the failure are enqueued again then, which at-least-once delivery already allows.
   *
   * Once enqueued, the row is done and the job queue owns the event: under pg-boss a failing job is
   * retried with backoff and finally parked in `platform.events.dead`, never dropped. Delivery is
   * at-least-once up to that dead letter, and no ordering between events is guaranteed.
   */
  async dispatchPending(): Promise<number> {
    let total = 0;
    for (;;) {
      const sent = await this.db.transaction(async (tx) => {
        const claimed = await tx.execute<{ id: string; name: string; payload: unknown }>(sql`
          update platform_outbox set dispatched_at = now(), updated_at = now()
          where id in (
            select id from platform_outbox where dispatched_at is null
            order by id limit ${BATCH} for update skip locked
          )
          returning id, name, payload`);
        // UUIDv7 ids sort by creation time.
        const rows = claimed.rows.sort((a, b) => (a.id < b.id ? -1 : 1));
        for (const row of rows) {
          await this.jobs.enqueue(EVENTS_JOB, { eventId: row.id, name: row.name, payload: row.payload } satisfies EventJob);
        }
        return rows.length;
      });
      total += sent;
      if (sent < BATCH) return total;
    }
  }
}
