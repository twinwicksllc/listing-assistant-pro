import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { initSentry, captureException } from "../_helpers/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// Table initialization deferred - will be created by category-lookup on first use
async function ensureTableExists() {
  // No-op for now - category-lookup will initialize the table
  return;
}

function parseImageDataUrl(dataUrl: string) {
  const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  return { base64Data, mimeType };
}

function computeNextResetAt(resetDay: number | null): string | null {
  if (!resetDay) return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(resetDay, daysInThisMonth);
  const thisMonthDate = new Date(year, month, clampedDay);

  if (thisMonthDate > now) return thisMonthDate.toISOString();

  const nextMonth = month + 1;
  const nextYear = nextMonth > 11 ? year + 1 : year;
  const nm = nextMonth % 12;
  const daysInNextMonth = new Date(nextYear, nm + 1, 0).getDate();
  return new Date(nextYear, nm, Math.min(resetDay, daysInNextMonth)).toISOString();
}

serve(async (req: Request) => {
  initSentry();
  
  // IMPORTANT: Handle OPTIONS preflight first, before anything else
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    console.log("analyze-item: parsing body...");
    // Initialize table in background (non-blocking)
    ensureTableExists().catch((e) => console.warn("Table init error:", e));
    // Parse body first (can only call req.json() once)
    const body = await req.json();
    console.log("analyze-item: body parsed, images count =", body.images?.length);

    // --- Server-side usage limit enforcement ---
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    console.log("analyze-item: authHeader present =", !!authHeader);
    let userId: string | null = null;
    let userEmail: string | null = null;

    if (authHeader) {
      console.log("analyze-item: getting user from auth header...");
      const { data: ud } = await svc.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = ud?.user?.id || null;
      userEmail = ud?.user?.email || null;
      console.log("analyze-item: got user, email =", userEmail);
    } else {
      console.warn("analyze-item: NO Authorization header found!");
      console.warn("analyze-item: available headers:", Array.from(req.headers.keys()));
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin emails always get unlimited access
    const ADMIN_EMAILS = ["twinwicksllc@gmail.com"];
    const isAdmin = userEmail ? ADMIN_EMAILS.includes(userEmail) : false;
    console.log("analyze-item: user email =", userEmail, "isAdmin =", isAdmin);

    // --- eBay Account Gate for Free Users (OQ-1: require eBay for Starter) ---
    // Check subscription status via Stripe to determine tier (skip for admins)
    let tier: "starter" | "pro" | "unlimited" = isAdmin ? "unlimited" : "starter";
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!isAdmin && STRIPE_SECRET_KEY && userEmail) {
      try {
        const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
        const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
        const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (customers.data.length > 0) {
          const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
          if (subs.data.length > 0) {
            const productId = subs.data[0].items.data[0].price.product;
            if (productId === "prod_U70aT1KvuI2uDx") {
              tier = "unlimited";
            } else if (productId === "prod_U6zUiC1SYuPrGU") {
              tier = "pro";
            }
          }
        }
      } catch (stripeErr) {
        console.error("Stripe check failed, defaulting to free tier:", stripeErr);
      }
    }

    // eBay account gate for Starter users
    if (tier === "starter") {
      const { data: profile } = await svc
        .from("profiles")
        .select("ebay_access_token")
        .eq("id", userId)
        .single();

      if (!profile?.ebay_access_token) {
        return new Response(
          JSON.stringify({
            error: "ebay_account_required",
            message: "Connect an eBay account to start generating listings.",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // --- Per-Org Rolling-Window Quota (OQ-4, OQ-2: anchor at account creation) ---
    let orgId: string | null = null;
    let orgResetDay: number | null = null;
    let currentUsageCount = 0;

    if (tier === "starter") {
      const { data: orgMember } = await svc
        .from("org_members")
        .select("org_id, organizations(free_tier_reset_day)")
        .eq("user_id", userId)
        .limit(1);

      if (orgMember && orgMember.length > 0) {
        orgId = orgMember[0].org_id;
        orgResetDay = (orgMember[0].organizations as any)?.free_tier_reset_day ?? null;
      }
    }

    // Compute rolling-window start for Starter; calendar month for Pro/Unlimited
    let windowStart: string;
    if (tier === "starter") {
      if (orgResetDay) {
        const { data: wsData, error: wsErr } = await svc
          .rpc("get_free_tier_window_start", { p_reset_day: orgResetDay });
        windowStart = wsData ? new Date(wsData).toISOString() : new Date().toISOString();
      } else {
        // Fresh start for NULL reset_day (existing users pre-migration)
        windowStart = new Date().toISOString();
      }
    } else {
      // Pro/Unlimited: calendar month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      windowStart = startOfMonth.toISOString();
    }

    // Count per-org usage for Starter; per-user for Pro/Unlimited
    if (tier !== "unlimited") {
      let countQuery = svc
        .from("usage_tracking")
        .select("*", { count: "exact", head: true })
        .eq("action_type", "ai_analysis")
        .gte("created_at", windowStart);

      if (tier === "starter" && orgId) {
        countQuery = countQuery.eq("org_id", orgId);
      } else if (tier === "pro") {
        countQuery = countQuery.eq("user_id", userId);
      }

      const { count, error: countErr } = await countQuery;

      const ANALYSIS_LIMIT = tier === "pro" ? 50 : 6; // OQ-10: 6 not 5
      currentUsageCount = count ?? 0;

      if (countErr) {
        console.error("Usage count query failed:", countErr);
      } else if (currentUsageCount >= ANALYSIS_LIMIT) {
        const upgradeMsg = tier === "pro"
          ? `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Unlimited for no limits.`
          : `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Pro or Unlimited for more.`;
        const resetAt = tier === "starter" ? computeNextResetAt(orgResetDay) : null;
        return new Response(
          JSON.stringify({
            error: upgradeMsg,
            creditsUsed: currentUsageCount,
            creditsRemaining: 0,
            creditsResetAt: resetAt,
            tier,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // --- End usage limit enforcement ---

    // --- Fetch live spot prices from shared DB cache ---
    let spotGold = 5200, spotSilver = 89, spotPlatinum = 2200;
    try {
      const { data: spotData, error: spotErr } = await svc
        .from("spot_price_cache")
        .select("gold, silver, platinum, fetched_at")
        .eq("id", 1)
        .single();

      if (!spotErr && spotData) {
        const ageMinutes = (Date.now() - new Date(spotData.fetched_at).getTime()) / 60000;
        if (ageMinutes < 720) {
          // Use DB cache if less than 12 hours old (spot-prices function refreshes every 12 hours)
          spotGold = Number(spotData.gold) || spotGold;
          spotSilver = Number(spotData.silver) || spotSilver;
          spotPlatinum = Number(spotData.platinum) || spotPlatinum;
        } else {
          // Cache is stale — trigger a refresh via spot-prices function
          const spotResp = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/spot-prices`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            }
          );
          if (spotResp.ok) {
            const spotJson = await spotResp.json();
            spotGold = spotJson.spotPrices?.gold || spotGold;
            spotSilver = spotJson.spotPrices?.silver || spotSilver;
            spotPlatinum = spotJson.spotPrices?.platinum || spotPlatinum;
          }
        }
      }
    } catch (spotFetchErr) {
      console.warn("Spot price fetch failed, using fallback:", spotFetchErr);
    }
    // --- End spot prices ---

    // Support both single image (legacy) and multiple images
    const imageList: string[] = body.images ?? (body.imageBase64 ? [body.imageBase64] : []);
    const voiceNote: string = body.voiceNote || "";

    // Initialize competitorData early (will be populated after AI analysis)
    let competitorData: any = null;

    if (imageList.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    // ─── PASS 1: Fast item identification ────────────────────────────────────
    // Sends ≤2 images to determine domain, item name, and keywords.
    // Results are used to improve the pre-lookup query and route to the correct
    // domain-specific prompt for Pass 2.
    type Domain = "coins_bullion" | "trading_cards" | "jewelry" | "electronics" | "vintage_clothing" | "general";
    interface Identification {
      domain: Domain;
      itemName: string;
      keywords: string[];
      isMetal: boolean;
      metalType: "gold" | "silver" | "platinum" | "none";
    }
    let identification: Identification = {
      domain: "general",
      itemName: "item",
      keywords: [],
      isMetal: false,
      metalType: "none",
    };
    try {
      const pass1Images = imageList.slice(0, 2).map((img) => {
        const { base64Data, mimeType } = parseImageDataUrl(img);
        return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } };
      });
      const pass1VoiceHint = voiceNote ? `\nSeller note: "${voiceNote.slice(0, 200)}"` : "";
      const pass1Resp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemini-2.0-flash",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You are an item identification assistant. Examine the image(s) and return ONLY valid JSON:\n{"domain":"coins_bullion|trading_cards|jewelry|electronics|vintage_clothing|general","itemName":"short name (max 80 chars)","keywords":["kw1","kw2","kw3","kw4","kw5"],"isMetal":true|false,"metalType":"gold|silver|platinum|none"}\nDomain guide: coins_bullion=coins/currency/bullion; trading_cards=sports/TCG/Pokémon/Magic; jewelry=rings/watches/necklaces; electronics=phones/PCs/consoles/cameras; vintage_clothing=clothing/shoes/accessories; general=anything else.`,
              },
              {
                role: "user",
                content: [...pass1Images, { type: "text", text: `Identify this item.${pass1VoiceHint}` }],
              },
            ],
            max_tokens: 200,
          }),
        }
      );
      if (pass1Resp.ok) {
        const pass1Data = await pass1Resp.json();
        const pass1Text = pass1Data.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(pass1Text);
        if (parsed.domain && parsed.itemName) {
          identification = {
            domain: parsed.domain as Domain,
            itemName: String(parsed.itemName).slice(0, 120),
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 7).map(String) : [],
            isMetal: Boolean(parsed.isMetal),
            metalType: (parsed.metalType ?? "none") as Identification["metalType"],
          };
          console.log("analyze-item: Pass 1 identification:", identification);
        }
      }
    } catch (pass1Err) {
      console.warn("analyze-item: Pass 1 failed, defaulting to general domain:", pass1Err);
    }
    // ─── END PASS 1 ──────────────────────────────────────────────────────────

    // ── Pre-lookup: Deterministic category resolution ──────────────────────────
    // Uses category-lookup "lookup" action which implements:
    //   - 4-tier ranked candidates (DB exact → eBay API → DB fuzzy → Gemini)
    //   - Deterministic lock when eBay top-1 is high confidence (#3)
    //   - Only approved rows from DB (#2)
    //   - Leaf/active verification (#4)
    //   - Audit logging (#0)
    //
    // If a deterministic winner is found, it's locked into the prompt so Gemini
    // cannot override it. Otherwise, hints are provided for Gemini to choose from.
    let categoryHints = "";
    let lockedCategoryId: string | null = null;
    let lockedCategoryName: string | null = null;
    let lockedBreadcrumb: string | null = null;
    let lookupAlternatives: any[] = [];

    try {
      // Use Pass 1 item name + keywords for a much better category query than raw voice note
      const pass1Query = identification.keywords.length > 0
        ? `${identification.itemName} ${identification.keywords.slice(0, 3).join(" ")}`
        : identification.itemName;
      const searchQuery = (pass1Query !== "item" ? pass1Query : voiceNote) || "";
      if (searchQuery.trim().length > 2) {
        const _lookupUrl = Deno.env.get("SUPABASE_URL");
        const _lookupKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_lookupUrl && _lookupKey) {
          const lookupResp = await fetch(
            `${_lookupUrl}/functions/v1/category-lookup`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${_lookupKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ action: "lookup", itemType: searchQuery }),
            }
          );
          if (lookupResp.ok) {
            const lookupData = await lookupResp.json();

            if (lookupData.found) {
              const score = lookupData.effectiveScore || lookupData.confidence || 0;
              const isVerifiedLeaf = lookupData.verifiedLeaf !== false;
              const source = lookupData.source || "";

              // Deterministic lock: high-confidence verified result (#3)
              // Lock if: score >= 88 AND (source is eBay API or user-verified DB exact)
              const isLockable = score >= 88 && isVerifiedLeaf &&
                (source === "ebay_api" || source.includes("user_verified") || source.includes("db_exact"));

              if (isLockable) {
                lockedCategoryId = lookupData.categoryId;
                lockedCategoryName = lookupData.categoryName || "";
                lockedBreadcrumb = lookupData.breadcrumb || lookupData.categoryName || "";
                categoryHints += `\n- **LOCKED CATEGORY** (verified, high-confidence): **${lockedCategoryId}** — ${lockedBreadcrumb}. YOU MUST USE THIS CATEGORY ID. Do not override.`;
                console.log(`analyze-item: DETERMINISTIC LOCK on category ${lockedCategoryId} (score=${score}, source=${source})`);
              } else {
                // Not locked — provide as strong hint
                categoryHints += `\n- BEST MATCH (score=${score}, source=${source}): **${lookupData.categoryId}** — ${lookupData.breadcrumb || lookupData.categoryName}. Use this as primary category unless the item clearly belongs elsewhere.`;
              }

              // Collect alternatives for fallback
              if (lookupData.alternatives && lookupData.alternatives.length > 0) {
                lookupAlternatives = lookupData.alternatives;
                categoryHints += "\n- ALTERNATIVE CATEGORIES:";
                for (const alt of lookupData.alternatives.slice(0, 3)) {
                  categoryHints += `\n  * **${alt.categoryId}** — ${alt.breadcrumb || alt.categoryName} (score=${alt.score || "?"})`;
                }
              }
            } else if (lookupData.topCandidates && lookupData.topCandidates.length > 0) {
              // Circuit breaker fired — no candidate passed threshold (#9)
              categoryHints += "\n- LOW-CONFIDENCE CANDIDATES (use your best judgment):";
              for (const c of lookupData.topCandidates) {
                categoryHints += `\n  * **${c.categoryId}** — ${c.breadcrumb || c.categoryName} (score=${c.score || "?"})`;
              }
              lookupAlternatives = lookupData.topCandidates;
            }
          }
        }
      }
    } catch (lookupErr) {
      console.warn("analyze-item: category pre-lookup failed (non-blocking):", lookupErr);
    }
    // ── End pre-lookup ─────────────────────────────────────────────────────────

    // ─── Pre-AI sold comps (so AI has real pricing context in Pass 2) ────────
    {
      const compQuery = identification.keywords.slice(0, 5).join(" ") || identification.itemName;
      if (compQuery && compQuery !== "item" && userId) {
        try {
          const compResp = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-competitor-search`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ userId, title: compQuery, yourPrice: 0 }),
            }
          );
          if (compResp.ok) {
            const compData = await compResp.json();
            if ((compData.competitorCount ?? 0) > 0) {
              competitorData = compData;
              console.log("analyze-item: pre-AI comps:", { count: compData.competitorCount, avg: compData.avgPrice });
            }
          }
        } catch (preCompErr) {
          console.warn("analyze-item: pre-AI comp fetch failed (non-blocking):", preCompErr);
        }
      }
    }
    // ─── END pre-AI sold comps ────────────────────────────────────────────────

    // ─── Build domain-specific system prompt ─────────────────────────────────
    let systemPrompt: string;
    try {
      const { buildSystemPrompt } = await import("../_helpers/domainPrompts.ts");
      systemPrompt = buildSystemPrompt(identification.domain, {
        itemName: identification.itemName,
        imageCount: imageList.length,
        voiceNote: voiceNote || undefined,
        suggestedCategoryId: lockedCategoryId ?? undefined,
        suggestedCategoryName: lockedCategoryName ?? undefined,
        spotPrices: identification.isMetal
          ? { gold: spotGold, silver: spotSilver, platinum: spotPlatinum }
          : undefined,
        metalType: identification.metalType,
        competitorData:
          competitorData && (competitorData.competitorCount ?? 0) > 0 ? competitorData : null,
      });
      // Inject category hints from pre-lookup into the prompt
      if (categoryHints) {
        systemPrompt += `\n\n### CATEGORY SELECTION HINTS (from deterministic pre-lookup)\n${categoryHints}`;
      }
    } catch (promptErr) {
      console.error("analyze-item: failed to load domain prompts, using fallback:", promptErr);
      systemPrompt = `You are a professional eBay listing expert. Analyze the provided photo(s) and generate a complete, accurate listing via the create_listing tool. Title ≤ 80 chars. Condition must be one of: NEW, USED_EXCELLENT, USED_VERY_GOOD, USED_GOOD, USED_ACCEPTABLE, FOR_PARTS_OR_NOT_WORKING.`;
    }
    // DUMMY_PLACEHOLDER — remove this line (keeps template literal parser happy)
    const _promoteSystemPrompt = `You are a professional eBay Listing Expert and item identifier. Your task is to analyze item photos and generate a complete listing via the \`create_listing\` tool.

### WHAT YOU SELL
You handle ALL types of items: coins, bullion, precious metals, collectibles, toys, plushies, stuffed animals, trading cards, sports memorabilia, Funko Pops, action figures, LEGO, jewelry, electronics, clothing, books, tools, art, and anything else. Always identify the item TYPE first, then apply the appropriate eBay category.

### CORE OPERATING RULES
1. HOLISTIC ANALYSIS: Treat all uploaded images as a single item.
2. ZERO SPECULATION: Use ONLY visible evidence + factual data. If details are not visible, state "uncertain" or "not visible."
3. NO NUMERICAL GRADING for coins unless in a certified slab (PCGS, NGC, ANACS, ICG, CAC, ICCS).
4. EBAY COMPLIANCE: Title must be \u2264 80 chars. No hype words like "L@@K."
5. SELLER VOICE NOTE: If provided, treat as authoritative \u2014 override visual assessment where applicable.

### CATEGORY SELECTION
You MUST select the correct eBay **leaf** category ID for every item.

**CRITICAL: If a LOCKED CATEGORY is specified below, you MUST use that exact category ID. Do NOT override it.**

Use these resources in order:
1. **LOCKED CATEGORY** (below): If present, use this category ID unconditionally. It has been verified as a leaf category from eBay's official taxonomy.
2. **BEST MATCH / SUGGESTIONS** (below): If no lock, use the highest-scored suggestion as your primary category.
3. **Your knowledge + the category IDs in the tool schema**: Use when no suggestions are available.
${categoryHints}

**CRITICAL RULES FOR SPECIFIC CATEGORIES:**
- Sports Trading Cards: ALWAYS include **Sport** in itemSpecifics (Baseball/Basketball/Football/Hockey/Soccer). eBay WILL REJECT the listing without it.
- Coins: Include Certification, Year, Denomination, Mint Location, Composition, Fineness where applicable.
- Bullion: Include Shape, Precious Metal Content per Unit, Brand/Mint, Fineness.

**ALWAYS provide 1-2 alternative category IDs** (alternativeCategoryIds) for fallback options.

**CRITICAL: NEVER use parent/broad category IDs.** Always drill down to the most specific LEAF category. Examples of PARENT categories you must NEVER use:
- 253 (Coins: US) — use specific subcategory like 39464 (Morgan Dollars), 41109 (Proof Sets), etc.
- 11118 (Half Dollars) — use 41102 (Kennedy), 11973 (Franklin), 41099 (Walking Liberty), etc.
- 64482 (Sports Trading Cards) — use 213 (Baseball Cards), 261328 (Basketball Cards), etc.
- 1 (Collectibles) — use specific subcategory like 19203 (Beanie Babies), 237 (Decorative), etc.

### IDENTIFICATION & DESCRIPTION
- Identify: Item type, brand/maker, year (if applicable), condition, materials, notable features.
- For coins: Year, Series, Denomination, Mint Mark, Metal, Weight (Troy Oz), Producer.
- Key items: Highlight rarity, limited editions, special variants.
- Condition Mapping:
  - Mint/New in box -> NEW
  - Excellent, like new -> USED_EXCELLENT
  - Good, light wear -> USED_VERY_GOOD
  - Noticeable wear, functional -> USED_GOOD
  - Heavy wear, still functional -> USED_ACCEPTABLE
  - Damaged/non-functional -> FOR_PARTS_OR_NOT_WORKING

### PRICING LOGIC
- Research recent sold comps on eBay for this item type.
- For precious metals: Floor = (Melt Value * 1.19) to cover eBay fees (~16%).
- For collectibles/toys: Use market demand, rarity, and condition.
- metalWeightOz: Express in TROY OUNCES only (for precious metals).
- Current spot prices: Gold $${spotGold.toFixed(2)}/oz | Silver $${spotSilver.toFixed(2)}/oz | Platinum $${spotPlatinum.toFixed(2)}/oz
${competitorData && !competitorData.error
  ? `- MARKET DATA (${competitorData.competitorCount || 0} similar sold): avg $${(competitorData.avgPrice || 0).toFixed(2)}, range $${(competitorData.minPrice || 0).toFixed(2)}-$${(competitorData.maxPrice || 0).toFixed(2)}, median $${(competitorData.medianPrice || 0).toFixed(2)}. USE AS PRIMARY PRICING REFERENCE.`
  : `- No recent sold comps available. Use category knowledge and condition to price appropriately.`}

Use the \`create_listing\` tool to return the final structured data.`;
    // The _promoteSystemPrompt above is the fallback template — actual systemPrompt is built above.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void _promoteSystemPrompt;

    // Build content array with all images + text prompt
    const contentParts: any[] = imageList.map((img) => {
      const { base64Data, mimeType } = parseImageDataUrl(img);
      return {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      };
    });

    let userText = `I've provided ${imageList.length} photo${imageList.length > 1 ? "s" : ""} of: ${identification.itemName}. Analyze all photos together, apply your ${identification.domain.replace("_", " ")} expertise, and produce a complete eBay listing via the create_listing tool — accurate title, full description, correct category ID, all relevant item specifics, condition, and a fair asking price.`;

    if (voiceNote) {
      userText += `\n\nSELLER'S VOICE NOTE (treat as authoritative — override visual assessment where applicable):
The seller recorded the following about this item. Follow these rules:
- If the seller mentions specific flaws NOT visible in photos: include them in description and adjust grade/condition downward accordingly.
- If the seller mentions cleaning, damage, repairs, or alterations: disclose in description and lower condition.
- If the seller mentions provenance, purchase history, or authentication details: include in description.
- If the seller mentions packaging, accessories, certificates, or extras: note them in description.
- If the seller's assessment contradicts your visual grade (e.g., they say "heavily worn" but photos look better): trust the seller.

Seller's note: "${voiceNote}"`;
    }

    contentParts.push({
      type: "text",
      text: userText,
    });

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: contentParts },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_listing",
                description: "Generates a structured eBay listing payload for coins and collectibles.",
                parameters: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "SEO-optimized eBay title, max 80 chars. Format: [Year] [Country] [Denomination] [Series/Design] [Metal] [Weight] [Condition/Grade]",
                    },
                    categoryId: {
                      type: "string",
                      description: "eBay leaf category ID. ALL IDs below are VERIFIED LEAF categories. COINS: Morgan Dollars=39464, Peace Dollars=11980, Eisenhower Dollars=11981, Kennedy Half=41102, Franklin Half=11973, Walking Liberty Half=41099, Barber Half=11971, Wheat Penny=39455, US Proof Sets=41109, US Mint Sets=526, Ancient Coins=532, Medieval Coins=173685. BULLION: Gold Bars/Rounds=178906, Silver Bars/Rounds=39489, Gold Coins (bullion)=177652, Silver Coins (bullion)=177653, Copper/Other Bullion=166679, Other Silver Bullion=3361. TRADING CARDS: Sports Card Singles=261328, Sports Card Lots=261329, Sports Card Sets=261330, Sealed Card Packs=261331, Sealed Card Boxes=261332, CCG Individual Cards (Pokemon/MTG/Yu-Gi-Oh)=183454, Non-Sport Card Singles=183050. TOYS: LEGO Complete Sets=19006, Action Figures=261068, Beanie Babies Retired=440, Jellycat=158786, Other Stuffed Animals=230, Jigsaw Puzzles=19183, Diecast Cars=180506, Board Games=180349, Collectible Figures/Bobbleheads=149372. ELECTRONICS: Smartphones=9355, Headphones=112529. JEWELRY: Wristwatches=31387. For items not listed above, describe the item clearly and the system will find the correct leaf category via eBay's API. NEVER use broad parent IDs like 253, 11118, 213, 246, 182, 1, 550, or 64482.",
                    },
                    alternativeCategoryIds: {
                      type: "array",
                      description: "Up to 2 alternative eBay category IDs that would also be appropriate. Provide different but valid categories.",
                      items: { type: "string" },
                      maxItems: 2,
                    },
                    condition: {
                      type: "string",
                      enum: ["NEW", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"],
                    },
                    description: { type: "string" },
                    price: {
                      type: "object",
                      properties: {
                        amount: { type: "number" },
                        currency: { type: "string", default: "USD" },
                      },
                      required: ["amount"],
                    },
                    itemSpecifics: {
                      type: "object",
                      properties: {
                        Certification: { type: "string", enum: ["Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"] },
                        Grade: { type: "string", description: "Only if NOT Uncertified. Format: 'MS 65'" },
                        Year: { type: "string" },
                        "Mint Location": { type: "string" },
                        Denomination: { type: "string" },
                        Composition: { type: "string", enum: ["Gold", "Silver", "Platinum", "Palladium", "Copper", "Nickel", "Steel", "Zinc", "Brass", "Aluminum", "Bimetallic", "Copper-Nickel", "Bronze"] },
                        Fineness: { type: "string" },
                        "Strike Type": { type: "string", enum: ["Business", "Proof", "Proof-Like", "Satin"] },
                        Variety: { type: "string", description: "VAM number (e.g., 'VAM-1A')" },
                        "Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated", "Unknown"] },
                        "Mint Mark": { type: "string" },
                        "Brand/Mint": { type: "string" },
                        "Country of Origin": { type: "string" },
                        "Materials sourced from": { type: "string" },
                        "Precious Metal Content per Unit": { type: "string" },
                        // Trading card / collectible fields
                        "Sport": { type: "string", description: "REQUIRED for sports cards (213, 261328, 64482). E.g. Baseball, Basketball, Football, Hockey, Soccer" },
                        "Player/Athlete": { type: "string", description: "Player name for sports cards" },
                        "Card Manufacturer": { type: "string", description: "E.g. Donruss, Topps, Upper Deck, Fleer, Bowman" },
                        "Season": { type: "string", description: "Season year for sports cards" },
                        "Team": { type: "string", description: "Team name for sports cards" },
                        "Features": { type: "string", description: "E.g. Rookie, Autograph, Parallel, Refractor, Hologram" },
                        "Card Name": { type: "string", description: "Card name for Pokémon/MTG/non-sport cards" },
                        "Set": { type: "string", description: "Card set name for trading cards" },
                        // Collectible/toy fields
                        "Character": { type: "string", description: "Character name for Funko Pop, Beanie Babies, action figures" },
                        "Brand": { type: "string", description: "Brand name for collectibles (e.g. Ty, Funko, LEGO)" },
                        "Franchise": { type: "string", description: "Franchise/series for Funko Pop, action figures" },
                        "Animal": { type: "string", description: "Animal type for Beanie Babies, stuffed animals" },
                        "Material": { type: "string", description: "Material for jewelry, toys (e.g. Gold, Silver, Plush)" },
                      },
                      required: ["Certification", "Year", "Composition"],
                      additionalProperties: true,
                    },
                    pricingNotes: { type: "string" },
                    isSlabbed: { type: "boolean" },
                    metalType: { type: "string", enum: ["gold", "silver", "platinum", "none"] },
                    metalWeightOz: { type: "number" },
                  },
                  required: ["title", "categoryId", "condition", "description", "price", "itemSpecifics", "isSlabbed"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "create_listing" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const usage = data.usage;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    // Log Gemini token usage (reuse svc and userId from above)
    try {
      await svc.from("gemini_usage").insert({
        user_id: userId,
        function_name: "analyze-item",
        model: "gemini-2.0-flash",
        prompt_tokens: usage?.prompt_tokens || 0,
        completion_tokens: usage?.completion_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
      });
    } catch (logErr) {
      console.error("Failed to log gemini usage:", logErr);
    }

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured listing data");
    }

    const listing = JSON.parse(toolCall.function.arguments);

    // Normalize new schema field names to legacy equivalents for frontend compatibility
    if (listing.categoryId && !listing.ebayCategoryId) {
      listing.ebayCategoryId = listing.categoryId;
    }
    if (listing.price?.amount !== undefined && listing.priceMin === undefined) {
      listing.priceMin = listing.price.amount;
      listing.priceMax = listing.price.amount;
    }

    if (listing.title && listing.title.length > 80) {
      // Truncate at last complete word within 80 chars to avoid cutting mid-word
      listing.title = listing.title.substring(0, 80).replace(/\s+\S*$/, "").trim();
    }

    // --- Build suggestedCategories (dedupe, backfill names via exact DB lookup) ---
    try {
      const { buildSuggestedCategories } = await import("../_helpers/suggestedCategories.ts");
      listing.suggestedCategories = await buildSuggestedCategories(listing, svc);
    } catch (suggestErr) {
      console.warn("Failed to build suggestedCategories:", suggestErr);
      // keep whatever AI returned
    }
    // --- end suggestedCategories processing ---


    // --- Early leaf/active validation (#4) ---
    // If the AI returned a category, verify it's a valid leaf before proceeding.
    // If invalid, try to reselect from alternatives or lookup suggestions.
    try {
      if (listing.ebayCategoryId) {
        // If we had a deterministic lock, the category is already verified
        if (lockedCategoryId && listing.ebayCategoryId !== lockedCategoryId) {
          // AI overrode the locked category — force it back (#3)
          console.warn(`analyze-item: AI overrode locked category ${lockedCategoryId} with ${listing.ebayCategoryId} — forcing lock back`);
          listing.ebayCategoryId = lockedCategoryId;
          listing.categoryId = lockedCategoryId;
        } else if (!lockedCategoryId) {
          // No lock — verify the AI's choice via category-lookup
          const _verifyUrl = Deno.env.get("SUPABASE_URL");
          const _verifyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (_verifyUrl && _verifyKey) {
            const verifyResp = await fetch(
              `${_verifyUrl}/functions/v1/category-lookup`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${_verifyKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ action: "verify", categoryId: listing.ebayCategoryId }),
              }
            );
            if (verifyResp.ok) {
              const verifyData = await verifyResp.json();
              if (verifyData.isLeaf === false || verifyData.valid === false) {
                console.warn(`analyze-item: AI category ${listing.ebayCategoryId} is NOT a valid leaf — attempting reselect`);
                
                // Try alternatives from lookup
                let reselected = false;
                if (lookupAlternatives && lookupAlternatives.length > 0) {
                  for (const alt of lookupAlternatives) {
                    if (alt.categoryId !== listing.ebayCategoryId) {
                      console.log(`analyze-item: reselecting to alternative ${alt.categoryId} (${alt.categoryName || alt.breadcrumb})`);
                      listing.ebayCategoryId = alt.categoryId;
                      listing.categoryId = alt.categoryId;
                      reselected = true;
                      break;
                    }
                  }
                }
                
                // Try suggestedCategories if no alternative worked
                if (!reselected && listing.suggestedCategories?.length > 1) {
                  const fallback = listing.suggestedCategories[1];
                  if (fallback?.categoryId) {
                    console.log(`analyze-item: reselecting to suggested category ${fallback.categoryId}`);
                    listing.ebayCategoryId = fallback.categoryId;
                    listing.categoryId = fallback.categoryId;
                  }
                }
              }
            }
          }
        }
      }
    } catch (validationErr) {
      console.warn("analyze-item: leaf validation failed (non-blocking):", validationErr);
    }
    // --- end leaf validation ---

    // --- Post-lookup: category verification using AI-generated title ---
    // RC-1 FIX: The pre-lookup only runs with voice notes. When no voice note is
    // provided, Gemini picks categories blindly from its tool description. This
    // post-lookup uses the AI-generated title (which is a reliable item description)
    // to run category-lookup's 4-tier system and override if we find a verified
    // leaf category with high confidence.
    try {
      if (!lockedCategoryId && listing.title) {
        const _postLookupUrl = Deno.env.get("SUPABASE_URL");
        const _postLookupKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_postLookupUrl && _postLookupKey) {
          const postLookupResp = await fetch(
            `${_postLookupUrl}/functions/v1/category-lookup`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${_postLookupKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ action: "lookup", itemType: listing.title }),
            }
          );
          if (postLookupResp.ok) {
            const postLookupData = await postLookupResp.json();
            if (postLookupData.found && postLookupData.verifiedLeaf !== false) {
              const postScore = postLookupData.effectiveScore || postLookupData.confidence || 0;
              const postSource = postLookupData.source || "";
              const postIsLeaf = postLookupData.verifiedLeaf === true;

              // Override AI's category if:
              // 1. The post-lookup found a verified leaf with high confidence, OR
              // 2. The AI's current category is a known non-leaf parent
              const KNOWN_PARENT_CATEGORIES = new Set(["253", "11118", "11233", "261076", "261074", "261075", "293", "1", "550", "631", "20713", "11450", "64482", "220"]);
              const aiCategoryIsParent = KNOWN_PARENT_CATEGORIES.has(listing.ebayCategoryId);
              const postLookupIsStrong = postScore >= 80 && postIsLeaf;

              if (aiCategoryIsParent || postLookupIsStrong) {
                console.log(
                  `analyze-item: POST-LOOKUP override: AI picked ${listing.ebayCategoryId}, ` +
                  `post-lookup found ${postLookupData.categoryId} (${postLookupData.categoryName}, ` +
                  `score=${postScore}, source=${postSource}, leaf=${postIsLeaf}, aiWasParent=${aiCategoryIsParent})`
                );
                listing.ebayCategoryId = postLookupData.categoryId;
                listing.categoryId = postLookupData.categoryId;

                // Update suggestedCategories to put post-lookup winner first
                if (listing.suggestedCategories) {
                  listing.suggestedCategories.unshift({
                    categoryId: postLookupData.categoryId,
                    categoryName: postLookupData.categoryName,
                    breadcrumb: postLookupData.breadcrumb || postLookupData.categoryName,
                    reason: `Post-lookup verified (score=${postScore}, source=${postSource})`,
                  });
                  // Dedupe
                  const seenIds = new Set<string>();
                  listing.suggestedCategories = listing.suggestedCategories.filter((s: any) => {
                    if (seenIds.has(s.categoryId)) return false;
                    seenIds.add(s.categoryId);
                    return true;
                  }).slice(0, 3);
                }

                // Also update alternatives for any future reselection
                if (postLookupData.alternatives && postLookupData.alternatives.length > 0) {
                  lookupAlternatives = postLookupData.alternatives;
                }
              }
            }
          }
        }
      }
    } catch (postLookupErr) {
      console.warn("analyze-item: category post-lookup failed (non-blocking):", postLookupErr);
    }
    // --- end post-lookup ---

    // --- Auto-persist new category to DB via category-lookup (gated) (#2) ---
    // Uses category-lookup "store" action which enforces:
    //   - Minimum confidence threshold (85)
    //   - Leaf + active verification
    //   - Status = quarantine (promoted to approved after publish success)
    try {
      if (listing.ebayCategoryId && userId) {
        const titleWords = (listing.title || "").toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w: string) => w.length > 3)
          .slice(0, 4)
          .join(" ");

        if (titleWords) {
          // Check if this category+title combo is already in the DB
          const { data: existingCat } = await svc
            .from("category_mappings")
            .select("id")
            .eq("ebay_category_id", listing.ebayCategoryId)
            .eq("status", "approved")
            .ilike("item_type", `%${titleWords.split(" ")[0]}%`)
            .maybeSingle();

          if (!existingCat) {
            const catName = listing.suggestedCategories?.[0]?.categoryName
              || listing.suggestedCategories?.[0]?.breadcrumb?.split(" > ").pop()
              || null;
            const catBreadcrumb = listing.suggestedCategories?.[0]?.breadcrumb || null;

            // Use category-lookup store action (applies leaf/active gates + quarantine)
            const _storeUrl = Deno.env.get("SUPABASE_URL");
            const _storeKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (_storeUrl && _storeKey) {
              await fetch(
                `${_storeUrl}/functions/v1/category-lookup`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${_storeKey}`,
                  },
                  body: JSON.stringify({
                    action: "store",
                    itemType: titleWords,
                    categoryId: listing.ebayCategoryId,
                    categoryName: catName,
                    breadcrumb: catBreadcrumb,
                    verificationSource: "ai_auto",
                  }),
                }
              );
              console.log(`analyze-item: submitted category ${listing.ebayCategoryId} for "${titleWords}" to category-lookup store (gated)`);
            }
          }
        }
      }
    } catch (persistErr) {
      console.warn("analyze-item: category auto-persist failed (non-blocking):", persistErr);
    }
    // --- end auto-persist ---

    // --- Fetch competitor prices now that AI has generated the title ---
    if (listing.title && userId) {
      try {
        console.log("analyze-item: fetching competitor prices with AI-generated title...", { title: listing.title });
        const competitorUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-competitor-search`;
        
        const competitorResp = await fetch(
          competitorUrl,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId,
              title: listing.title,
              yourPrice: listing.priceMin || listing.price?.amount || 0,
            }),
          }
        );

        console.log("analyze-item: competitor response status:", competitorResp.status);
        
        if (competitorResp.ok) {
          competitorData = await competitorResp.json();
          console.log("analyze-item: competitor data retrieved", {
            competitorCount: competitorData?.competitorCount,
            avgPrice: competitorData?.avgPrice,
            minPrice: competitorData?.minPrice,
            maxPrice: competitorData?.maxPrice,
            fromCache: competitorData?.fromCache,
          });

          // Post-process pricing based on market data (if not a precious metal with melt floor)
          if (competitorData && competitorData.competitorCount > 0 && (!listing.metalType || listing.metalType === "none")) {
            const aiMid = (listing.priceMin + listing.priceMax) / 2;
            const marketMid = competitorData.medianPrice || competitorData.avgPrice;
            
            if (marketMid && aiMid > 0) {
              // If AI price is way above market (>30%), trust market data instead
              if (aiMid / marketMid > 1.3) {
                const adjustedPrice = parseFloat((marketMid * 0.95).toFixed(2));
                listing.priceMin = adjustedPrice;
                listing.priceMax = parseFloat((marketMid * 1.05).toFixed(2));
                console.log(`analyze-item: AI price adjusted based on market data (${aiMid} → ${adjustedPrice})`);
              }
            }
          }

          // Always include competitor data in response
          listing.competitorData = {
            competitorCount: competitorData.competitorCount || 0,
            avgPrice: competitorData.avgPrice || 0,
            minPrice: competitorData.minPrice || 0,
            maxPrice: competitorData.maxPrice || 0,
            medianPrice: competitorData.medianPrice || 0,
            fromCache: competitorData.fromCache || false,
          };
        } else {
          const errText = await competitorResp.text();
          console.warn("analyze-item: competitor search failed:", { status: competitorResp.status, error: errText });
        }
      } catch (compErr) {
        console.warn("analyze-item: competitor fetch error (non-blocking):", compErr);
      }
    } else {
      console.log("analyze-item: skipping competitor search - missing title or userId");
    }
    // --- End competitor prices ---

    // --- Server-side melt value enforcement ---
    let meltValue: number | null = null;
    if (listing.metalType && listing.metalType !== "none" && listing.metalWeightOz > 0) {
      const spotPrice =
        listing.metalType === "gold" ? spotGold :
        listing.metalType === "silver" ? spotSilver :
        listing.metalType === "platinum" ? spotPlatinum : 0;
      if (spotPrice > 0) {
        meltValue = parseFloat((spotPrice * listing.metalWeightOz).toFixed(2));
        // Enforce: priceMin must never be below melt value PLUS eBay fees.
        // ~13.25% FVF + ~2.9% payment processing = ~16% total fees. Use 1.19x for margin.
        const feeAdjustedFloor = parseFloat((meltValue * 1.19).toFixed(2));
        if (listing.priceMin < feeAdjustedFloor) {
          console.warn(`priceMin ${listing.priceMin} below fee-adjusted melt floor ${feeAdjustedFloor} (melt: ${meltValue}) — correcting`);
          listing.priceMin = feeAdjustedFloor;
          // Also bump priceMax if it's somehow below the floor
          if (listing.priceMax < feeAdjustedFloor) {
            listing.priceMax = parseFloat((feeAdjustedFloor * 1.1).toFixed(2));
          }
        }
      }
    }
    // --- End melt value enforcement ---

    // Track this analysis for rate limiting (increment usage counter)
    // OQ-4: Insert org_id for per-org quotas (or NULL for non-Starter users)
    try {
      await svc.from("usage_tracking").insert({
        user_id: userId,
        action_type: "ai_analysis",
        org_id: tier === "starter" ? orgId : null,
      });
    } catch (trackErr) {
      console.error("Failed to track usage:", trackErr);
    }

    // --- Apply Starter-tier field allowlist (OQ-1: broad tier) ---
    // Attach domain to listing for frontend conditional UI
    listing.domain = identification.domain;

    const FREE_TIER_ALLOWED_FIELDS = new Set([
      "title", "description", "condition", "conditionDescription",
      "ebayCategoryId", "suggestedCategories",
      "itemSpecifics",
      "suggestedGrade", "packageWeightAndSize",
      "domain",
      // Locked to paid: priceMin, priceMax, meltValue, spotPrices, pricingNotes, gradingRationale, competitorData
    ]);

    let responsePayload = { ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } };
    if (tier === "starter") {
      responsePayload = Object.fromEntries(
        Object.entries(responsePayload).filter(([k]) => FREE_TIER_ALLOWED_FIELDS.has(k))
      );
      // Also scrub grading rationale if nested
      if ((responsePayload as any).itemSpecifics?.gradingRationale) {
        delete (responsePayload as any).itemSpecifics.gradingRationale;
      }
    }

    // --- Annotate all responses with credit metadata ---
    const creditsUsed = currentUsageCount + 1;
    const creditsRemaining = tier === "starter"
      ? Math.max(0, 6 - creditsUsed)
      : tier === "pro"
        ? Math.max(0, 50 - creditsUsed)
        : null;
    const creditsResetAt = tier === "starter" ? computeNextResetAt(orgResetDay) : null;

    const finalResponse = {
      ...responsePayload,
      _meta: {
        tier,
        creditsUsed: creditsUsed,
        creditsRemaining: creditsRemaining,
        creditsResetAt: creditsResetAt,
      },
    };

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-item error:", e);
    captureException(e, { function: "analyze-item", userId });
    if (e instanceof Error) {
      console.error("Error message:", e.message);
      console.error("Error stack:", e.stack);
    }
    const errorMsg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
