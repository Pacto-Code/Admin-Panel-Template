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

const amountColumn = <N extends string>(name: N) => bigint(name, { mode: "bigint" });
const currencyColumn = <N extends string>(name: N) => char(name, { length: 3 });

type MoneyColumns<N extends string> = {
  [K in `${N}Amount`]: ReturnType<typeof amountColumn<`${N}_amount`>>;
} & {
  [K in `${N}Currency`]: ReturnType<typeof currencyColumn<`${N}_currency`>>;
};

/** Integer minor units plus an ISO 4217 currency code. */
export const money = <N extends string>(name: N): MoneyColumns<N> =>
  ({
    [`${name}Amount`]: amountColumn(`${name}_amount`),
    [`${name}Currency`]: currencyColumn(`${name}_currency`),
  }) as MoneyColumns<N>;
