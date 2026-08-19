/**
 * Consolidated Gemini model tiers (RBR-0030 follow-up).
 *
 * Model names used to be hardcoded and scattered across ~16 call sites,
 * mixing -preview tags, a dated GA release, and a partially-adopted alias.
 * Google's own guidance: a floating alias like gemini-pro-latest/
 * gemini-flash-latest always points to the current GA release, so it
 * doesn't need updating by hand every time a new model ships. These three
 * env vars are the single point of control for that -- override one to pin
 * a specific dated release (e.g. "gemini-2.5-pro") if an auto-updated
 * release ever changes output formatting/schema adherence enough to affect
 * a listing pipeline.
 */

/** Multi-step reasoning, forced tool-calling/JSON schema adherence: analyze-item, coin-domain visual inspection, pass1 identification. */
export const GEMINI_HEAVY_MODEL = Deno.env.get("GEMINI_HEAVY_MODEL") ?? "gemini-pro-latest";

/** High-volume, latency-sensitive, or free-form text: category/market lookups, competitor search, grounding, transcription. */
export const GEMINI_FAST_MODEL = Deno.env.get("GEMINI_FAST_MODEL") ?? "gemini-flash-latest";

/** RAG vector embeddings for knowledge_base (pgvector). Swapping this requires re-embedding existing rows -- see backfill-knowledge-base-embeddings. */
export const GEMINI_EMBEDDING_MODEL = Deno.env.get("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-2";
