import { bigint, char, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export { uuidv7 };

export const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const version = {
  version: integer("version").notNull().default(1),
};

/** Integer minor units plus an ISO 4217 currency code. */
export const money = (name: string) => ({
  [`${name}Amount`]: bigint(`${name}_amount`, { mode: "bigint" }),
  [`${name}Currency`]: char(`${name}_currency`, { length: 3 }),
});
