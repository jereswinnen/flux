CREATE TABLE "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"locator" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "highlights_item_idx" ON "highlights" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "highlights_created_idx" ON "highlights" USING btree ("created_at");
