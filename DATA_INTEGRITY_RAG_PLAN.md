# Phase 3: Data Integrity & RAG (Retrieval-Augmented Generation) Implementation Plan

**Goal:** Transform the Modular Agent Architecture into a context-aware system for coin grading and pricing by injecting verified ANA standards and personal sales history.

---

## 🏗️ 1. Infrastructure: Supabase Vector Store

### Enable pgvector

- Create a new migration to enable `vector` extension.
- Create `knowledge_base` table:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    category TEXT, -- 'grading_standard', 'sales_history', 'market_appraisal'
    embedding vector(768), -- Optimized for Google Text Embedding models
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX ON knowledge_base USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
  ```

---

## 📚 2. Knowledge Ingestion

### ANA Standards Ingestion

- **Script:** Create `scripts/ingest-grading-standards.ts`.
- **Content:** Map ANA Grading Standards (MS-60 through MS-70, AU, VF, etc.) into chunked text segments.
- **Embeddings:** Use `text-embedding-004` (Gemini) to generate vectors for each standard.

### Personal Sales History Ingestion

- **Source:** Pull successful listings from `ebay_listings` table (where status is 'sold' or 'completed').
- **Format:** Store as: `"Item: [Name] | Price: $[Price] | Date: [Date] | Condition: [Condition] | Details: [Item Specifics]"`.

---

## 🔍 3. RAG Retrieval Service

### Helper: `supabase/functions/_helpers/rag/retriever.ts`

- **Function:** `findContext(query: string, category: string, limit: number)`
- **Logic:**
  1. Generate embedding for user query/item name.
  2. RPC call to Supabase to find top matching rows in `knowledge_base` for that category.
  3. Return combined text for prompt injection.

---

## 🤖 4. Agent Augmentation

### MarketAgent Upgrade

- **Current:** Uses `google_search` for real-time pricing.
- **Updated:**
  1. Searches `knowledge_base` for `sales_history`.
  2. Prepends history to the prompt:
     > "You are pricing this item. Our records show we sold a similar item for $85.00 on 2026-04-12. Real-time market data follows..."

### VisualAgent Upgrade

- **Current:** Generic zoomed inspection.
- **Updated:**
  1. Identifies item as a coin.
  2. Retrieves specific ANA grading criteria (e.g., "Peace Dollar Grading Guide").
  3. Injects into prompt:
     > "According to ANA standards for this series: 'MS-63 requires full luster but allows for minor bag marks.' Focus your code_execution crops on the cheek and fields to verify luster quality."

---

## 🚀 5. Implementation Roadmap

1. **[ ] Migration:** Enable pgvector and create `knowledge_base`.
2. **[ ] Script:** Implement ingestion for ANA standards (Phase 3A).
3. **[ ] Script:** Implement ingestion for existing sales history (Phase 3B).
4. **[ ] Service:** Create the `rag/retriever.ts` helper in Edge Functions.
5. **[ ] Controllers:** Update `MarketAgent` and `VisualAgent` to use the retriever.
6. **[ ] Testing:** Run E2E tests focusing on "High Value Grading Accuracy".
