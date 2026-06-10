CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"summary" text,
	"image_url" text,
	"wikipedia_url" text,
	"wikidata_id" text,
	"external_ids" jsonb,
	"metadata" jsonb,
	"enrichment_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "episode_entities" (
	"episode_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"context" text,
	"approx_timestamp_sec" integer,
	CONSTRAINT "episode_entities_episode_id_entity_id_pk" PRIMARY KEY("episode_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_entities" ADD CONSTRAINT "episode_entities_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_entities" ADD CONSTRAINT "episode_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_name_idx" ON "entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "episode_entities_entity_idx" ON "episode_entities" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;