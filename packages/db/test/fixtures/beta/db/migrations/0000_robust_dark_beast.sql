CREATE TABLE "beta_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beta_notes" ADD CONSTRAINT "beta_notes_item_id_alpha_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."alpha_items"("id") ON DELETE no action ON UPDATE no action;