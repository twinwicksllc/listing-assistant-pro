import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_helpers/tokenCrypto.ts";
import { requireUser } from "../_helpers/authGuard.ts";
import {
  type ConditionDescriptorSelection,
  type ConditionPolicy,
  type PolicyCondition,
  validateConditionSelection,
} from "../_helpers/conditionPolicy.ts";

// ebay-edit-listing: everything on a live listing that ISN'T title/description
// (those go through ebay-reprice's update_content action, which already owns
// the top-level `listingDescription` merge/strip logic).
// Actions:
//   get_listing_details: { offerId?, sku?, listingId? }
//   save_changes: { offerId?, sku?, listingId?, changes: {...} }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// Token refresh buffer (5 minutes) — matches ebay-publish/constants.ts's
// REFRESH_BUFFER_MS. Duplicated because edge functions can't import across
// function directories.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const EBAY_OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

function isTokenExpiredOrExpiringSoon(
  expiresAtRaw: string | null | undefined,
  now: Date,
): boolean {
  if (!expiresAtRaw) return true;
  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS;
}

interface ResolvedToken {
  token: string;
  reconnectRequired?: boolean;
}

// Duplicated from ebay-publish/auth.ts's handleGetStoredToken — reads the
// caller's own stored token (already authenticated by requireUser above this
// call), proactively refreshing it if it's expired or expiring soon.
async function resolveUserToken(
  supabase: any,
  userId: string,
  ebayEnv: string,
): Promise<ResolvedToken> {
  const { data, error } = await supabase
    .from("profiles")
    .select("ebay_access_token, ebay_token_expires_at, ebay_refresh_token")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return { token: "", reconnectRequired: true };
  }

  const decryptedAccessToken = await decryptToken(data.ebay_access_token);
  const decryptedRefreshToken = await decryptToken(data.ebay_refresh_token);

  const expiringSoon = isTokenExpiredOrExpiringSoon(
    data.ebay_token_expires_at,
    new Date(),
  );

  if (!expiringSoon) {
    return { token: decryptedAccessToken ?? "" };
  }

  if (!decryptedRefreshToken) {
    return { token: decryptedAccessToken ?? "", reconnectRequired: !decryptedAccessToken };
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    // No app credentials to refresh with — fall back to whatever we have.
    return { token: decryptedAccessToken ?? "" };
  }

  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const refreshResp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptedRefreshToken,
        scope: EBAY_OAUTH_SCOPES.join(" "),
      }).toString(),
    });

    if (!refreshResp.ok) {
      console.warn(
        `ebay-edit-listing: token refresh failed HTTP ${refreshResp.status}`,
      );
      return { token: "", reconnectRequired: true };
    }

    const tokenData = await refreshResp.json();
    if (!tokenData.access_token) {
      return { token: "", reconnectRequired: true };
    }

    const newExpiresAt = new Date(
      Date.now() + tokenData.expires_in * 1000,
    ).toISOString();
    const updatePatch: Record<string, string> = {
      ebay_access_token: await encryptToken(tokenData.access_token),
      ebay_token_expires_at: newExpiresAt,
    };
    if (tokenData.refresh_token) {
      updatePatch.ebay_refresh_token = await encryptToken(tokenData.refresh_token);
    }
    await supabase.from("profiles").update(updatePatch).eq("id", userId);

    return { token: tokenData.access_token };
  } catch (e) {
    console.warn("ebay-edit-listing: token refresh exception (non-fatal):", e);
    return { token: decryptedAccessToken ?? "", reconnectRequired: !decryptedAccessToken };
  }
}

