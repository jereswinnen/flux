import type { ItemRow } from "@/lib/api/dto"
import type { NewItem } from "@/lib/db/items"

/** Result of attempting to ingest one input through an adapter. */
export interface SourceAdapter {
  /** The item type this adapter produces. */
  readonly type: NewItem["type"]
  /** True if this adapter handles the given raw URL/string input. */
  detect(input: string): boolean
  /** Build the (unsaved) item record from the input. Cheap/metadata-only —
   *  heavy fetching (audio, YouTube metadata) happens in startProcessing/Modal. */
  resolve(input: string): Promise<NewItem>
  /** Kick off transcription/extraction for an already-persisted item.
   *  Must not throw for "expected" async failures — callers handle status. */
  startProcessing(item: ItemRow): Promise<void>
}
