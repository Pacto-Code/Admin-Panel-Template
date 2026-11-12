import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "../../../../src/columns";
import { alphaItems } from "../../alpha/db/schema";

export const betaNotes = pgTable("beta_notes", {
  id: id(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => alphaItems.id),
  body: text("body").notNull(),
  ...timestamps,
});
