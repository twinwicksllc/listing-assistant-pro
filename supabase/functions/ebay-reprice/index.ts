import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ebay-reprice v1: supports single + bulk price updates for eBay listings
// - Inventory API listings: bulkUpdatePriceQuantity (up to 25 per call)
// - Legacy Trading API listings (offerId=null): ReviseFixedPriceItem XML
// Actions:
//   bulk_update: { updates: Array<{ offerId, sku, listingId, newPrice }> }
//   single_update: { offerId, sku, listingId, newPrice }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

// ─── Trading API: ReviseFixedPriceItem for legacy listings (no offerId) ───────
async function reviseFixedPriceItem(
  apiBase: string,
  userToken: string,
  listingId: string,
  newPrice: number,
  currency: string = "USD",
): Promise<{ success: boolean; error?: string }> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${listingId}</ItemID>
    <StartPrice currencyID="${currency}">${newPrice.toFixed(2)}</StartPrice>
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
    console.log(
      `ReviseFixedPriceItem ${listingId}: HTTP ${resp.status}, first 400:`,
      xmlText.substring(0, 400),
    );

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

// ─── Trading API: ReviseFixedPriceItem title/description for legacy listings ──
async function reviseFixedPriceItemContent(
  apiBase: string,
  userToken: string,
  listingId: string,
  newTitle?: string,
  newDescription?: string,
): Promise<{ success: boolean; error?: string }> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

  const itemFragments: string[] = [`<ItemID>${listingId}</ItemID>`];
  if (newTitle) itemFragments.push(`<Title>${newTitle}</Title>`);
  if (newDescription) itemFragments.push(`<Description><![CDATA[${newDescription}]]></Description>`);

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

// ─── Inventory API: look up offerId by SKU ──────────────────────────────────────
async function lookupOfferIdBySku(
  apiBase: string,
  userToken: string,
  sku: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      `${apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
      },
    );
    if (!resp.ok) {
      console.warn(`lookupOfferIdBySku: HTTP ${resp.status} for sku=${sku}`);
      return null;
    }
    const data = await resp.json();
    const offerId = data?.offers?.[0]?.offerId ?? null;
    console.log(`lookupOfferIdBySku: sku=${sku} → offerId=${offerId}`);
    return offerId;
  } catch (e) {
    console.warn(`lookupOfferIdBySku exception: ${e}`);
    return null;
  }
}

async function updateInventoryItemTitle(
  apiBase: string,
  userToken: string,
  sku: string,
  newTitle: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const getResp = await fetch(
      `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
      },
    );

    if (!getResp.ok) {
      const err = await getResp.text();
      return { success: false, error: `Failed to load inventory item: ${getResp.status} ${err.slice(0, 200)}` };
    }

    const item = await getResp.json();
    const nextItem: Record<string, unknown> = {
      ...item,
      product: {
        ...(item.product || {}),
        title: newTitle,
      },
    };

    const putResp = await fetch(
      `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
        body: JSON.stringify(nextItem),
      },
    );

    if (!putResp.ok) {
      const err = await putResp.text();
      return { success: false, error: `Failed to update inventory title: ${putResp.status} ${err.slice(0, 200)}` };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: `Exception updating inventory title: ${e}` };
  }
}

async function updateOfferDescription(
  apiBase: string,
  userToken: string,
  offerId: string,
  newDescription: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const getResp = await fetch(`${apiBase}/sell/inventory/v1/offer/${offerId}`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
    });

    if (!getResp.ok) {
      const err = await getResp.text();
      return { success: false, error: `Failed to load offer: ${getResp.status} ${err.slice(0, 200)}` };
    }

    const offer = await getResp.json();
    const nextOffer: Record<string, unknown> = {
      ...offer,
      listingDescription: newDescription,
    };

    delete nextOffer.offerId;
    delete nextOffer.listing;
    delete nextOffer.listingId;
    delete nextOffer.status;
    delete nextOffer.createdDate;
    delete nextOffer.lastModifiedDate;

    const putResp = await fetch(`${apiBase}/sell/inventory/v1/offer/${offerId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify(nextOffer),
    });

    if (!putResp.ok) {
      const err = await putResp.text();
      return { success: false, error: `Failed to update offer description: ${putResp.status} ${err.slice(0, 200)}` };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: `Exception updating offer description: ${e}` };
  }
}

