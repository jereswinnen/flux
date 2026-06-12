ALTER TABLE "episodes" RENAME TO "items";--> statement-breakpoint
ALTER TABLE "episode_entities" RENAME TO "item_entities";--> statement-breakpoint
ALTER TABLE "transcripts" RENAME COLUMN "episode_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "insights" RENAME COLUMN "episode_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "chunks" RENAME COLUMN "episode_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "episode_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "item_entities" RENAME COLUMN "episode_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "type" text DEFAULT 'podcast' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "source_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "audio_url" DROP NOT NULL;--> statement-breakpoint
UPDATE "items" SET "source_metadata" = jsonb_strip_nulls(jsonb_build_object('guid', "episode_guid", 'itunesCollectionId', "itunes_collection_id", 'itunesTrackId', "itunes_track_id"));--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "episode_guid";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "itunes_collection_id";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "itunes_track_id";
