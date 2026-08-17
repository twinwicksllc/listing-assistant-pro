/**
 * Admin email allowlist.
 *
 * Kept in its own module (rather than inside AuthContext) so it can be unit
 * tested without instantiating the Supabase client, which requires environment
 * variables that are not present in the test environment.
 *
 * Admin accounts always receive full Shop-level access regardless of
 * subscription state, and are treated as organization owners.
 */
export const ADMIN_EMAILS = ["twinwicksllc@gmail.com"];

/**
 * Case-insensitive, whitespace-tolerant admin check.
 *
 * Identity providers - Google in particular, which is how this account signs
 * in - do not guarantee they return an address with the same casing it was
 * registered under. An exact `includes` comparison would silently drop the
 * admin to a normal free account with no error, hiding the Admin Dashboard
 * link and downgrading their plan.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  return normalized.length > 0 && ADMIN_EMAILS.includes(normalized);
}
