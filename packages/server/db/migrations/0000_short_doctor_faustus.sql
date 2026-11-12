CREATE TABLE "platform_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "platform_outbox_pending_idx" ON "platform_outbox" USING btree ("id") WHERE "platform_outbox"."dispatched_at" is null;