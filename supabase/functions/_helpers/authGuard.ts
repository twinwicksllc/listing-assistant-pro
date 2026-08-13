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
    verifyJwt: deps?.verifyJwt ?? defaultVerifyJwt,
  };
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
  if (!jwt || !supabaseServiceKey || jwt !== supabaseServiceKey) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true, userId: null, isServiceRole: true };
}
