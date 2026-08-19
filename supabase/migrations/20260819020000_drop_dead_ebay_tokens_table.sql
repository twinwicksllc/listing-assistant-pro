-- Migration: drop dead ebay_tokens table
--
-- Resolves RBR-0019: ebay_tokens is dead schema, not an inactive feature.
-- Real eBay OAuth tokens live on public.profiles (ebay_access_token,
-- ebay_refresh_token, ebay_token_expires_at) instead -- see
-- supabase/migrations/20260314000000_ebay_token_storage_and_auction_duration.sql.
-- Confirmed 2026-08-19: this table holds 0 rows (P0-10 baseline), and no
-- application code anywhere in supabase/functions/ or src/ reads from or
-- writes to it -- the only references in the entire repository are its own
-- creation migration (20260308173315_d58efbf4-52ff-46ae-8750-d9897656af22.sql)
-- and the Phase 0 discovery docs describing it as dead. Owner decision
-- 2026-08-19: drop rather than retain as documented debt.
--
-- Follow-up required after this migration deploys: src/integrations/supabase/
-- types.ts is a generated file (via `supabase gen types typescript`) that
-- still declares a type block for ebay_tokens -- regenerate it against the
-- live schema once this migration has applied, rather than hand-editing the
-- generated block.

DROP TABLE IF EXISTS public.ebay_tokens;
