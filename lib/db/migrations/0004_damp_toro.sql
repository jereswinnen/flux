DROP INDEX "entities_name_idx";--> statement-breakpoint
CREATE INDEX "chunks_entity_idx" ON "chunks" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entities_lower_name_type_idx" ON "entities" USING btree (lower("name"),"type");