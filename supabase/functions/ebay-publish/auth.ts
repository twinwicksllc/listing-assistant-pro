import {
  corsHeaders,
  EBAY_OAUTH_SCOPES,
  REFRESH_BUFFER_MS,
  STRIPE_PRO_PRODUCT_ID,
  STRIPE_UNLIMITED_PRODUCT_ID,
} from "./constants.ts";
import { assertCallerOwnsUser, createClient } from "./supabase.ts";
import { fetchWithTimeout } from "./fetch.ts";

export { corsHeaders };

export interface EbayActionHandlerContext {
  req: Request;
  payload: Record<string, unknown>;
  clientId?: string;
  clientSecret?: string;
  ebayEnv?: string;
  authBase?: string;
  tokenUrl?: string;
}

/**
 * Generate and return the eBay OAuth consent URL.
 */
export async function handleGetAuthUrl({
  clientId,
  authBase,
}: EbayActionHandlerContext): Promise<Response> {
  if (!clientId) throw new Error("eBay API credentials not configured");
  if (!authBase) throw new Error("eBay auth endpoint not configured");

  const ruName =
    Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
  if (!ruName) throw new Error("EBAY_RUNAME not configured");

  const scopes = EBAY_OAUTH_SCOPES.join(" ");

  const authUrl =
    `${authBase}/oauth2/authorize?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(ruName)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}`;

  console.log("get_auth_url: ruName =", ruName);

  return new Response(JSON.stringify({ authUrl }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Exchange authorization code for eBay user token.
 * Stores token server-side in Supabase profiles table.
 * Also validates user identity and enforces one-account rule.
 */
export async function handleExchangeCode({
  req,
  payload,
  clientId,
  clientSecret,
  ebayEnv,
  tokenUrl,
}: EbayActionHandlerContext): Promise<Response> {
  if (!clientId || !clientSecret)
    throw new Error("eBay API credentials not configured");
  if (!ebayEnv || !tokenUrl)
    throw new Error("eBay OAuth endpoint not configured");

  const { code, userId } = payload;
  if (!code || typeof code !== "string")
    throw new Error("No authorization code provided");

  // Security: verify the caller owns the userId they claim to be storing tokens for.
  if (userId) {
    const _ecUrl = Deno.env.get("SUPABASE_URL");
    const _ecKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (_ecUrl && _ecKey) {
      await assertCallerOwnsUser(req, String(userId), _ecUrl, _ecKey);
    }
  }

  const ruName =
    Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
  if (!ruName) {
    throw new Error(
      "eBay callback URI not configured. Contact admin to set EBAY_RUNAME.",
    );
  }

  console.log(
    "exchange_code: code =",
    code?.substring(0, 20) + "...",
    "env =",
    ebayEnv,
  );

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const resp = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    timeout: 15000,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    }).toString(),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    let errorMsg = txt;
    try {
      const json = JSON.parse(txt);
      errorMsg = json.error_description || json.error || txt;
    } catch {
      /* not JSON */
    }
    throw new Error(`eBay token exchange failed (${resp.status}): ${errorMsg}`);
  }

  const tokenData = await resp.json();

  if (!tokenData.access_token) {
    throw new Error(
      "eBay returned no access token. Authorization code may have expired or been reused.",
    );
  }

  console.log(
    "exchange_code: token obtained, expires in",
    tokenData.expires_in,
    "seconds",
  );

  // --- Store token server-side in Supabase profiles table ---
  // Avoids exposing the token in localStorage (XSS risk).
  // IMPORTANT: Use upsert (not update) so this works even if the profiles row
  // doesn't exist yet. .update() silently affects 0 rows with no error when
  // the row is missing — the token would never be stored server-side, causing
  // get_stored_token to always return null and policies to fail to load.
  if (userId) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const expiresAt = new Date(
          Date.now() + tokenData.expires_in * 1000,
        ).toISOString();

        // upsert with onConflict: "id" — creates the row if missing, updates if present
        const { error: upsertError } = await supabase.from("profiles").upsert(
          {
            id: userId,
            ebay_access_token: tokenData.access_token,
            ebay_refresh_token: tokenData.refresh_token ?? null,
            ebay_token_expires_at: expiresAt,
          },
          { onConflict: "id" },
        );

        if (upsertError) {
          console.warn(
            "exchange_code: failed to upsert token in profiles:",
            upsertError.message,
          );
        } else {
          // Read-back verification: confirm the token was actually stored
          const { data: verifyData, error: verifyError } = await supabase
            .from("profiles")
            .select("ebay_access_token, ebay_token_expires_at")
            .eq("id", userId)
            .single();

          if (verifyError || !verifyData?.ebay_access_token) {
            console.warn(
              "exchange_code: upsert succeeded but read-back verification FAILED for user",
              userId,
              "verifyError:",
              verifyError?.message ?? "token null after upsert",
            );
          } else {
            console.log(
              "exchange_code: token upserted and verified in profiles for user",
              userId,
              "expires_at:",
              verifyData.ebay_token_expires_at,
            );
          }
        }
      }
    } catch (storeErr) {
      // Non-fatal — still return the token to the client as fallback
      console.warn("exchange_code: token storage error (non-fatal):", storeErr);
    }
  }

  // --- Identity API Call + One-Account Rule (OQ-5, OQ-3) ---
  // Call eBay Identity API to fetch username and account type (exchange_code only, not on refresh)
  // One-account enforcement: block different username if tier is not Unlimited
  try {
    const _identitySupabaseUrl = Deno.env.get("SUPABASE_URL");
    const _identityServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const _stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const identityBase =
      ebayEnv === "production"
        ? "https://apiz.ebay.com"
        : "https://apiz.sandbox.ebay.com";

    const identityRes = await fetch(
      `${identityBase}/commerce/identity/v1/user/`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (!identityRes.ok) {
      const identityErrText = await identityRes.text();
      throw new Error(
        `Identity API failed (${identityRes.status}): ${identityErrText}`,
      );
    }
    const identity = await identityRes.json();
    const newUsername = identity?.userId ?? identity?.username ?? null;
    const accountType =
      (identity?.accountType ?? "")?.toLowerCase() ?? "individual";

    // Determine tier for one-account enforcement (OQ-3: gate on LA subscription, not eBay account type)
    let tierForOneAccountCheck: "starter" | "pro" | "unlimited" = "starter";
    let _userEmailForStripe: string | null = null;
    if (userId && _identitySupabaseUrl && _identityServiceKey) {
      try {
        const _sc = createClient(_identitySupabaseUrl, _identityServiceKey);
        const { data: profileData } = await _sc
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .maybeSingle();
        _userEmailForStripe = profileData?.email ?? null;
      } catch {
        /* non-fatal */
      }
    }
    if (_userEmailForStripe && _stripeSecretKey) {
      try {
        const { default: Stripe } =
          await import("https://esm.sh/stripe@18.5.0");
        const stripe = new Stripe(_stripeSecretKey, {
          apiVersion: "2025-08-27.basil",
        });
        const customers = await stripe.customers.list({
          email: _userEmailForStripe,
          limit: 1,
        });
        if (customers.data.length > 0) {
          const subs = await stripe.subscriptions.list({
            customer: customers.data[0].id,
            status: "active",
            limit: 1,
          });
          if (subs.data.length > 0) {
            const productId = subs.data[0].items.data[0].price.product;
            if (productId === STRIPE_UNLIMITED_PRODUCT_ID) {
              tierForOneAccountCheck = "unlimited";
            } else if (productId === STRIPE_PRO_PRODUCT_ID) {
              tierForOneAccountCheck = "pro";
            }
          }
        }
      } catch (stripeE) {
        console.error("Stripe check in exchange_code failed:", stripeE);
      }
    }

    // Check for existing eBay username (one-account rule for non-Unlimited)
    if (userId && _identitySupabaseUrl && _identityServiceKey) {
      const supabase = createClient(_identitySupabaseUrl, _identityServiceKey);
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("ebay_username")
        .eq("id", userId)
        .single();

      if (
        existingProfile?.ebay_username &&
        existingProfile.ebay_username !== newUsername &&
        tierForOneAccountCheck !== "unlimited"
      ) {
        return new Response(
          JSON.stringify({
            error: "account_already_linked",
            message: `This Listing Assistant account is already linked to eBay user "${existingProfile.ebay_username}". Disconnect it before connecting a new account.`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Store username and account type
      const { error: usernameErr } = await supabase
        .from("profiles")
        .update({
          ebay_username: newUsername,
          ebay_account_type: accountType,
        })
        .eq("id", userId);

      if (usernameErr) {
        console.warn(
          "exchange_code: failed to store eBay username:",
          usernameErr.message,
        );
      } else {
        console.log(
          "exchange_code: stored eBay username for user",
          userId,
          ":",
          newUsername,
        );
      }
    }
  } catch (identityErr) {
    console.error("Identity API call failed (non-fatal):", identityErr);
    // Still return token to client — identity info is supplementary
  }

  return new Response(
    JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/**
 * Refresh an expired eBay user token using the stored refresh token.
 */
export async function handleRefreshToken({
  req,
  payload,
  clientId,
  clientSecret,
  tokenUrl,
}: EbayActionHandlerContext): Promise<Response> {
  if (!clientId || !clientSecret)
    throw new Error("eBay API credentials not configured");
  if (!tokenUrl) throw new Error("eBay OAuth endpoint not configured");

  const { userId } = payload;
  if (!userId) throw new Error("No userId provided");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase credentials not configured");
  }

  // Security: verify the caller owns the userId before rotating their token.
  await assertCallerOwnsUser(
    req,
    String(userId),
    supabaseUrl,
    supabaseServiceKey,
  );

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("profiles")
    .select("ebay_refresh_token")
    .eq("id", userId)
    .single();

  if (error || !data?.ebay_refresh_token) {
    return new Response(
      JSON.stringify({
        token: null,
        error: "No refresh token available. Please reconnect eBay.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const refreshResp = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    timeout: 15000,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.ebay_refresh_token,
      scope: EBAY_OAUTH_SCOPES.join(" "),
    }).toString(),
  });

  if (!refreshResp.ok) {
    const txt = await refreshResp.text();
    console.error(
      "refresh_token: eBay refresh failed:",
      refreshResp.status,
      txt,
    );
    return new Response(
      JSON.stringify({
        token: null,
        error: `Token refresh failed (${refreshResp.status}). Please reconnect eBay.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const tokenData = await refreshResp.json();
  if (!tokenData.access_token) {
    return new Response(
      JSON.stringify({
        token: null,
        error: "eBay returned no access token during refresh.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Store the new access token (and new refresh token if provided)
  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000,
  ).toISOString();
  const updatePatch: Record<string, string> = {
    ebay_access_token: tokenData.access_token,
    ebay_token_expires_at: expiresAt,
  };
  if (tokenData.refresh_token) {
    updatePatch.ebay_refresh_token = tokenData.refresh_token;
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update(updatePatch)
    .eq("id", userId);

  if (updateError) {
    console.warn(
      "refresh_token: failed to store refreshed token:",
      updateError.message,
    );
  } else {
    console.log(
      "refresh_token: token refreshed and stored for user",
      userId,
      "expires at",
      expiresAt,
    );
  }

  return new Response(
    JSON.stringify({
      token: tokenData.access_token,
      expiresIn: tokenData.expires_in,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/**
 * Retrieve stored eBay token for a user with proactive refresh if token is expiring soon.
 */
export async function handleGetStoredToken({
  req,
  payload,
  clientId,
  clientSecret,
  tokenUrl,
}: EbayActionHandlerContext): Promise<Response> {
  if (!tokenUrl) throw new Error("eBay OAuth endpoint not configured");

  const { userId } = payload;
  if (!userId) throw new Error("No userId provided");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase credentials not configured");
  }

  // Security: verify the caller owns the userId before returning their stored token.
  await assertCallerOwnsUser(
    req,
    String(userId),
    supabaseUrl,
    supabaseServiceKey,
  );

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "ebay_access_token, ebay_token_expires_at, ebay_refresh_token, postal_code, city",
    )
    .eq("id", userId)
    .single();

  console.log("get_stored_token: database query result", {
    userId,
    hasData: !!data,
    queryError: error?.message,
    dbPostalCode: data?.postal_code || "NULL",
    dbCity: (data as any)?.city || "NULL",
    dbCityType: typeof (data as any)?.city,
  });

  if (error || !data) {
    console.warn(
      "get_stored_token: no profile found or query error for user",
      userId,
    );
    return new Response(
      JSON.stringify({ token: null, postalCode: null, city: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const now = new Date();
  const expiresAt = data.ebay_token_expires_at
    ? new Date(data.ebay_token_expires_at)
    : null;
  // Consider token expired if it expires within 5 minutes (proactive refresh window)
  const isExpiredOrExpiringSoon = expiresAt
    ? expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS
    : true;

  // Proactively refresh if token is expired or expiring within 5 minutes
  if (isExpiredOrExpiringSoon && data.ebay_refresh_token) {
    console.log(
      "get_stored_token: token expiring soon, attempting proactive refresh for user",
      userId,
    );
    // Skip proactive refresh if eBay app credentials are not configured
    if (!clientId || !clientSecret) {
      console.warn(
        "get_stored_token: skipping proactive refresh — eBay credentials not configured",
      );
      return new Response(
        JSON.stringify({
          token: data.ebay_access_token,
          postalCode: data.postal_code,
          city: (data as any).city ?? null,
          isExpired: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    try {
      const credentials = btoa(`${clientId}:${clientSecret}`);
      const refreshResp = await fetchWithTimeout(tokenUrl, {
        method: "POST",
        timeout: 15000,
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: data.ebay_refresh_token,
          scope: EBAY_OAUTH_SCOPES.join(" "),
        }).toString(),
      });

      if (refreshResp.ok) {
        const tokenData = await refreshResp.json();
        if (tokenData.access_token) {
          const newExpiresAt = new Date(
            Date.now() + tokenData.expires_in * 1000,
          ).toISOString();
          const updatePatch: Record<string, string> = {
            ebay_access_token: tokenData.access_token,
            ebay_token_expires_at: newExpiresAt,
          };
          if (tokenData.refresh_token) {
            updatePatch.ebay_refresh_token = tokenData.refresh_token;
          }
          await supabase.from("profiles").update(updatePatch).eq("id", userId);
          console.log(
            "get_stored_token: proactive refresh succeeded, new expiry:",
            newExpiresAt,
          );

          return new Response(
            JSON.stringify({
              token: tokenData.access_token,
              postalCode: data.postal_code,
              city: (data as any).city ?? null,
              isExpired: false,
              refreshed: true,
            }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
      } else {
        const refreshError = (await refreshResp.text()).slice(0, 500);
        console.warn(
          "get_stored_token: proactive refresh failed:",
          refreshResp.status,
          refreshError,
        );
        return new Response(
          JSON.stringify({
            token: null,
            postalCode: data.postal_code,
            city: (data as any).city ?? null,
            isExpired: true,
            reconnectRequired: true,
            refreshStatus: refreshResp.status,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (refreshErr) {
      console.warn(
        "get_stored_token: proactive refresh error (non-fatal):",
        refreshErr,
      );
    }

    // Refresh failed — return null so caller triggers re-auth
    return new Response(
      JSON.stringify({
        token: null,
        postalCode: data.postal_code,
        city: (data as any).city ?? null,
        isExpired: true,
        reconnectRequired: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      token: data.ebay_access_token,
      postalCode: data.postal_code,
      city: (data as any).city ?? null,
      isExpired: false,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