// ─── Inventory API: bulkUpdatePriceQuantity ────────────────────────────────────
// Groups offers by SKU as required by the API.
// Each request item: { sku, offers: [{ offerId, price }] }
// Up to 25 offers per API call.
async function bulkUpdateInventoryPrices(
  apiBase: string,
  userToken: string,
  updates: Array<
    { offerId: string; sku: string; newPrice: number; currency?: string }
  >,
): Promise<
  Array<
    { offerId: string; success: boolean; statusCode?: number; error?: string }
  >
> {
  // Group by SKU
  const bySku: Record<string, typeof updates> = {};
  for (const u of updates) {
    if (!bySku[u.sku]) bySku[u.sku] = [];
    bySku[u.sku].push(u);
  }

  const requestItems = Object.entries(bySku).map(([sku, items]) => ({
    sku,
    offers: items.map((i) => ({
      offerId: i.offerId,
      price: {
        currency: i.currency || "USD",
        value: i.newPrice.toFixed(2),
      },
    })),
  }));

  // Split into batches of 25 (API limit)
  const BATCH_SIZE = 25;
  const results: Array<
    { offerId: string; success: boolean; statusCode?: number; error?: string }
  > = [];

  for (let i = 0; i < requestItems.length; i += BATCH_SIZE) {
    const batch = requestItems.slice(i, i + BATCH_SIZE);

    try {
      const resp = await fetch(
        `${apiBase}/sell/inventory/v1/bulk_update_price_quantity`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
          },
          body: JSON.stringify({ requests: batch }),
        },
      );

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("bulkUpdatePriceQuantity error:", resp.status, errText);
        // Mark all offers in this batch as failed
        for (const item of batch) {
          for (const offer of item.offers) {
            results.push({
              offerId: offer.offerId,
              success: false,
              error: `API ${resp.status}: ${errText}`,
            });
          }
        }
        continue;
      }

      let data: any;
      try {
        const respText = await resp.text();
        data = JSON.parse(respText);
      } catch {
        console.error(
          `ebay-reprice: JSON parse error (length=${await resp.text().then(
            (t) => t.length,
          )})`,
        );
        continue;
      }
      console.log(
        "bulkUpdatePriceQuantity response:",
        JSON.stringify(data).substring(0, 600),
      );

      // Parse per-offer results
      // Response: { responses: [ { offerId, statusCode, errors[] } ] }
      const responses = data.responses || [];
      const responseMap: Record<
        string,
        { statusCode: number; errors?: any[] }
      > = {};
      for (const r of responses) {
        if (r.offerId) responseMap[r.offerId] = r;
      }

      for (const item of batch) {
        for (const offer of item.offers) {
          const r = responseMap[offer.offerId];
          if (!r) {
            results.push({
              offerId: offer.offerId,
              success: false,
              error: "No response from eBay",
            });
          } else if (r.statusCode === 200) {
            results.push({
              offerId: offer.offerId,
              success: true,
              statusCode: 200,
            });
          } else {
            const errMsg = r.errors?.[0]?.message ||
              `Status code ${r.statusCode}`;
            results.push({
              offerId: offer.offerId,
              success: false,
              statusCode: r.statusCode,
              error: errMsg,
            });
          }
        }
      }
    } catch (e) {
      console.error("bulkUpdatePriceQuantity exception:", e);
      for (const item of batch) {
        for (const offer of item.offers) {
          results.push({
            offerId: offer.offerId,
            success: false,
            error: `Exception: ${e}`,
          });
        }
      }
    }
  }

  return results;
}

