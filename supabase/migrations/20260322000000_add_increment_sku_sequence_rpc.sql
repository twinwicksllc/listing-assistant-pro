-- Migration: Add RPC function to atomically increment and return next SKU sequence
-- This is needed because Supabase JS client does not support arithmetic update syntax.

CREATE OR REPLACE FUNCTION public.increment_sku_sequence(user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_seq INTEGER;
BEGIN
  UPDATE public.profiles
  SET next_sku_sequence = next_sku_sequence + 1
  WHERE id = user_id
  RETURNING next_sku_sequence INTO new_seq;

  IF new_seq IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user_id: %', user_id;
  END IF;

  RETURN new_seq;
END;
$$;

-- Grant execute to service role (used by edge functions)
GRANT EXECUTE ON FUNCTION public.increment_sku_sequence(UUID) TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'Added function public.increment_sku_sequence(UUID)';
END;
$$;