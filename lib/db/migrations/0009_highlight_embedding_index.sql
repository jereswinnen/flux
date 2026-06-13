CREATE INDEX "highlights_embedding_idx" ON "highlights" USING hnsw ("embedding" vector_cosine_ops);
