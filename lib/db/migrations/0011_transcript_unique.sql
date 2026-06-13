DELETE FROM "transcripts" t USING "transcripts" d
  WHERE t.item_id = d.item_id AND t.ctid < d.ctid;--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_item_unique" ON "transcripts" ("item_id");
