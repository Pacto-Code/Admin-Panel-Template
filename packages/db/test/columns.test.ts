import { getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { id, money, uuidv7 } from "@platform/db";

describe("id generation", () => {
  it("generates time-ordered ids", () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a < b).toBe(true);
  });
});

describe("money", () => {
  const prices = pgTable("prices", { id: id(), ...money("price") });

  it("produces typed columns with the expected SQL names and types", () => {
    const cols = getTableConfig(prices).columns;
    const amount = cols.find((c) => c.name === "price_amount")!;
    const currency = cols.find((c) => c.name === "price_currency")!;
    expect(amount.getSQLType()).toBe("bigint");
    expect(currency.getSQLType()).toBe("char(3)");
    expect(prices.priceAmount.name).toBe("price_amount");
    expect(prices.priceCurrency.name).toBe("price_currency");
  });

  it("types the amount as bigint and the currency as string", () => {
    expectTypeOf<typeof prices.$inferSelect.priceAmount>().toEqualTypeOf<bigint | null>();
    expectTypeOf<typeof prices.$inferSelect.priceCurrency>().toEqualTypeOf<string | null>();
  });
});