async function callCategoryLookup(
  supabaseUrl: string,
  supabaseServiceKey: string,
  action: "aspects" | "conditions" | "verify",
  categoryId: string,
  sellerUserId?: string,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/category-lookup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        categoryId,
        ...(action === "conditions" && sellerUserId ? { sellerUserId } : {}),
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(
        `ebay-edit-listing: category-lookup ${action} HTTP ${resp.status}`,
      );
      return null;
    }
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchConditionPolicy(
  supabaseUrl: string,
  supabaseServiceKey: string,
  categoryId: string,
  sellerUserId: string,
): Promise<ConditionPolicy> {
  let result: any;
  try {
    result = await callCategoryLookup(
      supabaseUrl,
      supabaseServiceKey,
      "conditions",
      categoryId,
      sellerUserId,
    );
  } catch (error) {
    throw new Error(`Unable to fetch condition policy for category ${categoryId}: ${error}`);
  }
  if (!result?.conditionPolicy) {
    throw new Error(
      `Condition policy for category ${categoryId} is unavailable${
        result?.error ? `: ${result.error}` : ". Retry after category metadata is available."
      }`,
    );
  }
  return result.conditionPolicy;
}

async function fetchTradingListingConditionDetails(
  apiBase: string,
  userToken: string,
  listingId: string,
): Promise<{ categoryId: string; conditionId: string }> {
  if (!/^\d+$/.test(listingId)) throw new Error("A valid eBay listing ID is required to validate its condition.");
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
  const resp = await fetch(tradingUrl, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-SITEID": "0",
      "Content-Type": "text/xml",
      "X-EBAY-API-IAF-TOKEN": userToken,
    },
    body:
      `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${listingId}</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`,
  });
  const xml = await resp.text();
  if (!resp.ok || /<Ack>Failure<\/Ack>|<Ack>PartialFailure<\/Ack>/.test(xml)) {
    const message = xml.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] || `Trading API HTTP ${resp.status}`;
    throw new Error(`Unable to load current listing condition: ${message}`);
  }
  const categoryId = xml.match(/<PrimaryCategory>[\s\S]*?<CategoryID>(\d+)<\/CategoryID>/)?.[1];
  const conditionId = xml.match(/<ConditionID>(\d+)<\/ConditionID>/)?.[1] ?? "";
  if (!categoryId) throw new Error("Unable to determine the listing's current category for condition validation.");
  return { categoryId, conditionId };
}

function isConditionDescriptorSelection(value: unknown): value is ConditionDescriptorSelection[] {
  if (!Array.isArray(value)) return false;
  return value.every((descriptor: unknown) => {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return false;
    const candidate = descriptor as Record<string, unknown>;
    return typeof candidate.name === "string" &&
      (candidate.values === undefined ||
        (Array.isArray(candidate.values) && candidate.values.every((entry: unknown) => typeof entry === "string"))) &&
      (candidate.additionalInfo === undefined || typeof candidate.additionalInfo === "string");
  });
}

