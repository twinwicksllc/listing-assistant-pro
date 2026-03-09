import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Support both VITE_SUPABASE_PUBLISHABLE_KEY and VITE_SUPABASE_ANON_KEY
// This project shares a Supabase instance with crm.rankedceo.com — we use
// a unique storageKey to prevent PKCE verifier collisions between apps.
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

// Temporary: verify env vars are defined at init time (scrubs middle chars)
const scrub = (s: string | undefined) =>
  s ? `${s.slice(0, 8)}...${s.slice(-4)}` : 'UNDEFINED';
console.log('[supabase] URL:', scrub(SUPABASE_URL));
console.log('[supabase] KEY:', scrub(SUPABASE_PUBLISHABLE_KEY));

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    // Unique storage key prevents PKCE verifier collision with crm.rankedceo.com
    // which shares the same Supabase project
    storageKey: 'sb-lister-auth-token',
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: true,
    flowType: 'pkce',
  }
});