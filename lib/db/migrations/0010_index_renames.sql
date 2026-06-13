ALTER INDEX "episode_entities_entity_idx" RENAME TO "item_entities_entity_idx";--> statement-breakpoint
ALTER INDEX "conversations_episode_updated_idx" RENAME TO "conversations_item_updated_idx";--> statement-breakpoint
ALTER TABLE "item_entities" RENAME CONSTRAINT "episode_entities_episode_id_entity_id_pk" TO "item_entities_item_id_entity_id_pk";