// ─── Legacy Trading API: ReviseFixedPriceItem for non-Inventory listings ───────
async function reviseFixedPriceItemFields(
  apiBase: string,
  userToken: string,
  listingId: string,
  fields: {
    price?: number;
    quantity?: number;
    conditionId?: string;
    categoryId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

  const itemFragments: string[] = [`<ItemID>${listingId}</ItemID>`];
  if (fields.price != null) {
    itemFragments.push(
      `<StartPrice currencyID="USD">${fields.price.toFixed(2)}</StartPrice>`,
    );
  }
  if (fields.quantity != null) {
    itemFragments.push(`<Quantity>${fields.quantity}</Quantity>`);
  }
  if (fields.conditionId) {
    itemFragments.push(`<ConditionID>${fields.conditionId}</ConditionID>`);
  }
  if (fields.categoryId) {
    itemFragments.push(`<PrimaryCategory><CategoryID>${fields.categoryId}</CategoryID></PrimaryCategory>`);
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    ${itemFragments.join("\n    ")}
  </Item>
</ReviseFixedPriceItemRequest>`;

  try {
    const resp = await fetch(tradingUrl, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-SITEID": "0",
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": userToken,
      },
      body: xml,
    });

    const xmlText = await resp.text();
    if (!resp.ok) {
      return { success: false, error: `Trading API HTTP ${resp.status}` };
    }
    if (
      xmlText.includes("<Ack>Failure</Ack>") ||
      xmlText.includes("<Ack>PartialFailure</Ack>")
    ) {
      const errMsg = xmlText.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ||
        xmlText.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ||
        "Unknown Trading API error";
      return { success: false, error: errMsg };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: `Exception: ${e}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const auth = await requireUser(req, { supabaseUrl, supabaseServiceKey });
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.message }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = auth.userId!;

    const body = await req.json();
    const { action, offerId, sku, listingId } = body;

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

    const { token, reconnectRequired } = await resolveUserToken(supabase, userId, ebayEnv);
    if (!token) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No eBay token available. Please reconnect in Settings.",
          reconnectRequired: reconnectRequired ?? true,
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Action: get_listing_details ─────────────────────────────────────────
    if (action === "get_listing_details") {
      if (!offerId && !sku) {
        return new Response(
          JSON.stringify({ success: false, error: "offerId or sku required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      let resolvedSku = sku;
      let offer: any = null;

      if (offerId) {
        const offerResp = await fetch(`${apiBase}/sell/inventory/v1/offer/${offerId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
          },
        });
        if (offerResp.ok) {
          offer = await offerResp.json();
          resolvedSku = offer.sku || resolvedSku;
        }
      } else if (sku) {
        const offerListResp = await fetch(
          `${apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=1`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "Accept-Language": "en-US",
            },
          },
        );
        if (offerListResp.ok) {
          const list = await offerListResp.json();
          offer = list?.offers?.[0] ?? null;
        }
      }

      let inventoryItem: any = null;
      if (resolvedSku) {
        const itemResp = await fetch(
          `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(resolvedSku)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "Accept-Language": "en-US",
            },
          },
        );
        if (itemResp.ok) {
          inventoryItem = await itemResp.json();
        }
      }

      const categoryId = offer?.categoryId || null;
      const [aspectsResult, conditionsResult] = categoryId
        ? await Promise.all([
          callCategoryLookup(supabaseUrl, supabaseServiceKey, "aspects", categoryId),
          callCategoryLookup(supabaseUrl, supabaseServiceKey, "conditions", categoryId, userId),
        ])
        : [null, null];

      let cogs: any = null;
      if (listingId || resolvedSku) {
        const query = supabase.from("listing_cogs").select("*").eq("user_id", userId);
        const { data: cogsRows } = listingId
          ? await query.eq("ebay_listing_id", listingId).limit(1)
          : await query.eq("ebay_sku", resolvedSku).limit(1);
        cogs = cogsRows?.[0] ?? null;
      }

      // Flatten the raw eBay offer shape to the contract in
      // LISTING_EDITOR_PLAN.md Part 3 — `price` (not `pricingSummary.price`)
      // and a top-level `bestOfferTerms` (not nested under `listingPolicies`).
      const flattenedOffer = offer
        ? {
          price: offer.pricingSummary?.price ?? null,
          categoryId: offer.categoryId ?? null,
          listingDescription: offer.listingDescription ?? null,
          bestOfferTerms: offer.listingPolicies?.bestOfferTerms ?? { bestOfferEnabled: false },
        }
        : null;

      return new Response(
        JSON.stringify({
          success: true,
          offer: flattenedOffer,
          inventoryItem,
          categoryAspects: aspectsResult?.aspects ?? [],
          allowedConditions: conditionsResult?.conditions ?? [],
          conditionPolicy: conditionsResult?.conditionPolicy ?? null,
          cogs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Action: save_changes ────────────────────────────────────────────────
    if (action === "save_changes") {
      const { changes, cogsUpdate } = body;
      if (!changes || typeof changes !== "object") {
        return new Response(
          JSON.stringify({ success: false, error: "changes object required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const updatedFields: string[] = [];
      const errors: string[] = [];
      const categoryWarnings: string[] = [];
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = { ...changes };
      let inventoryItemForUpdate: any = null;
      let resolvedCondition: PolicyCondition | undefined;
      let conditionDescriptorsForUpdate: ConditionDescriptorSelection[] = [];
      const conditionRequested = Object.hasOwn(changes, "condition") ||
        Object.hasOwn(changes, "conditionDescription") ||
        Object.hasOwn(changes, "conditionDescriptors") ||
        Object.hasOwn(changes, "categoryId");

      if (offerId) {
        // ── Inventory API path ────────────────────────────────────────────
        const getOfferResp = await fetch(`${apiBase}/sell/inventory/v1/offer/${offerId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
          },
        });

        if (!getOfferResp.ok) {
          const err = await getOfferResp.text();
          if (conditionRequested) {
            return new Response(
              JSON.stringify({
                success: false,
                updatedFields: [],
                errors: [
                  `Unable to load the current offer for condition validation: ${getOfferResp.status} ${
                    err.slice(0, 200)
                  }`,
                ],
                warnings: categoryWarnings,
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          errors.push(`Failed to load offer: ${getOfferResp.status} ${err.slice(0, 200)}`);
        } else {
          const offer = await getOfferResp.json();
          oldValues.price = offer.pricingSummary?.price?.value;
          oldValues.categoryId = offer.categoryId;
          oldValues.bestOfferEnabled = offer.listingPolicies?.bestOfferTerms?.bestOfferEnabled;

          if (changes.categoryId && changes.categoryId !== offer.categoryId) {
            const verification = await callCategoryLookup(
              supabaseUrl,
              supabaseServiceKey,
              "verify",
              changes.categoryId,
            );
            if (verification && (!verification.isLeaf || !verification.isActive)) {
              categoryWarnings.push(
                `Category ${changes.categoryId} may not be a valid leaf/active category — verify before relying on it.`,
              );
            }
            if (verification?.isKnownParentOrJunk) {
              categoryWarnings.push(
                `Category ${changes.categoryId} is a known parent/junk category — pick a specific leaf.`,
              );
            }
          }

          const resolvedSku = sku || body.sku;
          if (conditionRequested) {
            if (!resolvedSku) {
              return new Response(
                JSON.stringify({
                  success: false,
                  updatedFields: [],
                  errors: ["An SKU is required to validate and update this listing condition."],
                  warnings: categoryWarnings,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            const itemResp = await fetch(
              `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(resolvedSku)}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "Accept-Language": "en-US",
                },
              },
            );
            if (!itemResp.ok) {
              const err = await itemResp.text();
              return new Response(
                JSON.stringify({
                  success: false,
                  updatedFields: [],
                  errors: [
                    `Unable to load current inventory item for condition validation: ${itemResp.status} ${
                      err.slice(0, 200)
                    }`,
                  ],
                  warnings: categoryWarnings,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            try {
              inventoryItemForUpdate = await itemResp.json();
            } catch {
              return new Response(
                JSON.stringify({
                  success: false,
                  updatedFields: [],
                  errors: ["Unable to read the current inventory item for condition validation."],
                  warnings: categoryWarnings,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            const categoryId = String(changes.categoryId || offer.categoryId || "");
            if (!categoryId) {
              return new Response(
                JSON.stringify({
                  success: false,
                  updatedFields: [],
                  errors: ["A category is required to validate this condition."],
                  warnings: categoryWarnings,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            try {
              const policy = await fetchConditionPolicy(supabaseUrl, supabaseServiceKey, categoryId, userId);
              if (Object.hasOwn(changes, "conditionDescriptors")) {
                if (!isConditionDescriptorSelection(changes.conditionDescriptors)) {
                  throw new Error("Condition descriptors must be provided as a list of descriptor names and values.");
                }
                conditionDescriptorsForUpdate = changes.conditionDescriptors;
              } else {
                conditionDescriptorsForUpdate = Array.isArray(inventoryItemForUpdate.conditionDescriptors)
                  ? inventoryItemForUpdate.conditionDescriptors
                  : [];
              }
              const selectionValue = Object.hasOwn(changes, "condition")
                ? changes.condition
                : Object.hasOwn(changes, "conditionDescription")
                ? changes.conditionDescription
                : inventoryItemForUpdate.condition ?? inventoryItemForUpdate.conditionDescription ?? "";
              const validation = validateConditionSelection(
                policy,
                categoryId,
                String(selectionValue ?? ""),
                conditionDescriptorsForUpdate,
              );
              if (!validation.valid) {
                throw new Error(validation.errors.join("; "));
              }
              resolvedCondition = validation.condition;
            } catch (error) {
              return new Response(
                JSON.stringify({
                  success: false,
                  updatedFields: [],
                  errors: [
                    `Condition validation failed: ${
                      error instanceof Error ? error.message : String(error)
                    }. Select a condition and descriptor values supported by category ${categoryId}.`,
                  ],
                  warnings: categoryWarnings,
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
          }

          // Preserve the real top-level `listingDescription` field — it is
          // NOT nested under `listing`/`listingId`, and both of those must be
          // stripped before PUT (see ebay-reprice's updateOfferDescription).
          const nextOffer: Record<string, unknown> = { ...offer };
          delete nextOffer.offerId;
          delete nextOffer.listing;
          delete nextOffer.listingId;
          delete nextOffer.status;
          delete nextOffer.createdDate;
          delete nextOffer.lastModifiedDate;

          if (changes.price != null) {
            nextOffer.pricingSummary = {
              ...(offer.pricingSummary || {}),
              price: {
                ...(offer.pricingSummary?.price || { currency: "USD" }),
                value: String(changes.price),
              },
            };
            updatedFields.push("price");
          }
          if (changes.categoryId) {
            nextOffer.categoryId = changes.categoryId;
            updatedFields.push("categoryId");
          }
          if (
            changes.bestOfferEnabled != null ||
            changes.bestOfferAutoAcceptPrice != null ||
            changes.bestOfferAutoDeclinePrice != null
          ) {
            const existingTerms = offer.listingPolicies?.bestOfferTerms || {};
            const nextTerms: Record<string, unknown> = {
              ...existingTerms,
              ...(changes.bestOfferEnabled != null ? { bestOfferEnabled: changes.bestOfferEnabled } : {}),
            };
            if (changes.bestOfferAutoAcceptPrice != null) {
              nextTerms.autoAcceptPrice = {
                value: String(changes.bestOfferAutoAcceptPrice),
                currency: existingTerms.autoAcceptPrice?.currency ?? "USD",
              };
            }
            if (changes.bestOfferAutoDeclinePrice != null) {
              nextTerms.autoDeclinePrice = {
                value: String(changes.bestOfferAutoDeclinePrice),
                currency: existingTerms.autoDeclinePrice?.currency ?? "USD",
              };
            }
            nextOffer.listingPolicies = {
              ...(offer.listingPolicies || {}),
              bestOfferTerms: nextTerms,
            };
            updatedFields.push("bestOfferEnabled");
          }

          if (updatedFields.length > 0) {
            const putOfferResp = await fetch(`${apiBase}/sell/inventory/v1/offer/${offerId}`, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Accept-Language": "en-US",
              },
              body: JSON.stringify(nextOffer),
            });
            if (!putOfferResp.ok) {
              const err = await putOfferResp.text();
              errors.push(`Failed to update offer: ${putOfferResp.status} ${err.slice(0, 200)}`);
            }
          }
        }

        // Inventory item: quantity/condition/aspects live here, not the offer.
        const resolvedSku = sku || body.sku;
        if (resolvedSku && (changes.quantity != null || conditionRequested || changes.itemSpecifics)) {
          if (inventoryItemForUpdate) {
            const item = inventoryItemForUpdate;
            oldValues.quantity = item.availability?.shipToLocationAvailability?.quantity;
            oldValues.condition = item.condition;

            const nextItem: Record<string, unknown> = { ...item };
            if (changes.quantity != null) {
              nextItem.availability = {
                ...(item.availability || {}),
                shipToLocationAvailability: {
                  ...(item.availability?.shipToLocationAvailability || {}),
                  quantity: changes.quantity,
                },
              };
              updatedFields.push("quantity");
            }
            if (conditionRequested && resolvedCondition) {
              nextItem.condition = resolvedCondition.conditionEnum;
              nextItem.conditionDescription = resolvedCondition.conditionDescription;
              if (Object.hasOwn(changes, "conditionDescriptors")) {
                nextItem.conditionDescriptors = conditionDescriptorsForUpdate;
                updatedFields.push("conditionDescriptors");
              }
              updatedFields.push("condition");
              if (Object.hasOwn(changes, "conditionDescription")) updatedFields.push("conditionDescription");
            } else if (conditionRequested) {
              delete nextItem.condition;
              delete nextItem.conditionDescription;
              delete nextItem.conditionDescriptors;
              updatedFields.push("condition", "conditionDescriptors");
            }
            if (changes.itemSpecifics) {
              nextItem.product = { ...(item.product || {}), aspects: changes.itemSpecifics };
              updatedFields.push("itemSpecifics");
            }
            const putItemResp = await fetch(
              `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(resolvedSku)}`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "Accept-Language": "en-US",
                },
                body: JSON.stringify(nextItem),
              },
            );
            if (!putItemResp.ok) {
              const err = await putItemResp.text();
              errors.push(`Failed to update inventory item: ${putItemResp.status} ${err.slice(0, 200)}`);
            }
          } else {
            const getItemResp = await fetch(
              `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(resolvedSku)}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "Accept-Language": "en-US",
                },
              },
            );
            if (!getItemResp.ok) {
              const err = await getItemResp.text();
              errors.push(`Failed to load inventory item: ${getItemResp.status} ${err.slice(0, 200)}`);
            } else {
              const item = await getItemResp.json();
              oldValues.quantity = item.availability?.shipToLocationAvailability?.quantity;
              oldValues.condition = item.condition;

              const nextItem: Record<string, unknown> = { ...item };
              if (changes.quantity != null) {
                nextItem.availability = {
                  ...(item.availability || {}),
                  shipToLocationAvailability: {
                    ...(item.availability?.shipToLocationAvailability || {}),
                    quantity: changes.quantity,
                  },
                };
                updatedFields.push("quantity");
              }
              if (conditionRequested && resolvedCondition) {
                nextItem.condition = resolvedCondition.conditionEnum;
                nextItem.conditionDescription = resolvedCondition.conditionDescription;
                updatedFields.push("condition");
              }
              if (Object.hasOwn(changes, "conditionDescriptors")) {
                nextItem.conditionDescriptors = conditionDescriptorsForUpdate;
                updatedFields.push("conditionDescriptors");
              }
              if (Object.hasOwn(changes, "conditionDescription")) {
                updatedFields.push("conditionDescription");
              }
              if (changes.itemSpecifics) {
                nextItem.product = {
                  ...(item.product || {}),
                  aspects: changes.itemSpecifics,
                };
                updatedFields.push("itemSpecifics");
              }

              const putItemResp = await fetch(
                `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(resolvedSku)}`,
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Accept-Language": "en-US",
                  },
                  body: JSON.stringify(nextItem),
                },
              );
              if (!putItemResp.ok) {
                const err = await putItemResp.text();
                errors.push(`Failed to update inventory item: ${putItemResp.status} ${err.slice(0, 200)}`);
              }
            }
          }
        }
      } else if (listingId) {
        // ── Legacy Trading API path ───────────────────────────────────────
        let conditionId = changes.condition;
        if (conditionRequested) {
          if (Object.hasOwn(changes, "conditionDescriptors")) {
            return new Response(
              JSON.stringify({
                success: false,
                updatedFields: [],
                errors: ["Condition descriptors can only be edited through the Inventory API."],
                warnings: [],
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          try {
            const current = changes.categoryId
              ? { categoryId: String(changes.categoryId), conditionId: "" }
              : await fetchTradingListingConditionDetails(apiBase, token, listingId);
            const policy = await fetchConditionPolicy(
              supabaseUrl,
              supabaseServiceKey,
              current.categoryId,
              userId,
            );
            const validation = validateConditionSelection(
              policy,
              current.categoryId,
              String(
                Object.hasOwn(changes, "condition")
                  ? changes.condition
                  : Object.hasOwn(changes, "conditionDescription")
                  ? changes.conditionDescription
                  : current.conditionId,
              ),
            );
            if (!validation.valid || !validation.condition) {
              throw new Error(validation.errors.join("; "));
            }
            resolvedCondition = validation.condition;
            conditionId = validation.condition.conditionId;
          } catch (error) {
            return new Response(
              JSON.stringify({
                success: false,
                updatedFields: [],
                errors: [
                  `Condition validation failed: ${
                    error instanceof Error ? error.message : String(error)
                  }. Select a condition supported by this category.`,
                ],
                warnings: [],
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
        const result = await reviseFixedPriceItemFields(apiBase, token, listingId, {
          price: changes.price,
          quantity: changes.quantity,
          conditionId,
          categoryId: changes.categoryId,
        });
        if (result.success) {
          if (changes.price != null) updatedFields.push("price");
          if (changes.quantity != null) updatedFields.push("quantity");
          if (changes.condition) updatedFields.push("condition");
          if (changes.categoryId) updatedFields.push("categoryId");
        } else {
          errors.push(result.error || "Trading API update failed");
        }
      } else {
        errors.push("offerId or listingId required to save changes");
      }

      // ── Sync drafts row (best-effort, don't fail the request over it) ──
      if (updatedFields.length > 0 && (sku || listingId)) {
        try {
          const draftPatch: Record<string, unknown> = {};
          if (changes.price != null) {
            draftPatch.price_min = changes.price;
            draftPatch.price_max = changes.price;
          }
          if (conditionRequested && resolvedCondition) draftPatch.condition = resolvedCondition.conditionEnum;
          if (changes.categoryId) draftPatch.ebay_category_id = changes.categoryId;
          if (changes.itemSpecifics) draftPatch.item_specifics = changes.itemSpecifics;

          if (Object.keys(draftPatch).length > 0) {
            let draftQuery = supabase.from("drafts").update(draftPatch).eq("user_id", userId);
            draftQuery = listingId ? draftQuery.eq("ebay_listing_id", listingId) : draftQuery.eq("ebay_sku", sku);
            await draftQuery;
          }
        } catch (e) {
          console.warn("ebay-edit-listing: drafts sync failed (non-fatal):", e);
        }
      }

      // ── Upsert COGS if provided ─────────────────────────────────────────
      if (cogsUpdate && listingId) {
        try {
          const { error: cogsError } = await supabase.from("listing_cogs").upsert(
            {
              user_id: userId,
              ebay_listing_id: listingId,
              ebay_sku: sku ?? null,
              title: cogsUpdate.title ?? "",
              cogs: cogsUpdate.cogs,
              cogs_source: cogsUpdate.cogsSource ?? "manual",
              acquired_at: cogsUpdate.acquiredAt ?? null,
            },
            { onConflict: "user_id,ebay_listing_id" },
          );
          if (cogsError) {
            errors.push(`COGS update failed: ${cogsError.message}`);
          } else {
            updatedFields.push("cogs");
          }
        } catch (e) {
          errors.push(`COGS update exception: ${e}`);
        }
      }

      const success = errors.length === 0 && updatedFields.length > 0;

      // ── Audit log (always written, success or failure) ─────────────────
      let auditLogId: string | null = null;
      try {
        const { data: logRow } = await supabase
          .from("listing_edits_log")
          .insert({
            user_id: userId,
            ebay_sku: sku ?? null,
            ebay_listing_id: listingId ?? null,
            ebay_offer_id: offerId ?? null,
            fields_changed: updatedFields,
            old_values: oldValues,
            new_values: newValues,
            success,
            error_message: errors.length > 0 ? errors.join("; ") : null,
            ebay_api_path: offerId ? "inventory_api" : "trading_api",
          })
          .select("id")
          .single();
        auditLogId = logRow?.id ?? null;
      } catch (e) {
        console.warn("ebay-edit-listing: failed to write audit log (non-fatal):", e);
      }

      return new Response(
        JSON.stringify({
          success,
          updatedFields,
          errors,
          warnings: categoryWarnings,
          auditLogId,
        }),
        {
          status: success || updatedFields.length > 0 ? 200 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ebay-edit-listing error:", e);
    return new Response(
      JSON.stringify({ success: false, error: `${e}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
