import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps } from "@platform/db";

/** Domain events written in the same transaction as the change; dispatched to jobs after commit. */
export const platformOutbox = pgTable(
  "platform_outbox",
  {
    id: id(),
    name: text("name").notNull(),
    payload: jsonb("payload").notNull(),
    ...timestamps,
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (t) => [index("platform_outbox_pending_idx").on(t.id).where(sql`${t.dispatchedAt} is null`)],
);
