import { pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "../../../../src/columns";

export const alphaItems = pgTable("alpha_items", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps,
});
