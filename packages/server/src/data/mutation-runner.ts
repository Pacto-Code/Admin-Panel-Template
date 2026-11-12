import { Inject, Injectable } from "@nestjs/common";
import type { Db, Tx } from "@platform/db";
import { EventDispatcher } from "../events/dispatcher";
import { EventBus, type DomainEvent } from "../events/event-bus";
import { requestContext } from "../http/request-context";
import { DB } from "../tokens";
import { AUDIT_RECORDER, type AuditEntryInput, type AuditRecorder } from "./audit-tokens";
import { redact } from "./redact";

export interface MutationSpec<T> {
  action: string;
  entityType: string;
  /** Extra keys to redact, on top of DEFAULT_SENSITIVE. */
  sensitive?: string[];
  before?: (tx: Tx) => Promise<unknown | null>;
  mutate: (tx: Tx) => Promise<T>;
  after: (tx: Tx, result: T) => Promise<{ entityId: string | null; value: unknown | null }>;
  events?: (result: T) => DomainEvent[];
}

function countAudit(): void {
  const ctx = requestContext.get();
  if (ctx) ctx.auditCount += 1;
}

/** The one way to change data: the change, its audit entry and its events commit or roll back together. */
@Injectable()
export class MutationRunner {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUDIT_RECORDER) private readonly recorder: AuditRecorder,
    private readonly bus: EventBus,
    private readonly dispatcher: EventDispatcher,
  ) {}

  async run<T>(spec: MutationSpec<T>): Promise<T> {
    const { result, published } = await this.db.transaction(async (tx) => {
      const before = spec.before ? await spec.before(tx) : null;
      const result = await spec.mutate(tx);
      const after = await spec.after(tx, result);
      await this.recorder.record(tx, {
        action: spec.action,
        entityType: spec.entityType,
        entityId: after.entityId,
        before: redact(before ?? null, spec.sensitive),
        after: redact(after.value ?? null, spec.sensitive),
      });
      const events = spec.events?.(result) ?? [];
      await this.bus.publish(tx, events);
      return { result, published: events.length > 0 };
    });
    countAudit();
    if (published) await this.dispatcher.flush();
    return result;
  }

  /** Records an entry with no domain change of its own, e.g. a sign-in. */
  async recordOnly(entry: AuditEntryInput): Promise<void> {
    await this.db.transaction((tx) =>
      this.recorder.record(tx, { ...entry, before: redact(entry.before), after: redact(entry.after) }),
    );
    countAudit();
  }
}
