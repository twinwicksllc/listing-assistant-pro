import { corsHeaders } from "./constants.ts";
import { assertCallerOwnsUser, createClient } from "./supabase.ts";
import { fetchWithTimeout } from "./fetch.ts";
import { decryptToken } from "../_helpers/tokenCrypto.ts";

export function buildEbayJsonHeaders(
  accessToken: unknown,
): Record<string, string> {
  return {
    Authorization: `Bearer ${String(accessToken)}`,
    "Content-Type": "application/json",
    "Content-Language": "en-US",
    "Accept-Language": "en-US",
  };
}

export interface GetPoliciesContext {
  req: Request;
  payload: Record<string, unknown>;
  apiBase: string;
}

/**
 * Fetch eBay business policies (fulfillment, payment, return) for a user token.
 * Consolidated here to avoid CORS issues with a separate policies function.
 */
export async function handleGetPolicies({
  req,
  payload,
  apiBase,
}: GetPoliciesContext): Promise<Response> {
  const { userToken, userId } = payload;

  // If no userToken provided directly, try to fetch it from server-side storage
  let resolvedToken = userToken;
  if (!resolvedToken && userId) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceKey) {
        // Security: verify caller owns this userId before accessing their token
        await assertCallerOwnsUser(
          req,
          String(userId),
          supabaseUrl,
          supabaseServiceKey,
        );
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data } = await supabase
          .from("profiles")
          .select("ebay_access_token")
          .eq("id", userId)
          .single();
        if (data?.ebay_access_token) {
          resolvedToken = await decryptToken(data.ebay_access_token);
        }
      }
    } catch (e) {
      console.warn("get_policies: could not fetch token from profiles:", e);
    }
  }

  if (!resolvedToken) {
    // Return empty policies rather than throwing — lets the UI show "no policies" gracefully
    return new Response(
      JSON.stringify({
        fulfillment: [],
        payment: [],
        returns: [],
        noToken: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // NOTE: Accept-Language must be explicitly set to "en-US".
  // Deno's runtime auto-injects the system locale when this header is omitted,
  // sending an invalid value that eBay rejects with errorId 25709.
  // Explicitly providing "en-US" overrides Deno's injected value.
  const authHeaders = buildEbayJsonHeaders(resolvedToken);

  // Fetch each policy type independently so one failure doesn't kill all three.
  // Returns { policies, error } — error is non-null if the fetch failed.
  const fetchPoliciesSafe = async (
    policyType: string,
  ): Promise<{
    policies: Array<{ id: string; name: string }>;
    error: string | null;
  }> => {
    try {
      const resp = await fetchWithTimeout(
        `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
        { headers: authHeaders, timeout: 15000 },
      );
      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(
          `get_policies: ${policyType} policy fetch failed (${resp.status}):`,
          errText,
        );
        return {
          policies: [],
          error: `${policyType} policies unavailable (HTTP ${resp.status})`,
        };
      }
      const data = await resp.json();
      const key = `${policyType}Policies`;
      const rawPolicies = data[key] || [];
      const policies = rawPolicies.map((p: Record<string, string>) => ({
        id: p[`${policyType}PolicyId`] || p.policyId || "",
        name: p.name || "(unnamed)",
      }));
      console.log(
        `get_policies: fetched ${policies.length} ${policyType} policies`,
      );
      return { policies, error: null };
    } catch (fetchErr) {
      console.warn(`get_policies: ${policyType} policy fetch threw:`, fetchErr);
      return { policies: [], error: `${policyType} policies fetch error` };
    }
  };

  // Run all three fetches concurrently; each is independently error-isolated
  const [fulfillmentResult, paymentResult, returnsResult] = await Promise.all([
    fetchPoliciesSafe("fulfillment"),
    fetchPoliciesSafe("payment"),
    fetchPoliciesSafe("return"),
  ]);

  // Collect any per-type errors for the client to display
  const policyErrors: Record<string, string> = {};
  if (fulfillmentResult.error) {
    policyErrors.fulfillment = fulfillmentResult.error;
  }
  if (paymentResult.error) policyErrors.payment = paymentResult.error;
  if (returnsResult.error) policyErrors.returns = returnsResult.error;

  return new Response(
    JSON.stringify({
      fulfillment: fulfillmentResult.policies,
      payment: paymentResult.policies,
      returns: returnsResult.policies,
      ...(Object.keys(policyErrors).length > 0 ? { policyErrors } : {}),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export interface BulkCreateDraftContext {
  req: Request;
  payload: Record<string, unknown>;
}

/**
 * Bulk publish multiple drafts by looping server-side and re-invoking this
 * same function with action "create_draft" for each draft.
 */
export async function handleBulkCreateDraft({
  req,
  payload,
}: BulkCreateDraftContext): Promise<Response> {
  const { userId, userToken, drafts, postalCode } = payload;
  if (!userToken) throw new Error("No eBay user token provided");
  if (!Array.isArray(drafts) || drafts.length === 0) {
    throw new Error("No drafts provided for bulk publish");
  }

  const results: Array<{
    draftId: string;
    success: boolean;
    listingId?: string;
    offerId?: string;
    sku?: string;
    affiliateUrl?: string;
    error?: string;
  }> = [];

  for (const draft of drafts) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // Only include Authorization header if present (avoid sending empty string)
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        headers.Authorization = authHeader;
      }

      const singleResp = await fetch(req.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "create_draft",
          ...(userId ? { userId } : {}),
          userToken,
          postalCode,
          ...draft,
        }),
      });

      // Defensively handle response: check status and parse JSON safely
      if (!singleResp.ok) {
        const errText = await singleResp
          .text()
          .catch(() => "(no response body)");
        results.push({
          draftId: draft.draftId,
          success: false,
          error: `HTTP ${singleResp.status}: ${errText}`,
        });
        continue;
      }

      let singleData: Record<string, unknown>;
      try {
        singleData = await singleResp.json();
      } catch (parseErr) {
        results.push({
          draftId: draft.draftId,
          success: false,
          error: `Response is not valid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        });
        continue;
      }

      if (singleData.success) {
        results.push({
          draftId: draft.draftId,
          success: true,
          listingId: singleData.listingId as string | undefined,
          offerId: singleData.offerId as string | undefined,
          sku: singleData.sku as string | undefined,
          affiliateUrl: singleData.affiliateUrl as string | undefined,
        });
      } else {
        results.push({
          draftId: draft.draftId,
          success: false,
          error: (singleData.error as string) || "Unknown error",
        });
      }
    } catch (err) {
      results.push({
        draftId: draft.draftId,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  return new Response(
    JSON.stringify({
      results,
      successCount,
      errorCount,
      message: `${successCount} of ${drafts.length} listings published to eBay`,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
