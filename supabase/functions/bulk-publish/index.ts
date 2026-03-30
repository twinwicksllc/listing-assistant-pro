import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// Row cap per tier
const ROW_CAPS: Record<string, number> = {
  starter: 5,
  pro: 50,
  unlimited: 1000,
  admin: 1000,
};

interface BulkRowInput {
  rowIndex: number;
  title: string;
  description?: string;
  condition: string;
  price: number;
  quantity: number;
  categoryId: string;
  format: "FIXED_PRICE" | "AUCTION";
  auctionStartPrice?: number;
  buyItNowPrice?: number;
  imageUrls?: string[];
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  itemSpecifics?: Record<string, string>;
  cogs?: number;
  consignor?: string;
}

interface BulkPublishResult {
  rowIndex: number;
  success: boolean;
  listingId?: string;
  offerId?: string;
  sku?: string;
  error?: string;
}

// Condition ID mapping (mirrors ebay-publish)
const CONDITION_ID_MAP: Record<string, number> = {
  NEW: 1000,
  LIKE_NEW: 2750,
  NEW_OTHER: 1500,
  NEW_WITH_DEFECTS: 1750,
  CERTIFIED_REFURBISHED: 2000,
  EXCELLENT_REFURBISHED: 2010,
  VERY_GOOD_REFURBISHED: 2020,
  GOOD_REFURBISHED: 2030,
  SELLER_REFURBISHED: 2500,
  PRE_OWNED_GOOD: 3000,
  PRE_OWNED_FAIR: 5000,
  PRE_OWNED_POOR: 6000,
  FOR_PARTS_OR_NOT_WORKING: 7000,
};

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = 20000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const { data: ud } = await svc.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    const userId = ud?.user?.id;
    const userEmail = ud?.user?.email;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Determine tier
    const ADMIN_EMAILS = ["twinwicksllc@gmail.com"];
    const isAdmin = userEmail ? ADMIN_EMAILS.includes(userEmail) : false;
    let tier: "starter" | "pro" | "unlimited" | "admin" = isAdmin ? "admin" : "starter";

    if (!isAdmin) {
      const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
      if (STRIPE_SECRET_KEY && userEmail) {
        try {
          const { default: Stripe } = await import(
            "https://esm.sh/stripe@18.5.0"
          );
          const stripe = new Stripe(STRIPE_SECRET_KEY, {
            apiVersion: "2025-08-27.basil",
          });
          const customers = await stripe.customers.list({
            email: userEmail,
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
              if (productId === "prod_U70aT1KvuI2uDx") tier = "unlimited";
              else if (productId === "prod_U6zUiC1SYuPrGU") tier = "pro";
            }
          }
        } catch (e) {
          console.warn("Stripe check failed:", e);
        }
      }
    }

    const body = await req.json();
    const { userToken, rows, dryRun = false } = body as {
      userToken: string;
      rows: BulkRowInput[];
      dryRun?: boolean;
    };

    if (!userToken) {
      return new Response(
        JSON.stringify({ error: "eBay user token required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const cap = ROW_CAPS[tier] ?? 5;
    if (rows.length > cap) {
      return new Response(
        JSON.stringify({
          error: `Your plan allows bulk publishing up to ${cap} listings at a time. You submitted ${rows.length}.`,
          cap,
          tier,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Dry run: validate only, no eBay calls
    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          rowCount: rows.length,
          tier,
          cap,
          message: `Dry run successful — ${rows.length} rows validated, ready to publish`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ebayEnv = Deno.env.get("EBAY_ENV") || "production";
    const apiBase = ebayEnv === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

    const authHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    };

    // Fetch seller's location info once (postal code + city)
    let postalCode = "60601";
    let city = "";
    try {
      const { data: profile } = await svc
        .from("profiles")
        .select("postal_code, city")
        .eq("id", userId)
        .single();
      if (profile?.postal_code) postalCode = profile.postal_code;
      if (profile?.city) city = profile.city;
    } catch (_) { /* non-fatal */ }

    // Ensure inventory location exists once (shared across all rows)
    const merchantLocationKey = `BULK-${userId.slice(0, 8).toUpperCase()}`;
    try {
      const checkResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
        { headers: authHeaders, timeout: 10000 },
      );
      if (checkResp.status === 404) {
        // Create the location
        await fetchWithTimeout(
          `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
          {
            method: "POST",
            headers: authHeaders,
            timeout: 10000,
            body: JSON.stringify({
              location: {
                address: {
                  country: "US",
                  postalCode,
                  ...(city ? { city } : {}),
                },
              },
              locationTypes: ["WAREHOUSE"],
              name: "Bulk Listing Location",
              merchantLocationStatus: "ENABLED",
            }),
          },
        );
      }
    } catch (locErr) {
      console.warn("Location setup error (non-fatal):", locErr);
    }

    // Fetch default policies once (used as fallback if row doesn't specify)
    const fetchDefaultPolicy = async (
      policyType: string,
    ): Promise<string | null> => {
      try {
        const resp = await fetchWithTimeout(
          `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
          { headers: authHeaders, timeout: 10000 },
        );
        if (!resp.ok) return null;
        let data: any;
        try {
          const respText = await resp.text();
          data = JSON.parse(respText);
        } catch (e) {
          console.warn(
            `bulk-publish: Failed to parse ${policyType} policy response: ${e}`,
          );
          return null;
        }
        const policies = data[`${policyType}Policies`] || [];
        return Array.isArray(policies) && policies.length > 0 ? policies[0][`${policyType}PolicyId`] || null : null;
      } catch {
        return null;
      }
    };

    const [defaultFulfillment, defaultReturn] = await Promise.all([
      fetchDefaultPolicy("fulfillment"),
      fetchDefaultPolicy("return"),
    ]);

    // Process each row
    const results: BulkPublishResult[] = [];

    for (const row of rows) {
      try {
        // Generate SKU
        let sku: string;
        try {
          const { data: seqNum, error: seqError } = await svc.rpc(
            "increment_sku_sequence",
            { user_id: userId },
          );
          if (seqError || seqNum == null) throw new Error("seq error");
          sku = `BK${String(seqNum).padStart(5, "0")}`;
        } catch {
          sku = `BK-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
        }

        // Condition normalization
        const conditionEnum = Object.keys(CONDITION_ID_MAP).includes(row.condition) ? row.condition : "PRE_OWNED_GOOD";
        const conditionId = CONDITION_ID_MAP[conditionEnum] ?? 3000;

        // Build inventory item
        const imageUrls = (row.imageUrls ?? []).filter((u) => u?.startsWith("http")).slice(0, 8);
        const inventoryBody: Record<string, unknown> = {
          product: {
            title: row.title.slice(0, 80),
            ...(imageUrls.length > 0 ? { imageUrls } : {}),
            ...(row.itemSpecifics && Object.keys(row.itemSpecifics).length > 0
              ? {
                aspects: Object.fromEntries(
                  Object.entries(row.itemSpecifics)
                    .filter(([, v]) => v)
                    .map(([k, v]) => [k, [v]]),
                ),
              }
              : {}),
          },
          condition: conditionEnum,
          conditionDescription: conditionEnum
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, (c: string) => c.toUpperCase()),
          availability: {
            shipToLocationAvailability: { quantity: row.quantity || 1 },
          },
        };

        // Step 1: Create inventory item
        const invResp = await fetchWithTimeout(
          `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
          {
            method: "PUT",
            headers: authHeaders,
            timeout: 15000,
            body: JSON.stringify(inventoryBody),
          },
        );
        if (!invResp.ok) {
          const errText = await invResp.text();
          throw new Error(
            `Inventory item failed (${invResp.status}): ${errText.slice(0, 300)}`,
          );
        }

        // Step 2: Build offer
        const fulfillmentPolicyId = row.fulfillmentPolicyId ||
          defaultFulfillment;
        const returnPolicyId = row.returnPolicyId || defaultReturn;

        if (!fulfillmentPolicyId) {
          throw new Error(
            "No fulfillment policy found. Please set one in eBay Seller Hub first.",
          );
        }

        const offerBody: Record<string, unknown> = {
          sku,
          marketplaceId: "EBAY_US",
          format: row.format,
          categoryId: row.categoryId,
          listingDescription: row.description || row.title,
          pricingSummary: row.format === "AUCTION"
            ? {
              auctionStartPrice: {
                value: String((row.auctionStartPrice ?? 0.99).toFixed(2)),
                currency: "USD",
              },
              ...(row.buyItNowPrice
                ? {
                  auctionReservePrice: {
                    value: String(row.buyItNowPrice.toFixed(2)),
                    currency: "USD",
                  },
                }
                : {}),
            }
            : {
              price: {
                value: String((row.price || 0.99).toFixed(2)),
                currency: "USD",
              },
            },
          quantityLimitPerBuyer: 10,
          includeCatalogProductDetails: false,
          listingPolicies: {
            fulfillmentPolicyId,
            ...(returnPolicyId ? { returnPolicyId } : {}),
            ...(row.paymentPolicyId ? { paymentPolicyId: row.paymentPolicyId } : {}),
          },
          merchantLocationKey,
          conditionId,
        };

        // Step 3: Create offer
        const offerResp = await fetchWithTimeout(
          `${apiBase}/sell/inventory/v1/offer`,
          {
            method: "POST",
            headers: authHeaders,
            timeout: 15000,
            body: JSON.stringify(offerBody),
          },
        );
        if (!offerResp.ok) {
          const errText = await offerResp.text();
          throw new Error(
            `Offer creation failed (${offerResp.status}): ${errText.slice(0, 300)}`,
          );
        }
        let offerData: any;
        try {
          const respText = await offerResp.text();
          offerData = JSON.parse(respText);
        } catch (e) {
          throw new Error(`Failed to parse offer creation response: ${e}`);
        }
        const offerId = offerData.offerId as string;

        // Step 4: Publish offer
        const publishResp = await fetchWithTimeout(
          `${apiBase}/sell/inventory/v1/offer/${offerId}/publish`,
          { method: "POST", headers: authHeaders, timeout: 15000 },
        );

        let listingId: string | undefined;
        if (publishResp.ok) {
          let publishData: any;
          try {
            const respText = await publishResp.text();
            publishData = JSON.parse(respText);
          } catch (e) {
            console.warn(
              `Row ${row.rowIndex}: Failed to parse publish response: ${e}`,
            );
            publishData = {};
          }
          listingId = publishData.listingId;
        } else {
          const errText = await publishResp.text();
          console.warn(
            `Row ${row.rowIndex}: publish failed: ${publishResp.status} - ${errText.slice(0, 200)}`,
          );
          // Offer created but not live — still record partial success
        }

        // Step 5: Save to drafts table as published
        try {
          await svc.from("drafts").insert({
            id: crypto.randomUUID(),
            user_id: userId,
            title: row.title,
            description: row.description || "",
            price_min: row.price,
            price_max: row.price,
            listing_price: row.price,
            listing_format: row.format,
            ebay_category_id: row.categoryId,
            item_specifics: row.itemSpecifics || {},
            condition: conditionEnum,
            consignor: row.consignor || "",
            fulfillment_policy_id: fulfillmentPolicyId || null,
            payment_policy_id: row.paymentPolicyId || null,
            return_policy_id: returnPolicyId || null,
            publish_status: listingId ? "published" : "publishing",
            published_at: listingId ? new Date().toISOString() : null,
            ebay_sku: sku,
            ebay_offer_id: offerId,
            ebay_listing_id: listingId || null,
            metal_type: "none",
            metal_weight_oz: 0,
          });
        } catch (dbErr) {
          console.warn(
            `Row ${row.rowIndex}: DB save failed (non-fatal):`,
            dbErr,
          );
        }

        results.push({
          rowIndex: row.rowIndex,
          success: true,
          listingId,
          offerId,
          sku,
        });

        // Small delay between rows to avoid eBay rate limits
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        console.error(`Row ${row.rowIndex} publish error:`, err.message);
        results.push({
          rowIndex: row.rowIndex,
          success: false,
          error: err.message || "Unknown error",
        });
      }
    }

    const published = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ published, failed, total: rows.length, results }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("bulk-publish error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
