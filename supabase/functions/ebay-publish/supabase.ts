import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.5";

/**
 * Create a Supabase client with the provided URL and key.
 * This is a simple wrapper for consistency and future customization.
 */
export function createClient(supabaseUrl: string, supabaseKey: string) {
  return createSupabaseClient(supabaseUrl, supabaseKey);
}

/**
 * Security check: verify that the authenticated user (from JWT)
 * is the same person as the claimed userId. This prevents IDOR attacks.
 *
 * @param req The incoming request with Authorization header
 * @param claimedUserId The userId that the request claims to act for
 * @param supabaseUrl Supabase project URL
 * @param supabaseServiceKey Supabase service role key (for token validation)
 * @throws Error if the JWT is invalid or doesn't match the claimedUserId
 */
export async function assertCallerOwnsUser(
  req: Request,
  claimedUserId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<void> {
  const authHeader = req.headers.get("Authorization");
  const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!jwt) {
    throw new Error(
      "Unauthorized: missing Authorization header for token action.",
    );
  }
  // Validate the JWT using the service-role client (verifies against project JWT secret).
  const sc = createClient(supabaseUrl, supabaseServiceKey);
  const { data: { user }, error: authErr } = await sc.auth.getUser(jwt);
  if (authErr || !user) {
    throw new Error("Unauthorized: invalid or expired session token.");
  }
  if (user.id !== claimedUserId) {
    throw new Error(
      "Unauthorized: userId does not match the authenticated session.",
    );
  }
}
