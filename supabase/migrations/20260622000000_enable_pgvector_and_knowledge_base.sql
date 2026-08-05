-- Enable the vector extension to work with embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the knowledge_base table for RAG
CREATE TABLE IF NOT EXISTS public.knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    category TEXT NOT NULL, -- e.g., 'grading_standard', 'sales_history', 'market_appraisal'
    embedding vector(768), -- Optimized for Google Text Embedding 004 (768 dimensions)
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polname = 'Service role can manage knowledge base'
      AND polrelid = 'public.knowledge_base'::regclass
  ) THEN
    CREATE POLICY "Service role can manage knowledge base"
    ON public.knowledge_base
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END
$$;

-- Authenticated users can read (for potential frontend features)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polname = 'Authenticated users can read knowledge base'
      AND polrelid = 'public.knowledge_base'::regclass
  ) THEN
    CREATE POLICY "Authenticated users can read knowledge base"
    ON public.knowledge_base
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END
$$;

-- Create an IVFFlat index for faster vector similarity search
-- Note: ivfflat is simpler for initial setup than HNSW
CREATE INDEX IF NOT EXISTS knowledge_base_embedding_idx ON public.knowledge_base 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- RPC for vector similarity search
CREATE OR REPLACE FUNCTION match_knowledge_base (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_category text
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  category text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.content,
    kb.metadata,
    kb.category,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE kb.category = filter_category
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Trigger for updated_at if we add it later
COMMENT ON TABLE public.knowledge_base IS 'Central repository for RAG context, including ANA grading standards and sales history.';
