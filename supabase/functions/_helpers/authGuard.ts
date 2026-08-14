export interface AuthOk {
  ok: true;
  /** Verified Supabase user id, or null when the caller authenticated via the service-role key. */
  userId: string | null;
  isServiceRole: boolean;
}
export interface AuthFail {
  ok: false;
  status: 401;
  message: string;
}
export type AuthResult = AuthOk | AuthFail;

export interface AuthGuardDeps {
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  /** Shared secret for database-scheduled (pg_cron) callers. */
  cronSecret?: string;
  /** Injectable for tests — verify a bearer JWT, return the user id or null. */
  verifyJwt?: (
    jwt: string,
    supabaseUrl: string,
    supabaseServiceKey: string,
  ) => Promise<string | null>;
}

function resolveDeps(deps?: AuthGuardDeps) {
  return {
    supabaseUrl: deps?.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: deps?.supabaseServiceKey ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    cronSecret: deps?.cronSecret ?? Deno.env.get("CRON_SECRET") ?? "",
    verifyJwt: deps?.verifyJwt ?? defaultVerifyJwt,
  };
}

/**
 * Constant-time string comparison, so a rejected bearer token cannot be
 * distinguished by response timing. Both guards below compare secrets.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function defaultVerifyJwt(
  jwt: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<string | null> {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: supabaseServiceKey,
    },
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  return typeof data?.id === "string" ? data.id : null;
}

/** Require any authenticated Supabase user (rejects the service-role key). */
export async function requireUser(
  req: Request,
  deps?: AuthGuardDeps,
): Promise<AuthResult> {
  const { supabaseUrl, supabaseServiceKey, verifyJwt } = resolveDeps(deps);
  const jwt = extractBearer(req);
  if (!jwt) return { ok: false, status: 401, message: "Authentication required" };
  const userId = await verifyJwt(jwt, supabaseUrl, supabaseServiceKey);
  if (!userId) {
    return { ok: false, status: 401, message: "Invalid or expired session" };
  }
  return { ok: true, userId, isServiceRole: false };
}

/** Accept either a valid user JWT OR the exact service-role key as Bearer. */
export async function requireUserOrServiceRole(
  req: Request,
  deps?: AuthGuardDeps,
): Promise<AuthResult> {
  const { supabaseUrl, supabaseServiceKey, verifyJwt } = resolveDeps(deps);
  const jwt = extractBearer(req);
  if (!jwt) return { ok: false, status: 401, message: "Authentication required" };
  if (supabaseServiceKey && jwt === supabaseServiceKey) {
    return { ok: true, userId: null, isServiceRole: true };
  }
  const userId = await verifyJwt(jwt, supabaseUrl, supabaseServiceKey);
  if (!userId) {
    return { ok: false, status: 401, message: "Invalid or expired session" };
  }
  return { ok: true, userId, isServiceRole: false };
}

/** Require the exact service-role key as Bearer — no user sessions accepted. */
export async function requireServiceRole(
  req: Request,
  deps?: AuthGuardDeps,
): Promise<AuthResult> {
  const { supabaseServiceKey } = resolveDeps(deps);
  const jwt = extractBearer(req);
  if (!jwt || !supabaseServiceKey || !timingSafeEqual(jwt, supabaseServiceKey)) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true, userId: null, isServiceRole: true };
}

/**
 * Require either the dedicated cron shared secret OR the service-role key.
 * For endpoints invoked by pg_cron from the database.
 *
 * Why a separate secret rather than reusing the service-role key: an internal
 * Edge Function caller and `requireServiceRole` both read
 * SUPABASE_SERVICE_ROLE_KEY from the environment, so their comparison matches
 * whatever that value happens to be and never exercises it. A pg_cron caller is
 * the only one that must supply the value as a literal, and that value is opaque
 * from outside the runtime — which made a mismatch undiagnosable and cost this
 * project roughly 145 days of silently failing cost alerts (RBR-0025).
 *
 * CRON_SECRET is a value the operator sets on both sides, so it can be verified
 * and rotated deliberately. It is also unaffected by the deprecation of
 * Supabase's legacy JWT API keys, which the service-role comparison depends on.
 *
 * The service-role key stays accepted so existing internal callers and manual
 * service-role invocations keep working.
 */
export async function requireCronSecret(
  req: Request,
  deps?: AuthGuardDeps,
): Promise<AuthResult> {
  const { supabaseServiceKey, cronSecret } = resolveDeps(deps);
  const token = extractBearer(req);
  if (!token) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  if (cronSecret && timingSafeEqual(token, cronSecret)) {
    return { ok: true, userId: null, isServiceRole: true };
  }
  if (supabaseServiceKey && timingSafeEqual(token, supabaseServiceKey)) {
    return { ok: true, userId: null, isServiceRole: true };
  }
  return { ok: false, status: 401, message: "Unauthorized" };
}

/**
 * Redacted summary of what a cron guard had available, for logging on a 401.
 *
 * Lengths and booleans only — never any part of a secret. Deliberately written to
 * the function log rather than the HTTP response, so an unauthenticated caller
 * learns nothing while the operator can see the runtime's own view.
 *
 * This exists because diagnosing the RBR-0025 401s from outside the runtime was
 * effectively guesswork: the presented token and the expected value were both
 * invisible, and four separate hypotheses were tested against an opaque
 * comparison. A single line of this in the log would have identified the cause
 * immediately.
 */
export function describeCronAuthEnv(
  req: Request,
  deps?: AuthGuardDeps,
): Record<string, unknown> {
  const { supabaseServiceKey, cronSecret } = resolveDeps(deps);
  const token = extractBearer(req);
  return {
    presentedTokenLength: token?.length ?? 0,
    hasAuthorizationHeader: req.headers.has("Authorization"),
    cronSecretConfigured: cronSecret.length > 0,
    cronSecretLength: cronSecret.length,
    serviceKeyConfigured: supabaseServiceKey.length > 0,
    serviceKeyLength: supabaseServiceKey.length,
    lengthMatchesCronSecret: token != null && token.length === cronSecret.length,
    lengthMatchesServiceKey: token != null &&
      token.length === supabaseServiceKey.length,
  };
}