// ─── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, userToken, userId } = body;

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

    console.log(`ebay-reprice: action=${action}, env=${ebayEnv}`);

    // ── Resolve token ──────────────────────────────────────────────────────────
    let token: string = userToken || "";

    // If no token in request, try to fetch from Supabase profiles
    if (!token && userId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: profile } = await supabase
        .from("profiles")
        .select("ebay_access_token")
        .eq("id", userId)
        .single();
      if (profile?.ebay_access_token) token = profile.ebay_access_token;
    }

    if (!token) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No eBay token available. Please reconnect in Settings.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Action: single_update ─────────────────────────────────────────────────
    if (action === "single_update") {
      const { offerId, sku, listingId, newPrice, currency = "USD" } = body;

      if (!newPrice || newPrice <= 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid price: must be a positive number",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Inventory API listing (has offerId)
      if (offerId) {
        const results = await bulkUpdateInventoryPrices(apiBase, token, [
          { offerId, sku: sku || offerId, newPrice, currency },
        ]);
        const result = results[0];

        // If Inventory API fails, try to extract the full error message and check for fallback-worthy errors
        const errorMsg = result.error || "";
        const shouldFallback = !result.success &&
          (errorMsg.includes("not currently supported") ||
            errorMsg.includes("Inventory-based listing management")) &&
          listingId;

        if (shouldFallback) {
          console.log(
            `[ebay-reprice] Inventory API error for ${offerId}: "${errorMsg}". Attempting fallback to Trading API with listing ${listingId}`,
          );
          try {
            const tradingResult = await reviseFixedPriceItem(
              apiBase,
              token,
              listingId,
              newPrice,
              currency,
            );
            console.log(
              `[ebay-reprice] Trading API fallback result:`,
              tradingResult.success ? "SUCCESS" : `FAILED: ${tradingResult.error}`,
            );
            return new Response(
              JSON.stringify(tradingResult),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          } catch (fallbackErr) {
            console.error(`[ebay-reprice] Trading API fallback exception:`, fallbackErr);
            return new Response(
              JSON.stringify({ success: false, error: `Trading API fallback failed: ${fallbackErr}` }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        console.log(
          `[ebay-reprice] Inventory API result for ${offerId}:`,
          result.success ? "SUCCESS" : `FAILED: ${result.error}`,
        );
        return new Response(
          JSON.stringify({ success: result.success, error: result.error }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Legacy Trading API listing (no offerId, has listingId)
      if (listingId) {
        const tradingResult = await reviseFixedPriceItem(
          apiBase,
          token,
          listingId,
          newPrice,
          currency,
        );

        // eBay may reject this if the listing is actually Inventory-managed.
        // In that case, look up the offerId by SKU and retry via Inventory API.
        const isInventoryItem = !tradingResult.success &&
          (tradingResult.error?.includes("not allowed for inventory") ||
            tradingResult.error?.includes("Inventory-based listing"));

        if (isInventoryItem && sku) {
          console.log(
            `[ebay-reprice] Trading API rejected inventory item ${listingId}. Looking up offerId by sku=${sku}`,
          );
          const resolvedOfferId = await lookupOfferIdBySku(apiBase, token, sku);
          if (resolvedOfferId) {
            const inventoryResults = await bulkUpdateInventoryPrices(
              apiBase,
              token,
              [{ offerId: resolvedOfferId, sku, newPrice, currency }],
            );
            const inventoryResult = inventoryResults[0];
            console.log(
              `[ebay-reprice] Inventory API retry for offerId=${resolvedOfferId}: ` +
                (inventoryResult.success ? "SUCCESS" : `FAILED: ${inventoryResult.error}`),
            );
            return new Response(
              JSON.stringify({
                success: inventoryResult.success,
                error: inventoryResult.error,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          console.warn(
            `[ebay-reprice] Could not resolve offerId for sku=${sku}; ` +
              `returning original Trading API error`,
          );
        }

        return new Response(
          JSON.stringify(tradingResult),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: "Must provide either offerId or listingId",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Action: update_content (title / description) ────────────────────────
    if (action === "update_content") {
      const {
        offerId,
        sku,
        listingId,
        newTitle,
        newDescription,
      }: {
        offerId?: string | null;
        sku?: string | null;
        listingId?: string | null;
        newTitle?: string | null;
        newDescription?: string | null;
      } = body;

      const trimmedTitle = (newTitle || "").trim();
      const trimmedDescription = (newDescription || "").trim();
      const wantsTitle = trimmedTitle.length > 0;
      const wantsDescription = trimmedDescription.length > 0;

      if (!wantsTitle && !wantsDescription) {
        return new Response(
          JSON.stringify({ success: false, error: "Nothing to update: provide newTitle and/or newDescription" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let effectiveOfferId = offerId || null;
      if (!effectiveOfferId && sku) {
        effectiveOfferId = await lookupOfferIdBySku(apiBase, token, sku);
      }

      let titleUpdated = false;
      let descriptionUpdated = false;
      const errors: string[] = [];

      if (wantsTitle) {
        if (sku) {
          const titleResult = await updateInventoryItemTitle(apiBase, token, sku, trimmedTitle);
          if (titleResult.success) {
            titleUpdated = true;
          } else if (listingId) {
            const fallback = await reviseFixedPriceItemContent(
              apiBase,
              token,
              listingId,
              trimmedTitle,
              undefined,
            );
            if (fallback.success) titleUpdated = true;
            else errors.push(fallback.error || "Failed to update title");
          } else {
            errors.push(titleResult.error || "Failed to update title");
          }
        } else if (listingId) {
          const fallback = await reviseFixedPriceItemContent(
            apiBase,
            token,
            listingId,
            trimmedTitle,
            undefined,
          );
          if (fallback.success) titleUpdated = true;
          else errors.push(fallback.error || "Failed to update title");
        } else {
          errors.push("Cannot update title: missing sku/listingId");
        }
      }

      if (wantsDescription) {
        if (effectiveOfferId) {
          const descResult = await updateOfferDescription(
            apiBase,
            token,
            effectiveOfferId,
            trimmedDescription,
          );
          if (descResult.success) {
            descriptionUpdated = true;
          } else {
            errors.push(descResult.error || "Failed to update description");
          }
        } else if (listingId) {
          const fallback = await reviseFixedPriceItemContent(
            apiBase,
            token,
            listingId,
            undefined,
            trimmedDescription,
          );
          if (fallback.success) descriptionUpdated = true;
          else errors.push(fallback.error || "Failed to update description");
        } else {
          errors.push("Cannot update description: missing offerId/sku/listingId");
        }
      }

      const success = (wantsTitle ? titleUpdated : true) &&
        (wantsDescription ? descriptionUpdated : true);

      return new Response(
        JSON.stringify({
          success,
          titleUpdated,
          descriptionUpdated,
          error: success ? null : errors.join(" | "),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Action: bulk_update ───────────────────────────────────────────────────
    if (action === "bulk_update") {
      const { updates } = body as {
        updates: Array<{
          offerId: string | null;
          sku: string | null;
          listingId: string | null;
          newPrice: number;
          currency?: string;
          title?: string;
        }>;
      };

      if (!updates || updates.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "No updates provided" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Validate prices
      for (const u of updates) {
        if (!u.newPrice || u.newPrice <= 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Invalid price for listing ${u.listingId || u.sku}: must be positive`,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      // Separate inventory API vs Trading API listings
      const inventoryUpdates = updates.filter((u) => !!u.offerId) as Array<{
        offerId: string;
        sku: string;
        listingId: string | null;
        newPrice: number;
        currency?: string;
      }>;
      const tradingUpdates = updates.filter((u) => !u.offerId && !!u.listingId);

      const allResults: Array<{
        offerId?: string | null;
        listingId?: string | null;
        sku?: string | null;
        title?: string;
        success: boolean;
        error?: string;
      }> = [];

      // Process Inventory API listings in bulk
      if (inventoryUpdates.length > 0) {
        const inventoryResults = await bulkUpdateInventoryPrices(
          apiBase,
          token,
          inventoryUpdates.map((u) => ({
            offerId: u.offerId,
            sku: u.sku || u.offerId,
            newPrice: u.newPrice,
            currency: u.currency || "USD",
          })),
        );

        for (let i = 0; i < inventoryResults.length; i++) {
          const r = inventoryResults[i];
          const u = inventoryUpdates[i];
          allResults.push({
            offerId: u.offerId,
            listingId: u.listingId,
            sku: u.sku,
            success: r.success,
            error: r.error,
          });
        }
      }

      // Process Trading API listings individually (no bulk API for legacy)
      for (const u of tradingUpdates) {
        const result = await reviseFixedPriceItem(
          apiBase,
          token,
          u.listingId!,
          u.newPrice,
          u.currency || "USD",
        );
        allResults.push({
          offerId: null,
          listingId: u.listingId,
          sku: u.sku,
          title: u.title,
          success: result.success,
          error: result.error,
        });
      }

      const successCount = allResults.filter((r) => r.success).length;
      const failCount = allResults.filter((r) => !r.success).length;

      console.log(
        `bulk_update: ${successCount} succeeded, ${failCount} failed`,
      );

      return new Response(
        JSON.stringify({
          success: failCount === 0,
          successCount,
          failCount,
          results: allResults,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-reprice error:", errorMsg, e);
    return new Response(
      JSON.stringify({ success: false, error: `Server error: ${errorMsg}` }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
