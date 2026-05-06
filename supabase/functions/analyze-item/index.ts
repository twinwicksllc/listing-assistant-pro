import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { captureException, initSentry } from "../_helpers/sentry.ts";

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
  return new Date(nextYear, nm, Math.min(resetDay, daysInNextMonth))
    .toISOString();
}

function isCoinDomainCategory(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  breadcrumb: string | null | undefined,
): boolean {
  if (!categoryId) return false;

  const categoryText = `${categoryName || ""} ${breadcrumb || ""}`
    .toLowerCase();

  if (
    /(coins?\b|paper money|bullion|exonumia|ancient|medieval|numis)/i.test(
      categoryText,
    )
  ) {
    return true;
  }

  return ["45243", "532", "173685"].includes(categoryId);
}

function isCategoryCompatibleWithDomain(
  domain: string | null | undefined,
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  breadcrumb: string | null | undefined,
): boolean {
  if (!domain || !categoryId) return true;

  switch (domain) {
    case "coins_bullion":
      return isCoinDomainCategory(categoryId, categoryName, breadcrumb);
    default:
      return true;
  }
}

serve(async (req: Request) => {
  const startTime = Date.now();
  const invocationId = crypto.randomUUID().slice(0, 8);
  console.log(`[${invocationId}] ▶️ analyze-item STARTED`);

  initSentry();

  // IMPORTANT: Handle OPTIONS preflight first, before anything else
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    console.log(`[${invocationId}] 📥 Parsing request body...`);
    // Initialize table in background (non-blocking)
    ensureTableExists().catch((e) => console.warn(`[${invocationId}] Table init error:`, e));
    // Parse body first (can only call req.json() once)
    const body = await req.json();
    console.log(
      `[${invocationId}] ✓ Body parsed: ${body.images?.length} images, voiceNote=${!!body
        .voiceNote}`,
    );

    // --- Server-side usage limit enforcement ---
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    console.log("analyze-item: authHeader present =", !!authHeader);
    let userId: string | null = null;
    let userEmail: string | null = null;

    if (authHeader) {
      console.log("analyze-item: getting user from auth header...");
      const { data: ud } = await svc.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      userId = ud?.user?.id || null;
      userEmail = ud?.user?.email || null;
      console.log("analyze-item: got user, email =", userEmail);
    } else {
      console.warn("analyze-item: NO Authorization header found!");
      console.warn(
        "analyze-item: available headers:",
        Array.from(req.headers.keys()),
      );
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
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
            if (productId === "prod_U70aT1KvuI2uDx") {
              tier = "unlimited";
            } else if (productId === "prod_U6zUiC1SYuPrGU") {
              tier = "pro";
            }
          }
        }
      } catch (stripeErr) {
        console.error(
          "Stripe check failed, defaulting to free tier:",
          stripeErr,
        );
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
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
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
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
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
            },
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
    const imageList: string[] = body.images ??
      (body.imageBase64 ? [body.imageBase64] : []);
    const voiceNote: string = body.voiceNote || "";
    // User-provided category override — if set, this is treated as an absolute lock
    // and the category-lookup pipeline is skipped entirely.
    const userCategoryId: string | null = body.categoryId ? String(body.categoryId).trim() || null : null;
    if (userCategoryId) {
      console.log(
        `analyze-item: user-provided categoryId=${userCategoryId} — will lock, skipping AI lookup`,
      );
    }

    // Initialize competitor data tracking (will be populated in two stages)
    // Pre-AI: Uses Pass 1 keywords (context for Gemini)
    // Post-AI: Uses AI-generated title (better accuracy for final response)
    let preAICompetitorData: any = null;
    let competitorData: any = null;
    let competitorDataSource: string = "none";

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

    // ─── PRE-PASS 0 RESULT (populated AFTER Pass 1 with real identity) ──────────
    // The actual agentic grounding + vision call runs AFTER Pass 1 so it
    // can use the real domain and item name instead of a heuristic guess.
    let prePassResult: {
      marketAnalysis: string | null;
      groundedCategoryId: string | null;
      agenticInspection: {
        zoomRegionsExamined: string[];
        keyFindings: string;
        confidenceBoost: number;
        identificationCorrection?: string;
      } | null;
    } | null = null;

    // ─── PASS 1: Fast item identification ────────────────────────────────────
    // Sends ALL images to determine domain, item name, and keywords.
    // Results are used to improve the pre-lookup query and route to the correct
    // domain-specific prompt for Pass 2.
    type Domain =
      | "coins_bullion"
      | "trading_cards"
      | "jewelry"
      | "electronics"
      | "vintage_clothing"
      | "general";
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
      // Use ALL images for Pass 1 — critical for items where key details
      // (slab labels, reverses, mint marks) may not appear in the first photo
      const pass1Images = imageList.map((img) => {
        const { base64Data, mimeType } = parseImageDataUrl(img);
        return {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Data}` },
        };
      });
      const pass1VoiceHint = voiceNote ? `\nSeller note: "${voiceNote.slice(0, 200)}"` : "";
      const pass1Resp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GEMINI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-3.1-pro-preview",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  `You are an item identification assistant. Examine ALL images carefully as a set and return ONLY valid JSON (no markdown, no code blocks):\n{"domain":"coins_bullion|trading_cards|jewelry|electronics|vintage_clothing|general","itemName":"short descriptive name (max 80 chars — include year, denomination, and series when visible for coins)","keywords":["kw1","kw2","kw3","kw4","kw5"],"isMetal":true|false,"metalType":"gold|silver|platinum|none"}\n\nDomain guide: coins_bullion=any coin, currency, bullion bar, bullion round, or precious metal; trading_cards=sports/TCG/Pokémon/Magic; jewelry=rings/watches/necklaces/bracelets/brooches; electronics=phones/PCs/consoles/cameras/audio; vintage_clothing=clothing/shoes/accessories; general=anything else (toys, tools, books, art, collectibles, etc.).\n\nCRITICAL FOR COINS/CARDS IN GRADING SLABS: If the item is in a PCGS, NGC, PSA, BGS, or other certification slab, READ THE PRINTED LABEL TEXT FIRST. The label is the AUTHORITATIVE source for year, denomination, grade, and item identity. Do NOT guess the year from the coin/card face if a label is clearly visible. Common AI error: misreading 2026 as 2020, 2021, or 2024. The digit 6 has a tail curving down-left - it is NOT a 0 or 1. Read each digit on the label individually and carefully.\n\nCRITICAL: Coins dated in recent or current years (2024, 2025, 2026, 2027) ARE REAL government-issued coins. They are NOT novelty, fantasy, replica, or tribute coins. The US Mint and other world mints actively produce coins with these dates. NEVER classify a professionally slabbed/graded coin (PCGS, NGC, etc.) as novelty, fantasy, or exonumia. Slabbed coins are ALWAYS domain coins_bullion.\n\nFAILED IDENTIFICATION PREVENTION:\n- When in doubt between coins_bullion and general for a round metallic object: choose coins_bullion.\n- For multi-item photos (e.g. several coins, a group of cards): identify the PRIMARY or most prominent item. If it is a lot/group, describe as a group in itemName (e.g. "Mixed US Silver Coin Lot 5 Coins").\n- If images are blurry/unclear, use the seller voice note if provided, otherwise pick the most likely domain from visible context clues.\n- For bullion bars, rounds, or generic silver/gold items: domain=coins_bullion, isMetal=true.\n- itemName MUST be specific: "1921 Morgan Silver Dollar" not just "coin". "2023 Pokemon Scarlet Base Set Pack" not just "card".`,
              },
              {
                role: "user",
                content: [...pass1Images, {
                  type: "text",
                  text: `Identify this item.${pass1VoiceHint}`,
                }],
              },
            ],
            max_tokens: 150,
          }),
        },
      );
      if (pass1Resp.ok) {
        const pass1Data = await pass1Resp.json();
        const pass1Text = pass1Data.choices?.[0]?.message?.content ?? "";
        console.log(
          `[${invocationId}] PASS 1 raw response (${pass1Text.length} chars):`,
          pass1Text.slice(0, 500),
        );

        if (!pass1Text || pass1Text.trim().length === 0) {
          console.warn(`[${invocationId}] ⚠️  Pass 1 returned empty response`);
        } else {
          try {
            const parsed = JSON.parse(pass1Text);
            if (parsed.domain && parsed.itemName) {
              identification = {
                domain: parsed.domain as Domain,
                itemName: String(parsed.itemName).slice(0, 120),
                keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 7).map(String) : [],
                isMetal: Boolean(parsed.isMetal),
                metalType: (parsed.metalType ?? "none") as Identification["metalType"],
              };
              console.log(
                `[${invocationId}] ✓ Pass 1 identification succeeded:`,
                identification,
              );
            } else {
              console.warn(
                `[${invocationId}] ⚠️  Pass 1 JSON missing domain or itemName:`,
                parsed,
              );
            }
          } catch (jsonParseErr) {
            // Try to extract JSON from the text (Gemini sometimes wraps it)
            const jsonMatch = pass1Text.match(/\{[\s\S]*"domain"[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.domain && parsed.itemName) {
                  identification = {
                    domain: parsed.domain as Domain,
                    itemName: String(parsed.itemName).slice(0, 120),
                    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 7).map(String) : [],
                    isMetal: Boolean(parsed.isMetal),
                    metalType: (parsed.metalType ?? "none") as Identification["metalType"],
                  };
                  console.log(
                    `[${invocationId}] ✓ Pass 1 identification succeeded (extracted from text):`,
                    identification,
                  );
                }
              } catch {
                console.error(`[${invocationId}] ❌ Pass 1 JSON parse failed (even after extraction):`, {
                  error: String(jsonParseErr),
                  raw: pass1Text.slice(0, 200),
                });
              }
            } else {
              console.error(`[${invocationId}] ❌ Pass 1 JSON parse failed:`, {
                error: String(jsonParseErr),
                raw: pass1Text.slice(0, 200),
              });
            }
          }
        }
      } else {
        const errBody = await pass1Resp.text();
        console.warn(
          `[${invocationId}] ⚠️  Pass 1 API returned status ${pass1Resp.status}:`,
          errBody.slice(0, 200),
        );
      }
    } catch (pass1Err) {
      console.warn(
        `[${invocationId}] ❌ Pass 1 fetch/parse failed:`,
        String(pass1Err),
      );
      if (pass1Err instanceof Error) {
        console.warn(`[${invocationId}] Error message:`, pass1Err.message);
      }
    }

    // ─── FALLBACK: Detect metal type from voice note if Pass 1 failed ────────
    // This ensures that if Gemini crashes, we can still detect precious metals
    // mentioned in the seller's voice description
    if (identification.metalType === "none" && voiceNote) {
      const noteText = voiceNote.toLowerCase();
      const goldKeywords = /\bgold\b|gold\s+(?:coin|bullion|eagle|bar|leaf)|gold\s+\d+/i;
      const silverKeywords = /\bsilver\b|silver\s+(?:coin|bullion|eagle|bar|oz)|silver\s+\d+/i;
      const platinumKeywords = /\bplatinum\b|platinum\s+(?:coin|bullion|bar)|platinum\s+\d+/i;

      if (goldKeywords.test(noteText)) {
        identification.metalType = "gold";
        identification.isMetal = true;
        console.log("analyze-item: FALLBACK detected gold from voice note");
      } else if (silverKeywords.test(noteText)) {
        identification.metalType = "silver";
        identification.isMetal = true;
        console.log("analyze-item: FALLBACK detected silver from voice note");
      } else if (platinumKeywords.test(noteText)) {
        identification.metalType = "platinum";
        identification.isMetal = true;
        console.log("analyze-item: FALLBACK detected platinum from voice note");
      }
    }
    // ─── END FALLBACK ────────────────────────────────────────────────────────
    // ─── END PASS 1 ──────────────────────────────────────────────────────────
    // ─── PRE-PASS 0: Agentic Grounding + Vision (runs AFTER Pass 1) ─────────────
    // Now that Pass 1 has identified the item, run Pre-Pass 0 with the REAL
    // domain and item name. This eliminates the old two-call pattern (heuristic
    // guess → re-run with real name) and ensures grounding uses accurate data.
    // Non-blocking: any failure leaves prePassResult = null, pipeline continues.
    try {
      const { runAgenticPrePass } = await import(
        "../_helpers/agenticPrePass.ts"
      );

      // Build base64 + mime lists for pre-pass (parse from data URLs) — use ALL images
      const prePassBase64List: string[] = [];
      const prePassMimeList: string[] = [];
      for (const img of imageList) {
        const ppBase64 = img.includes(",") ? img.split(",")[1] : img;
        const ppMimeMatch = img.match(/^data:(image\/\w+);/);
        const ppMimeType = ppMimeMatch ? ppMimeMatch[1] : "image/jpeg";
        prePassBase64List.push(ppBase64);
        prePassMimeList.push(ppMimeType);
      }

      // Use real domain + item name from Pass 1 (not a heuristic guess)
      prePassResult = await runAgenticPrePass(
        GEMINI_API_KEY,
        identification.domain as any,
        identification.itemName,
        prePassBase64List,
        prePassMimeList,
        invocationId,
      );
      if (prePassResult) {
        console.log(
          `[${invocationId}] Pre-Pass 0 completed with domain=${identification.domain}, item=${identification.itemName}`,
        );
      }
    } catch (prePassErr) {
      console.warn(
        `[${invocationId}] Pre-Pass 0 outer catch (non-blocking):`,
        String(prePassErr),
      );
    }
    // ─── END PRE-PASS 0 ─────────────────────────────────────────────────────────

    // ─── SLAB OCR: GPT-4o Vision label reading (coins_bullion + general domains only) ──────────────────
    // Runs BEFORE Pass 2 so the correct year/grade/cert are injected as ground
    // truth into the Gemini prompt. Eliminates year misreads at the source.
    // Non-blocking: failure leaves slabOcrResult = null, pipeline continues.
    let slabOcrResult: Awaited<ReturnType<typeof import("../_helpers/slabOcr.ts").runSlabOcr>> = null;
    try {
      const NEW_OPENAI_API_KEY = Deno.env.get("NEW_OPENAI_API_KEY");
      const OPENAI_PROXY_URL = Deno.env.get("OPENAI_PROXY_URL")?.trim();
      const _hasOpenAiPath = Boolean(NEW_OPENAI_API_KEY || OPENAI_PROXY_URL);
      // Domain guard: only run for coins_bullion (definite slabs) and general
      // (Pass 1 mis-classifications). Skip trading_cards, jewelry, electronics,
      // vintage_clothing to avoid unnecessary GPT-4o spend (~$0.038/call).
      const _slabOcrEligible = identification.domain === "coins_bullion" || identification.domain === "general";
      if (_hasOpenAiPath && _slabOcrEligible) {
        const { runSlabOcr } = await import("../_helpers/slabOcr.ts");
        const ocrBase64List: string[] = [];
        const ocrMimeList: string[] = [];
        for (const img of imageList) {
          const b64 = img.includes(",") ? img.split(",")[1] : img;
          const mimeMatch = img.match(/^data:(image\/\w+);/);
          ocrBase64List.push(b64);
          ocrMimeList.push(mimeMatch ? mimeMatch[1] : "image/jpeg");
        }
        console.log(
          `[${invocationId}] Calling Slab OCR with ${ocrBase64List.length} images (domain=${identification.domain}, eligible=true)`,
        );
        slabOcrResult = await runSlabOcr(
          NEW_OPENAI_API_KEY ?? "",
          ocrBase64List,
          ocrMimeList,
          invocationId,
          userId, // pass userId for OpenAI user attribution
        );
        console.log(
          `[${invocationId}] Slab OCR result: isSlabbed=${slabOcrResult?.isSlabbed}, grader=${slabOcrResult?.grader}, year=${slabOcrResult?.year}, grade=${slabOcrResult?.grade}, certNumber=${slabOcrResult?.certNumber}`,
        );
        // Log OpenAI usage for cost tracking (non-blocking)
        if (slabOcrResult?._usage) {
          svc.from("gemini_usage").insert({
            user_id: userId,
            function_name: "analyze-item/slab-ocr",
            model: "gpt-4o",
            provider: "openai",
            prompt_tokens: slabOcrResult._usage.promptTokens,
            completion_tokens: slabOcrResult._usage.completionTokens,
            total_tokens: slabOcrResult._usage.totalTokens,
            cost_usd: slabOcrResult._usage.costUsd,
          }).then(() => {}).catch((e: unknown) =>
            console.warn(`[${invocationId}] Failed to log OpenAI slab OCR usage:`, String(e))
          );
        }
        if (slabOcrResult?.isSlabbed) {
          console.log(
            `[${invocationId}] Slab OCR: detected slab, grader=${slabOcrResult.grader}, year=${slabOcrResult.year}, grade=${slabOcrResult.grade}, certNumber=${slabOcrResult.certNumber}`,
          );
          // If Pass 1 failed and defaulted to "general", correct the domain now
          if (identification.domain !== "coins_bullion") {
            console.log(
              `[${invocationId}] Slab OCR: correcting domain from "${identification.domain}" to "coins_bullion"`,
            );
            identification.domain = "coins_bullion";
            if (!identification.itemName || identification.itemName === "item") {
              identification.itemName = slabOcrResult.coinName ??
                `${slabOcrResult.year ?? ""} ${slabOcrResult.grader ?? ""} ${slabOcrResult.grade ?? ""} ${
                  slabOcrResult.coinName ?? "Coin"
                }`.trim();
            }
          }
        } else {
          console.log(
            `\`${invocationId}\` Slab OCR: no slab detected (isSlabbed=\${slabOcrResult?.isSlabbed || "false"}, grader=\${slabOcrResult?.grader || "null"})`,
          );
        }
      } else if (!_hasOpenAiPath) {
        console.warn(
          `[${invocationId}] Slab OCR: no OpenAI route configured (set NEW_OPENAI_API_KEY or OPENAI_PROXY_URL) — skipping`,
        );
      } else {
        console.log(
          `[${invocationId}] Slab OCR skipped for domain="${identification.domain}" (eligible: coins_bullion|general)`,
        );
      }
    } catch (ocrErr) {
      console.warn(
        `[${invocationId}] Slab OCR failed (non-blocking):`,
        String(ocrErr),
      );
    }
    // ─── END SLAB OCR ─────────────────────────────────────────────────────────────────────

    // ── Pre-lookup: Deterministic category resolution ──────────────────────────
    let categoryHints = "";
    let lockedCategoryId: string | null = null;
    let lockedCategoryName: string | null = null;
    let lockedBreadcrumb: string | null = null;
    let lookupAlternatives: any[] = [];
    let fetchedMetadataCategoryId: string | null = null;

    // If the user explicitly provided a category ID, use it as an absolute lock.
    // Skip the lookup pipeline entirely — the user's choice always wins.
    if (userCategoryId) {
      lockedCategoryId = userCategoryId;
      lockedCategoryName = "";
      lockedBreadcrumb = "";
      categoryHints =
        `\n- **USER-LOCKED CATEGORY**: **${userCategoryId}**. The seller has explicitly chosen this category. YOU MUST USE THIS EXACT CATEGORY ID. Do not suggest any other.`;
      console.log(
        `analyze-item: user category lock applied: ${userCategoryId}`,
      );
    }

    // ── Tier-2: Grounded category from Pre-Pass 0 Google Search ─────────────────
    // If Pre-Pass 0 found a category ID via live Google Search, verify it
    // as a leaf via category-lookup. If verified, use it as a high-confidence lock.
    // Priority: user lock > grounded verified leaf > deterministic DB > AI hint
    if (!userCategoryId && prePassResult?.groundedCategoryId) {
      try {
        const _groundedVerifyUrl = Deno.env.get("SUPABASE_URL");
        const _groundedVerifyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_groundedVerifyUrl && _groundedVerifyKey) {
          const groundedVerifyResp = await fetch(
            `${_groundedVerifyUrl}/functions/v1/category-lookup`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${_groundedVerifyKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "verify",
                categoryId: prePassResult.groundedCategoryId,
              }),
            },
          );
          if (groundedVerifyResp.ok) {
            const groundedVerifyText = await groundedVerifyResp.text();
            let groundedVerifyData: any;
            try {
              groundedVerifyData = JSON.parse(groundedVerifyText);
            } catch {
              groundedVerifyData = {};
            }

            if (
              groundedVerifyData.isLeaf === true &&
              groundedVerifyData.valid !== false
            ) {
              const groundedCategoryName = groundedVerifyData.categoryName || "";
              const groundedBreadcrumb = groundedVerifyData.breadcrumb ||
                groundedVerifyData.categoryName || "";

              if (
                isCategoryCompatibleWithDomain(
                  identification.domain,
                  prePassResult.groundedCategoryId,
                  groundedCategoryName,
                  groundedBreadcrumb,
                )
              ) {
                // Grounded leaf verified — use as a strong (but not absolute) lock
                lockedCategoryId = prePassResult.groundedCategoryId;
                lockedCategoryName = groundedCategoryName;
                lockedBreadcrumb = groundedBreadcrumb;
                categoryHints +=
                  `\n- **GROUNDED CATEGORY** (verified leaf from live Google Search): **${lockedCategoryId}** — ${lockedBreadcrumb}. This was found by searching eBay's current 2026 taxonomy. USE THIS CATEGORY unless you have strong evidence it is incorrect.`;
                console.log(
                  `[${invocationId}] GROUNDED LOCK: category ${lockedCategoryId} (${lockedBreadcrumb}) verified as leaf via Pre-Pass 0`,
                );
              } else {
                categoryHints +=
                  `\n- GROUNDING HINT REJECTED AS LOCK: **${prePassResult.groundedCategoryId}** — ${groundedBreadcrumb}. This verified leaf does not match resolved domain ${identification.domain}.`;
                console.warn(
                  `[${invocationId}] Grounded category ${prePassResult.groundedCategoryId} rejected for domain ${identification.domain}: ${groundedBreadcrumb}`,
                );
              }
            } else {
              // Not a valid leaf — downgrade to a strong hint
              categoryHints +=
                `\n- GROUNDING HINT (unverified leaf): **${prePassResult.groundedCategoryId}** (from live Google Search — use as hint, verify before locking).`;
              console.log(
                `[${invocationId}] Grounded category ${prePassResult.groundedCategoryId} NOT a verified leaf (isLeaf=${groundedVerifyData.isLeaf}) — using as hint only`,
              );
            }
          }
        }
      } catch (groundedLookupErr) {
        console.warn(
          `[${invocationId}] Grounded category verification failed (non-blocking):`,
          String(groundedLookupErr),
        );
      }
    }
    // ── End grounded category tier ───────────────────────────────────────────────

    if (!userCategoryId) {
      try { // skip lookup if user already provided a category
        // Use Pass 1 item name + keywords for a much better category query than raw voice note
        const pass1Query = identification.keywords.length > 0
          ? `${identification.itemName} ${identification.keywords.slice(0, 3).join(" ")}`
          : identification.itemName;
        const searchQuery = (pass1Query !== "item" ? pass1Query : voiceNote) ||
          "";
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
                body: JSON.stringify({
                  action: "lookup",
                  itemType: searchQuery,
                }),
              },
            );
            if (lookupResp.ok) {
              const lookupText = await lookupResp.text();
              let lookupData: any;
              try {
                lookupData = JSON.parse(lookupText);
              } catch {
                console.warn(
                  `analyze-item: category pre-lookup returned invalid JSON (length=${lookupText.length})`,
                );
                lookupData = null;
              }

              if (lookupData && lookupData.found) {
                const score = lookupData.effectiveScore ||
                  lookupData.confidence || 0;
                const isVerifiedLeaf = lookupData.verifiedLeaf !== false;
                const source = lookupData.source || "";

                // Deterministic lock: high-confidence verified result (#3)
                // Lock if: score >= 88 AND (source is eBay API or user-verified DB exact)
                const isLockable = score >= 88 && isVerifiedLeaf &&
                  (source === "ebay_api" || source.includes("user_verified") ||
                    source.includes("db_exact"));
                const isDomainCompatible = isCategoryCompatibleWithDomain(
                  identification.domain,
                  lookupData.categoryId,
                  lookupData.categoryName,
                  lookupData.breadcrumb,
                );

                if (isLockable && isDomainCompatible) {
                  lockedCategoryId = lookupData.categoryId;
                  lockedCategoryName = lookupData.categoryName || "";
                  lockedBreadcrumb = lookupData.breadcrumb ||
                    lookupData.categoryName || "";
                  categoryHints +=
                    `\n- **LOCKED CATEGORY** (verified, high-confidence): **${lockedCategoryId}** — ${lockedBreadcrumb}. YOU MUST USE THIS CATEGORY ID. Do not override.`;
                  console.log(
                    `analyze-item: DETERMINISTIC LOCK on category ${lockedCategoryId} (score=${score}, source=${source})`,
                  );
                } else {
                  // Not locked — provide as strong hint
                  if (isLockable && !isDomainCompatible) {
                    console.warn(
                      `analyze-item: rejecting deterministic lock ${lookupData.categoryId} for domain ${identification.domain} (${
                        lookupData.breadcrumb || lookupData.categoryName
                      })`,
                    );
                  }
                  categoryHints += `\n- BEST MATCH (score=${score}, source=${source}): **${lookupData.categoryId}** — ${
                    lookupData.breadcrumb || lookupData.categoryName
                  }. Use this as primary category unless the item clearly belongs elsewhere.`;
                }

                // Collect alternatives for fallback
                if (
                  lookupData.alternatives && lookupData.alternatives.length > 0
                ) {
                  lookupAlternatives = lookupData.alternatives;
                  categoryHints += "\n- ALTERNATIVE CATEGORIES:";
                  for (const alt of lookupData.alternatives.slice(0, 3)) {
                    categoryHints += `\n  * **${alt.categoryId}** — ${alt.breadcrumb || alt.categoryName} (score=${
                      alt.score || "?"
                    })`;
                  }
                }
              } else if (
                lookupData && lookupData.topCandidates &&
                lookupData.topCandidates.length > 0
              ) {
                // Circuit breaker fired — no candidate passed threshold (#9)
                categoryHints += "\n- LOW-CONFIDENCE CANDIDATES (use your best judgment):";
                for (const c of lookupData.topCandidates) {
                  categoryHints += `\n  * **${c.categoryId}** — ${c.breadcrumb || c.categoryName} (score=${
                    c.score || "?"
                  })`;
                }
                lookupAlternatives = lookupData.topCandidates;
              }
            }
          }
        }
      } catch (lookupErr) {
        console.warn(
          "analyze-item: category pre-lookup failed (non-blocking):",
          lookupErr,
        );
      } // end if (!userCategoryId)
    }
    // ── End pre-lookup ─────────────────────────────────────────────────────────

    // ── Fetch dynamic aspects and conditions for the chosen category ──────────
    let categoryAspects: any = null;
    let categoryConditions: any = null;

    {
      const targetCategoryId = lockedCategoryId || null;
      if (targetCategoryId) {
        fetchedMetadataCategoryId = targetCategoryId;
        const _aspectsUrl = Deno.env.get("SUPABASE_URL");
        const _aspectsKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_aspectsUrl && _aspectsKey) {
          try {
            const aspectsResp = await fetch(
              `${_aspectsUrl}/functions/v1/category-lookup`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${_aspectsKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  action: "aspects",
                  categoryId: targetCategoryId,
                }),
              },
            );
            if (aspectsResp.ok) {
              categoryAspects = await aspectsResp.json();
              console.log(
                `[${invocationId}] analyze-item: fetched ${
                  categoryAspects.aspects?.length || 0
                } aspects for category ${targetCategoryId}`,
              );
            }
          } catch (aspectErr) {
            console.warn(
              `[${invocationId}] analyze-item: aspects fetch failed (non-blocking):`,
              aspectErr,
            );
          }

          try {
            const conditionsResp = await fetch(
              `${_aspectsUrl}/functions/v1/category-lookup`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${_aspectsKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  action: "conditions",
                  categoryId: targetCategoryId,
                }),
              },
            );
            if (conditionsResp.ok) {
              categoryConditions = await conditionsResp.json();
              console.log(
                `[${invocationId}] analyze-item: fetched ${
                  categoryConditions.conditions?.length || 0
                } conditions for category ${targetCategoryId}`,
              );
            }
          } catch (condErr) {
            console.warn(
              `[${invocationId}] analyze-item: conditions fetch failed (non-blocking):`,
              condErr,
            );
          }
        }
      }
    }
    // ── End dynamic aspects/conditions fetch ──────────────────────────────────

    // ─── Pre-AI sold comps (so AI has real pricing context in Pass 2) ────────
    // Uses Pass 1 keywords for broader context search
    {
      const compQuery = identification.keywords.slice(0, 5).join(" ") ||
        identification.itemName;
      if (compQuery && compQuery !== "item" && userId) {
        try {
          console.log(
            `[${invocationId}] Pre-AI competitor search with query: "${compQuery}"`,
          );
          const compResp = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-competitor-search`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ userId, title: compQuery, yourPrice: 0 }),
            },
          );
          if (compResp.ok) {
            const compText = await compResp.text();
            let compData: any;
            try {
              compData = JSON.parse(compText);
            } catch {
              console.warn(
                `[${invocationId}] Pre-AI competitor search returned invalid JSON (length=${compText.length})`,
              );
              compData = null;
            }
            if (compData && (compData.competitorCount ?? 0) > 0) {
              preAICompetitorData = compData;
              competitorData = compData;
              competitorDataSource = "pre-ai";
              console.log(
                `[${invocationId}] Pre-AI comps succeeded: count=${compData.competitorCount}, avg=$${
                  compData.avgPrice?.toFixed(2)
                }, median=$${compData.medianPrice?.toFixed(2)}`,
              );
            } else {
              console.log(
                `[${invocationId}] Pre-AI comps returned 0 results (will retry post-AI with full title)`,
              );
            }
          } else {
            console.warn(
              `[${invocationId}] Pre-AI competitor search failed with status ${compResp.status}`,
            );
          }
        } catch (preCompErr) {
          console.warn(
            `[${invocationId}] Pre-AI comp fetch error (non-blocking):`,
            preCompErr,
          );
        }
      } else {
        console.log(
          `[${invocationId}] Skipping pre-AI competitor search (compQuery="${compQuery}", userId=${!!userId})`,
        );
      }
    }
    // ─── END pre-AI sold comps ────────────────────────────────────────────────

    // ─── Build domain-specific system prompt ─────────────────────────────────
    let systemPrompt: string;
    try {
      const { buildSystemPrompt } = await import(
        "../_helpers/domainPrompts.ts"
      );
      systemPrompt = buildSystemPrompt(identification.domain, {
        itemName: identification.itemName,
        imageCount: imageList.length,
        voiceNote: voiceNote || undefined,
        suggestedCategoryId: lockedCategoryId ?? undefined,
        suggestedCategoryName: lockedCategoryName ?? undefined,
        spotPrices:
          (identification.isMetal || identification.metalType !== "none" || identification.domain === "coins_bullion")
            ? { gold: spotGold, silver: spotSilver, platinum: spotPlatinum }
            : undefined,
        metalType: identification.metalType,
        competitorData: competitorData && (competitorData.competitorCount ?? 0) > 0 ? competitorData : null,
        // ─ Pre-Pass 0 agentic context (grounding + vision inspection findings) ─
        prePassContext: prePassResult
          ? {
            marketAnalysis: prePassResult.marketAnalysis ?? undefined,
            groundedCategoryId: prePassResult.groundedCategoryId ?? undefined,
            agenticInspection: prePassResult.agenticInspection
              ? {
                zoomRegionsExamined: prePassResult.agenticInspection.zoomRegionsExamined,
                keyFindings: prePassResult.agenticInspection.keyFindings,
                confidenceBoost: prePassResult.agenticInspection.confidenceBoost,
                identificationCorrection: prePassResult.agenticInspection.identificationCorrection,
              }
              : undefined,
          }
          : null,
      });
      // Inject category hints from pre-lookup into the prompt
      if (categoryHints) {
        systemPrompt += `\n\n### CATEGORY SELECTION HINTS (from deterministic pre-lookup)\n${categoryHints}`;
      }

      // Inject dynamic aspects guidance from eBay API
      if (categoryAspects?.aspects && categoryAspects.aspects.length > 0) {
        const required = categoryAspects.aspects.filter((a: any) => a.required)
          .map((a: any) => a.name);
        const suggested = categoryAspects.aspects.filter((a: any) => !a.required).map((a: any) => a.name);
        let aspectsGuidance = `\n\n### REQUIRED ATTRIBUTES FOR THIS CATEGORY (from eBay API)`;
        if (required.length > 0) {
          aspectsGuidance += `\nYou MUST provide these attributes:\n${
            required.map((r: string) => `- ${r}`).join("\n")
          }`;
        }
        if (suggested.length > 0) {
          aspectsGuidance += `\n\nSuggested attributes (provide if visible or inferable):\n${
            suggested.slice(0, 10).map((s: string) => `- ${s}`).join("\n")
          }`;
        }
        systemPrompt += aspectsGuidance;
      }

      // Inject allowed conditions from eBay API
      if (
        categoryConditions?.conditions &&
        categoryConditions.conditions.length > 0
      ) {
        const conditionsGuidance =
          `\n\n### ALLOWED CONDITIONS FOR THIS CATEGORY (from eBay API)\nOnly use one of these condition values:\n` +
          categoryConditions.conditions
            .map((c: any) => `- ${c.conditionDescription || c.conditionId}`)
            .join("\n");
        systemPrompt += conditionsGuidance;
      }
    } catch (promptErr) {
      console.error(
        "analyze-item: failed to load domain prompts, using fallback:",
        promptErr,
      );
      systemPrompt =
        `You are a professional eBay listing expert. Analyze the provided photo(s) and generate a complete, accurate listing via the create_listing tool. Title ≤ 80 chars. Condition must be one of: NEW, USED_EXCELLENT, USED_VERY_GOOD, USED_GOOD, USED_ACCEPTABLE, FOR_PARTS_OR_NOT_WORKING.`;
    }
    // ─── Inject Slab OCR ground truth into system prompt ──────────────────────────────
    // If GPT-4o successfully read the slab label, prepend it to the system prompt
    // so Gemini sees the correct year/grade/cert BEFORE all other instructions.
    if (slabOcrResult?.isSlabbed) {
      try {
        const { formatSlabOcrContext } = await import("../_helpers/slabOcr.ts");
        const ocrContext = formatSlabOcrContext(slabOcrResult);
        if (ocrContext) {
          const originalLength = systemPrompt.length;
          systemPrompt = ocrContext + "\n\n" + systemPrompt;
          console.log(
            `[${invocationId}] Slab OCR ground truth injected into system prompt (length=${ocrContext.length} chars, total prompt now ${systemPrompt.length} chars)`,
          );
          console.log(
            `[${invocationId}] OCR context preview: ${ocrContext.slice(0, 200)}...`,
          );
        } else {
          console.warn(
            `[${invocationId}] formatSlabOcrContext returned empty string despite isSlabbed=true`,
          );
        }
      } catch (fmtErr) {
        console.warn(
          `[${invocationId}] Failed to format slab OCR context:`,
          fmtErr,
        );
      }
    } else {
      console.log(
        `[${invocationId}] Slab OCR context not injected: isSlabbed=${slabOcrResult?.isSlabbed}`,
      );
    }
    // ─── END Slab OCR injection ──────────────────────────────────────────────────────────────────

    // DUMMY_PLACEHOLDER — remove this line (keeps template literal parser happy)
    const _promoteSystemPrompt =
      `You are a professional eBay Listing Expert and item identifier. Your task is to analyze item photos and generate a complete listing via the \`create_listing\` tool.

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
- Current spot prices: Gold $${spotGold.toFixed(2)}/oz | Silver $${spotSilver.toFixed(2)}/oz | Platinum $${
        spotPlatinum.toFixed(2)
      }/oz
${
        competitorData && !competitorData.error
          ? `- MARKET DATA (${competitorData.competitorCount || 0} similar sold): avg $${
            (competitorData.avgPrice || 0).toFixed(2)
          }, range $${(competitorData.minPrice || 0).toFixed(2)}-$${
            (competitorData.maxPrice || 0).toFixed(2)
          }, median $${(competitorData.medianPrice || 0).toFixed(2)}. USE AS PRIMARY PRICING REFERENCE.`
          : `- No recent sold comps available. Use category knowledge and condition to price appropriately.`
      }

Use the \`create_listing\` tool to return the final structured data.`;
    // The _promoteSystemPrompt above is the fallback template — actual systemPrompt is built above.
    void _promoteSystemPrompt;

    // Build content array with all images + text prompt
    const contentParts: any[] = imageList.map((img) => {
      const { base64Data, mimeType } = parseImageDataUrl(img);
      return {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      };
    });

    let userText = `I've provided ${imageList.length} photo${
      imageList.length > 1 ? "s" : ""
    } of: ${identification.itemName}. Analyze all photos together, apply your ${
      identification.domain.replace("_", " ")
    } expertise, and produce a complete eBay listing via the create_listing tool — accurate title, full description, correct category ID, all relevant item specifics, condition, and a fair asking price.`;

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

    // ── Build dynamic tool schema from eBay aspects/conditions ─────────────────
    // Condition enum: use eBay's actual allowed conditions for this category,
    // falling back to our generic USED_* set when no category data is available.
    //
    // IMPORTANT: We must use our internal UPPERCASE enum keys (e.g. "NEW", "USED_EXCELLENT")
    // NOT conditionDescription strings (e.g. "New", "Used") from the eBay API.
    // If Gemini stores a human-readable description like "New" in the draft, the
    // publish function can't map it to a valid ConditionEnum and eBay returns:
    //   errorId 2004: "Could not serialize field [condition]"
    //
    // Map eBay conditionId -> our internal enum key for the prompt.
    const CONDITION_ID_TO_ENUM: Record<number, string> = {
      1000: "NEW",
      1500: "NEW_OTHER",
      1750: "NEW_WITH_DEFECTS",
      2000: "CERTIFIED_REFURBISHED",
      2010: "CERTIFIED_REFURBISHED",
      2020: "CERTIFIED_REFURBISHED",
      2030: "CERTIFIED_REFURBISHED",
      2500: "SELLER_REFURBISHED",
      2750: "LIKE_NEW",
      3000: "USED_EXCELLENT",
      4000: "USED_VERY_GOOD",
      5000: "USED_GOOD",
      6000: "USED_ACCEPTABLE",
      7000: "FOR_PARTS_OR_NOT_WORKING",
    };
    const conditionEnum: string[] = categoryConditions?.conditions?.length > 0
      ? [
        ...new Set(
          categoryConditions.conditions.map((c: any) => {
            const id = Number(c.conditionId);
            return CONDITION_ID_TO_ENUM[id] ??
              String(c.conditionDescription ?? c.conditionId).toUpperCase().replace(/\s+/g, "_");
          }),
        ),
      ]
      : [
        "NEW",
        "USED_EXCELLENT",
        "USED_VERY_GOOD",
        "USED_GOOD",
        "USED_ACCEPTABLE",
        "FOR_PARTS_OR_NOT_WORKING",
      ];

    // itemSpecifics schema: use eBay's required/suggested aspects for this category,
    // falling back to the generic coin/collectible schema when no aspects are available.
    const itemSpecificsSchema: any = {
      type: "object",
      description: "eBay item specifics (attributes) for this category",
      properties: {},
      required: [] as string[],
      additionalProperties: true,
    };

    if (categoryAspects?.aspects && categoryAspects.aspects.length > 0) {
      for (const aspect of categoryAspects.aspects) {
        const propSchema: any = {
          type: "string",
          description: aspect.required ? `REQUIRED by eBay: ${aspect.name}` : `Suggested by eBay: ${aspect.name}`,
        };
        // If eBay provides a constrained allowed-values list, add as enum
        if (
          Array.isArray(aspect.values) && aspect.values.length > 0 &&
          aspect.values.length < 50
        ) {
          propSchema.enum = aspect.values;
        }
        itemSpecificsSchema.properties[aspect.name] = propSchema;
        if (aspect.required) {
          itemSpecificsSchema.required.push(aspect.name);
        }
      }
      console.log(
        `[${invocationId}] Dynamic itemSpecifics schema: ${
          Object.keys(itemSpecificsSchema.properties).length
        } props, ${itemSpecificsSchema.required.length} required`,
      );
    } else {
      // Fallback: generic coin/collectible/trading-card schema
      itemSpecificsSchema.properties = {
        Certification: {
          type: "string",
          enum: ["Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"],
        },
        Grade: {
          type: "string",
          description: "Only if NOT Uncertified. Format: 'MS 65'",
        },
        Year: { type: "string" },
        "Mint Location": { type: "string" },
        Denomination: { type: "string" },
        Composition: {
          type: "string",
          enum: [
            "Gold",
            "Silver",
            "Platinum",
            "Palladium",
            "Copper",
            "Nickel",
            "Steel",
            "Zinc",
            "Brass",
            "Aluminum",
            "Bimetallic",
            "Copper-Nickel",
            "Bronze",
          ],
        },
        Fineness: { type: "string" },
        "Strike Type": {
          type: "string",
          enum: ["Business", "Proof", "Proof-Like", "Satin"],
        },
        Variety: { type: "string", description: "VAM number (e.g., 'VAM-1A')" },
        "Circulated/Uncirculated": {
          type: "string",
          enum: ["Circulated", "Uncirculated", "Unknown"],
        },
        "Mint Mark": { type: "string" },
        "Brand/Mint": { type: "string" },
        "Country of Origin": { type: "string" },
        "Materials sourced from": { type: "string" },
        "Shape": {
          type: "string",
          description: "For bullion bars/rounds: Bar, Round, Coin, Slab, etc.",
        },
        "Precious Metal Content per Unit": { type: "string" },
        "Total Precious Metal Content": {
          type: "string",
          description: "For lots with multiple items: e.g., '5 oz total silver'",
        },
        "Sport": {
          type: "string",
          description: "REQUIRED for sports cards. E.g. Baseball, Basketball, Football, Hockey, Soccer",
        },
        "Player/Athlete": {
          type: "string",
          description: "Player name for sports cards",
        },
        "Card Manufacturer": {
          type: "string",
          description: "E.g. Donruss, Topps, Upper Deck, Fleer, Bowman",
        },
        "Season": {
          type: "string",
          description: "Season year for sports cards",
        },
        "Team": { type: "string", description: "Team name for sports cards" },
        "Features": {
          type: "string",
          description: "E.g. Rookie, Autograph, Parallel, Refractor, Hologram",
        },
        "Card Name": {
          type: "string",
          description: "Card name for Pokémon/MTG/non-sport cards",
        },
        "Set": {
          type: "string",
          description: "Card set name for trading cards",
        },
        "Character": {
          type: "string",
          description: "Character name for Funko Pop, Beanie Babies, action figures",
        },
        "Brand": {
          type: "string",
          description: "Brand name for collectibles (e.g. Ty, Funko, LEGO)",
        },
        "Franchise": {
          type: "string",
          description: "Franchise/series for Funko Pop, action figures",
        },
        "Animal": {
          type: "string",
          description: "Animal type for Beanie Babies, stuffed animals",
        },
        "Material": {
          type: "string",
          description: "Material for jewelry, toys (e.g. Gold, Silver, Plush)",
        },
      };
      itemSpecificsSchema.required = ["Certification", "Year", "Composition"];
    }
    // ── End dynamic tool schema ───────────────────────────────────────────────

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-3.1-pro-preview",
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
                      description:
                        "SEO-optimized eBay title, max 80 chars. Format: [Year] [Country] [Denomination] [Series/Design] [Metal] [Weight] [Condition/Grade]",
                    },
                    categoryId: {
                      type: "string",
                      description:
                        "eBay leaf category ID. ALL IDs below are VERIFIED LEAF categories. COINS US: Morgan Dollars=39464, Peace Dollars=11980, Eisenhower Dollars=11981, Kennedy Half=41102, Franklin Half=11973, Walking Liberty Half=41099, Barber Half=11971, Wheat Penny=39455, US Proof Sets=41109, US Mint Sets=526, Ancient Coins=532, Medieval Coins=173685. BULLION (use ONLY for items sold primarily for precious metal content — e.g. generic silver rounds, metal bars, American Silver/Gold Eagles sold as bullion): Gold Bars/Rounds=178906, Silver Bars/Rounds=39489, Gold Coins (bullion)=177652, Silver Coins (bullion)=177653, Copper/Other Bullion=166679, Other Silver Bullion=3361. WORLD COINS (non-US coins — use for ANY coin issued by a non-US government mint, especially collectibles and certified/graded coins): Canada=40196, Mexico=40197, Great Britain=40198, Australia=40199, Germany=40200, World Coins (all other countries including China, Japan, Asia, Europe, etc.)=45243. CRITICAL WORLD COIN RULES: Chinese Panda coins, Chinese Lunar series (Year of the Pig/Rat/Ox/Tiger/Dragon/etc.), any Chinese Yuan/commemorative coin, Japanese Yen commemoratives, any NGC/PCGS/ANACS-certified coin from a non-US mint = ALWAYS use World Coins (45243 or country-specific), NEVER bullion categories. A coin in a grading slab with a foreign country name on the label is a WORLD COIN, not bullion. FORBIDDEN CATEGORY RULE: NEVER assign any coin, currency, or bullion item to category 261186 (Books) or any category outside Coins & Paper Money. If unsure about a coin's origin, always default to 45243 (World Coins) before guessing any non-coin category. TRADING CARDS: Sports Card Singles=261328, Sports Card Lots=261329, Sports Card Sets=261330, Sealed Card Packs=261331, Sealed Card Boxes=261332, CCG Individual Cards (Pokemon/MTG/Yu-Gi-Oh)=183454, Non-Sport Card Singles=183050. TOYS: LEGO Complete Sets=19006, Action Figures=261068, Beanie Babies Retired=440, Jellycat=158786, Other Stuffed Animals=230, Jigsaw Puzzles=19183, Diecast Cars=180506, Board Games=180349, Collectible Figures/Bobbleheads=149372. ELECTRONICS: Smartphones=9355, Headphones=112529. JEWELRY: Wristwatches=31387. For items not listed above, describe the item clearly and the system will find the correct leaf category via eBay's API. NEVER use broad parent IDs like 253, 11118, 213, 246, 182, 1, 550, or 64482.",
                    },
                    alternativeCategoryIds: {
                      type: "array",
                      description:
                        "Up to 2 alternative eBay category IDs that would also be appropriate. Must be from the same domain as the primary (e.g. if item is a coin, alternatives must also be coin/bullion/world-coin categories — NEVER suggest a Books or non-Coins category as an alternative for a coin).",
                      items: { type: "string" },
                      maxItems: 2,
                    },
                    condition: {
                      type: "string",
                      enum: conditionEnum,
                      description: "Item condition from eBay's allowed list for this category",
                    },
                    description: {
                      type: "string",
                      description:
                        "Write a natural, human-sounding eBay description in plain text. Do NOT output section headers or labels such as 'Opening Hook', 'Quick Specs', 'What Sets It Apart', 'Closing Statement', 'Overview', 'Specifications', or any markdown heading markers. Do NOT use HTML. Keep it concise and readable: 2-5 short paragraphs and optional simple bullet lines. Mention condition honestly, what is included, and specific visual details from the photos. Avoid robotic marketing language.",
                    },
                    price: {
                      type: "object",
                      properties: {
                        amount: { type: "number" },
                        currency: { type: "string", default: "USD" },
                      },
                      required: ["amount"],
                    },
                    itemSpecifics: itemSpecificsSchema,
                    pricingNotes: { type: "string" },
                    isSlabbed: { type: "boolean" },
                    metalType: {
                      type: "string",
                      enum: ["gold", "silver", "platinum", "none"],
                    },
                    metalWeightOz: { type: "number" },
                  },
                  required: [
                    "title",
                    "categoryId",
                    "condition",
                    "description",
                    "price",
                    "itemSpecifics",
                    "isSlabbed",
                    "metalType",
                    "metalWeightOz",
                  ],
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
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded. Please try again in a moment.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error: "AI usage limit reached. Please add credits.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
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
        model: "gemini-3.1-pro-preview",
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

    console.log(`[${invocationId}] 🎯 Gemini returned:`, {
      title: listing.title?.slice(0, 60),
      metalType: listing.metalType,
      metalWeightOz: listing.metalWeightOz,
      price: listing.priceMin || listing.price?.amount,
      condition: listing.condition,
    });

    if (listing.title && listing.title.length > 80) {
      // Truncate at last complete word within 80 chars to avoid cutting mid-word
      listing.title = listing.title.substring(0, 80).replace(/\s+\S*$/, "")
        .trim();
    }

    // ── Anti-Novelty Guard ─────────────────────────────────────────────────
    // The AI occasionally prefixes the title with "NOVELTY REPLICA" or
    // "NOVELTY / FANTASY REPLICA" for legitimate certified coins (PCGS/NGC),
    // especially when it misreads the year and thinks the coin is impossible.
    // This is ALWAYS wrong for any coin in a professional grading slab.
    // Strip the novelty prefix deterministically from title AND description
    // whenever the domain is coins_bullion.
    // ── ────────────────────────────────────────────────────────────────────
    if (identification.domain === "coins_bullion") {
      // Strip from title: "NOVELTY REPLICA ...", "NOVELTY / FANTASY REPLICA ...", "NOVELTY ..."
      if (listing.title) {
        const titleBefore = listing.title as string;
        listing.title = titleBefore
          .replace(/^NOVELTY\s*[/&]?\s*FANTASY\s*REPLICA\s*/i, "")
          .replace(/^NOVELTY\s*REPLICA\s*/i, "")
          .replace(/^NOVELTY\s+/i, "")
          .replace(/^FANTASY\s*REPLICA\s*/i, "")
          .trim();
        if (listing.title !== titleBefore) {
          console.log(
            `[${invocationId}] Anti-Novelty: stripped novelty prefix from title: "${titleBefore}" -> "${listing.title}"`,
          );
        }
      }

      // Strip from description: the warning block the AI adds when it wrongly
      // classifies the coin as a novelty/fantasy replica.
      // Match multiple formats the AI has produced:
      // - "*** PLEASE READ CAREFULLY BEFORE PURCHASING ***... This is a NOVELTY..."
      // - "🚨 IMPORTANT... NOVELTY REPLICA..."
      // - "This is a NOVELTY / FANTASY item..."
      // - "This listing is for a NOVELTY..."
      if (listing.description) {
        const descBefore = listing.description as string;
        listing.description = descBefore
          // Format 1: "*** PLEASE READ... ***" block with NOVELTY disclaimer
          .replace(
            /\*{3,}\s*PLEASE READ[^]*?NOVELTY[^]*?(?:\*{3,}|\n\n)/gi,
            "",
          )
          // Format 2: emoji + IMPORTANT block
          .replace(
            /\u{1F6A8}\s*IMPORTANT[^]*?(?:All details are descriptions from seller\.|verified by the buyer\.)\s*/iu,
            "",
          )
          // Format 3: "This is a NOVELTY / FANTASY item..." paragraph
          .replace(
            /This is a NOVELTY[\s/&]*FANTASY[^]*?(?:\n\n|selling\.)/gi,
            "",
          )
          // Format 4: "This listing is for a NOVELTY..."
          .replace(
            /This listing is for a \*?NOVELTY[^]*?grading company\.[^\n]*/gi,
            "",
          )
          // Format 5: Any paragraph starting with NOVELTY disclaimer
          .replace(
            /\n\n\*{0,3}\s*PLEASE READ[^]*?NOVELTY[^]*?\.\s*\n/gi,
            "\n",
          )
          // Remove "NOT A GENUINE..." bullet points that often follow
          .replace(/\n\s*[•\-*]\s*\*?NOT[^\n]*\n/gi, "\n")
          .replace(/\n\s*[•\-*]\s*NOT REAL[^\n]*\n/gi, "\n")
          .replace(/\n\s*[•\-*]\s*NOT A GENUINE[^\n]*\n/gi, "\n")
          // Clean up multiple blank lines
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (listing.description !== descBefore) {
          console.log(
            `[${invocationId}] Anti-Novelty: stripped novelty disclaimer from description`,
          );
        }
      }
    }
    // ── End Anti-Novelty Guard ─────────────────────────────────────────────

    // ── Professional Tone Guard ─────────────────────────────────────────────
    // Strip emojis and em-dashes from title and description for a professional
    // eBay listing appearance. Em-dashes (—) become hyphens (-) or spaces.
    // This ensures a professional tone regardless of AI output.
    // ── ────────────────────────────────────────────────────────────────────
    if (listing.title) {
      const titleBefore = listing.title as string;
      // Remove emojis (common ranges)
      listing.title = titleBefore
        .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "")
        .replace(/\u{1F6A8}/gu, "") // police car light emoji specifically
        .replace(/[—–]/g, "-") // em-dash and en-dash -> hyphen
        .replace(/\s+/g, " ")
        .trim();
      if (listing.title !== titleBefore) {
        console.log(
          `[${invocationId}] ProfessionalTone: cleaned title (removed emojis/dashes)`,
        );
      }
    }
    if (listing.description) {
      const descBefore = listing.description as string;
      // Remove emojis (common ranges)
      listing.description = descBefore
        .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "")
        .replace(/\u{1F6A8}/gu, "") // police car light emoji specifically
        .replace(/[—–]/g, "-") // em-dash and en-dash -> hyphen
        .trim();

      // Strip markdown formatting that was used by AI internally but shouldn't be in eBay description
      // PRESERVE content, remove only markdown syntax
      listing.description = listing.description
        .replace(/^#+\s+/gm, "") // Remove header markers, keep header text
        .replace(/\*\*(.+?)\*\*/g, "$1") // Remove bold markdown (**text** -> text)
        .replace(/\*(.+?)\*/g, "$1") // Remove italic markdown (*text* -> text)
        .replace(/`(.+?)`/g, "$1") // Remove inline code markdown (`code` -> code)
        .replace(/^\s*[-*+]\s+/gm, "") // Remove markdown bullet points
        // Remove common AI section labels that leak into final text.
        .replace(
          /^\s*(?:opening\s*hook|what'?s\s*included|why\s*buy\s*this\s*item|what\s*sets\s*it\s*apart|key\s*details\s*(?:and\s*facts)?|condition\s*details|closing\s*statement|overall\s*condition|why\s*buy\s*this\s*lot|overview|additional\s*notes?)\s*[:\-–—]?\s*/gim,
          "",
        )
        .replace(/[ \t]+/g, " ") // Collapse spaces/tabs without flattening newlines
        .replace(/\n{3,}/g, "\n\n") // Clean up excessive newlines
        .trim();

      if (listing.description !== descBefore) {
        console.log(
          `[${invocationId}] ProfessionalTone: cleaned description (removed emojis/dashes/markdown)`,
        );
      }
    }
    // ── End Professional Tone Guard ─────────────────────────────────────────

    // --- Build suggestedCategories (dedupe, backfill names via exact DB lookup) ---
    try {
      const { buildSuggestedCategories } = await import(
        "../_helpers/suggestedCategories.ts"
      );
      listing.suggestedCategories = await buildSuggestedCategories(
        listing,
        svc,
      );
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
        if (
          lockedCategoryId &&
          !isCategoryCompatibleWithDomain(
            identification.domain,
            lockedCategoryId,
            lockedCategoryName,
            lockedBreadcrumb,
          )
        ) {
          console.warn(
            `analyze-item: releasing incompatible lock ${lockedCategoryId} for domain ${identification.domain}`,
          );
          lockedCategoryId = null;
          lockedCategoryName = null;
          lockedBreadcrumb = null;
        }

        // If we had a deterministic lock, the category is already verified
        if (lockedCategoryId && listing.ebayCategoryId !== lockedCategoryId) {
          // AI overrode the locked category — force it back (#3)
          const lockSource = userCategoryId ? "user-provided" : "deterministic lookup";
          console.warn(
            `analyze-item: AI overrode locked category ${lockedCategoryId} with ${listing.ebayCategoryId} — forcing lock back (source: ${lockSource})`,
          );
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
                body: JSON.stringify({
                  action: "verify",
                  categoryId: listing.ebayCategoryId,
                }),
              },
            );
            if (verifyResp.ok) {
              let verifyData: any;
              try {
                const verifyText = await verifyResp.text();
                verifyData = JSON.parse(verifyText);
              } catch {
                console.warn(
                  "analyze-item: category verify returned invalid JSON",
                );
                verifyData = {};
              }
              if (verifyData.isLeaf === false || verifyData.valid === false) {
                console.warn(
                  `analyze-item: AI category ${listing.ebayCategoryId} is NOT a valid leaf — attempting reselect`,
                );

                // Try alternatives from lookup
                let reselected = false;
                if (lookupAlternatives && lookupAlternatives.length > 0) {
                  for (const alt of lookupAlternatives) {
                    if (alt.categoryId !== listing.ebayCategoryId) {
                      console.log(
                        `analyze-item: reselecting to alternative ${alt.categoryId} (${
                          alt.categoryName || alt.breadcrumb
                        })`,
                      );
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
                    console.log(
                      `analyze-item: reselecting to suggested category ${fallback.categoryId}`,
                    );
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
      console.warn(
        "analyze-item: leaf validation failed (non-blocking):",
        validationErr,
      );
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
              body: JSON.stringify({
                action: "lookup",
                itemType: listing.title,
              }),
            },
          );
          if (postLookupResp.ok) {
            let postLookupData: any;
            try {
              const postLookupText = await postLookupResp.text();
              postLookupData = JSON.parse(postLookupText);
            } catch {
              console.warn("analyze-item: post-lookup returned invalid JSON");
              postLookupData = {};
            }
            if (postLookupData.found && postLookupData.verifiedLeaf !== false) {
              const postScore = postLookupData.effectiveScore ||
                postLookupData.confidence || 0;
              const postSource = postLookupData.source || "";
              const postIsLeaf = postLookupData.verifiedLeaf === true;

              // ── Define known Coins & Paper Money leaf IDs (and their tree prefix) ──
              // Any category that starts with these IDs or whose breadcrumb contains
              // "Coins & Paper Money" is in the right domain for coins_bullion items.
              const COINS_PAPER_MONEY_IDS = new Set([
                // Bullion
                "178906",
                "39489",
                "177652",
                "177653",
                "166679",
                "3361",
                "3360",
                "261064",
                "261068",
                "261069",
                "261070",
                "261071",
                "261072",
                "261073",
                "261074",
                "261075",
                "261076",
                "166680",
                "166681",
                // US Coins
                "253",
                "39464",
                "11980",
                "11981",
                "41102",
                "11973",
                "41099",
                "11971",
                "39455",
                "41084",
                "41109",
                "526",
                "11116",
                "11118",
                "40149",
                "40150",
                "40151",
                "40152",
                "40153",
                "40154",
                "40155",
                "40156",
                "40157",
                "40158",
                "40159",
                "40160",
                "41111",
                "164743",
                // US Gold Coins
                "40161",
                "40162",
                "40163",
                "40164",
                "40165",
                "40166",
                "40167",
                // World Coins
                "45243",
                "40196",
                "40197",
                "40198",
                "40199",
                "40200",
                "40201",
                "40202",
                "11063",
                // Paper Money
                "3411",
                "45244",
                // Ancient / Medieval
                "532",
                "173685",
                // Exonumia
                "19167",
                "19168",
                "19169",
              ]);

              // Categories that are in the completely wrong domain for a coin
              const KNOWN_WRONG_DOMAIN_FOR_COINS = new Set([
                "261186", // Books & Magazines > Books ← the exact bug we're fixing
                "268", // Books & Magazines (parent)
                "9355",
                "112529",
                "177",
                "179", // Electronics
                "11450", // Clothing
                "550", // Art
                "1", // Collectibles (too broad — coins should be more specific)
              ]);

              // Override AI's category if any of these conditions hold:
              // 1. The post-lookup found a verified leaf with high confidence
              // 2. The AI's current category is a known non-leaf parent
              // 3. DOMAIN MISMATCH: the identified domain is coins_bullion but the AI
              //    picked a category outside the Coins & Paper Money tree.
              //    In this case, ANY live lookup result is more trustworthy than the AI's pick.
              const KNOWN_PARENT_CATEGORIES = new Set([
                "253",
                "11118",
                "11233",
                "261076",
                "261074",
                "261075",
                "293",
                "1",
                "550",
                "631",
                "20713",
                "11450",
                "64482",
                "220",
              ]);
              const aiCategoryIsParent = KNOWN_PARENT_CATEGORIES.has(listing.ebayCategoryId);
              const postLookupIsStrong = postScore >= 80 && postIsLeaf;

              // Domain mismatch: Pass 1 said coins_bullion but AI chose a Books/Electronics/etc. category
              const isDomainMismatch = identification.domain === "coins_bullion" &&
                !COINS_PAPER_MONEY_IDS.has(listing.ebayCategoryId) &&
                (KNOWN_WRONG_DOMAIN_FOR_COINS.has(listing.ebayCategoryId) ||
                  (postLookupData.breadcrumb || "").toLowerCase().includes("coins"));

              if (aiCategoryIsParent || postLookupIsStrong || isDomainMismatch) {
                console.log(
                  `analyze-item: POST-LOOKUP override: AI picked ${listing.ebayCategoryId}, ` +
                    `post-lookup found ${postLookupData.categoryId} (${postLookupData.categoryName}, ` +
                    `score=${postScore}, source=${postSource}, leaf=${postIsLeaf}, ` +
                    `aiWasParent=${aiCategoryIsParent}, domainMismatch=${isDomainMismatch})`,
                );
                listing.ebayCategoryId = postLookupData.categoryId;
                listing.categoryId = postLookupData.categoryId;

                // Update suggestedCategories to put post-lookup winner first
                if (listing.suggestedCategories) {
                  listing.suggestedCategories.unshift({
                    categoryId: postLookupData.categoryId,
                    categoryName: postLookupData.categoryName,
                    breadcrumb: postLookupData.breadcrumb ||
                      postLookupData.categoryName,
                    reason: `Post-lookup verified (score=${postScore}, source=${postSource})`,
                  });
                  // Dedupe
                  const seenIds = new Set<string>();
                  listing.suggestedCategories = listing.suggestedCategories
                    .filter((s: any) => {
                      if (seenIds.has(s.categoryId)) return false;
                      seenIds.add(s.categoryId);
                      return true;
                    }).slice(0, 3);
                }

                // Also update alternatives for any future reselection
                if (
                  postLookupData.alternatives &&
                  postLookupData.alternatives.length > 0
                ) {
                  lookupAlternatives = postLookupData.alternatives;
                }
              }
            } else if (
              // Post-lookup returned nothing (or low confidence), BUT domain mismatch is clear —
              // last-resort: the AI picked a wrong-domain category for a coin item.
              // Fall back to the safest known world-coin category rather than leaving Books/Electronics.
              identification.domain === "coins_bullion" &&
              listing.ebayCategoryId &&
              (["261186", "268"].includes(listing.ebayCategoryId) ||
                (!listing.ebayCategoryId.match(/^(3[0-9]|4[0-9]|1[0-9]|2[0-9]|45243|532|173685)/) &&
                  parseInt(listing.ebayCategoryId) > 200000))
            ) {
              console.warn(
                `analyze-item: DOMAIN-MISMATCH SAFETY: coins_bullion item but AI returned category ${listing.ebayCategoryId} ` +
                  `and post-lookup found nothing — forcing fallback to World Coins (45243)`,
              );
              listing.ebayCategoryId = "45243";
              listing.categoryId = "45243";
            }
          }
        }
      }
    } catch (postLookupErr) {
      console.warn(
        "analyze-item: category post-lookup failed (non-blocking):",
        postLookupErr,
      );
    }
    // --- end post-lookup ---

    // --- Resync metadata to the final category so UI aspects match the chosen category ---
    if (
      listing.ebayCategoryId &&
      listing.ebayCategoryId !== fetchedMetadataCategoryId
    ) {
      const _metadataUrl = Deno.env.get("SUPABASE_URL");
      const _metadataKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (_metadataUrl && _metadataKey) {
        try {
          const aspectsResp = await fetch(
            `${_metadataUrl}/functions/v1/category-lookup`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${_metadataKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "aspects",
                categoryId: listing.ebayCategoryId,
              }),
            },
          );
          if (aspectsResp.ok) {
            categoryAspects = await aspectsResp.json();
          }
        } catch (aspectErr) {
          console.warn(
            `[${invocationId}] analyze-item: final-category aspects fetch failed (non-blocking):`,
            aspectErr,
          );
        }

        try {
          const conditionsResp = await fetch(
            `${_metadataUrl}/functions/v1/category-lookup`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${_metadataKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "conditions",
                categoryId: listing.ebayCategoryId,
              }),
            },
          );
          if (conditionsResp.ok) {
            categoryConditions = await conditionsResp.json();
          }
        } catch (condErr) {
          console.warn(
            `[${invocationId}] analyze-item: final-category conditions fetch failed (non-blocking):`,
            condErr,
          );
        }

        fetchedMetadataCategoryId = listing.ebayCategoryId;
        console.log(
          `[${invocationId}] analyze-item: resynced metadata to final category ${listing.ebayCategoryId}`,
        );
      }
    }

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
            const catName = listing.suggestedCategories?.[0]?.categoryName ||
              listing.suggestedCategories?.[0]?.breadcrumb?.split(" > ")
                .pop() ||
              null;
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
                },
              );
              console.log(
                `analyze-item: submitted category ${listing.ebayCategoryId} for "${titleWords}" to category-lookup store (gated)`,
              );
            }
          }
        }
      }
    } catch (persistErr) {
      console.warn(
        "analyze-item: category auto-persist failed (non-blocking):",
        persistErr,
      );
    }
    // --- end auto-persist ---

    // ─── POST-PASS: Focused Detail Extraction & Override ────────────────────
    // Runs a dedicated, domain-specific vision pass that focuses ONLY on
    // high-value identification details the main model frequently misses:
    //   • Coins: mint marks, key dates, die varieties
    //   • Trading Cards: set, parallel, serial number, rookie status
    //   • Jewelry: hallmarks, brand signatures, karat
    // Findings are AUTHORITATIVE and OVERRIDE the main model's output.
    try {
      const { extractKeyDetails, applyDetailOverrides } = await import(
        "../_helpers/detailExtractor.ts"
      );

      // Build image lists for the detail extractor — use ALL images
      const detailBase64List: string[] = [];
      const detailMimeList: string[] = [];
      for (const img of imageList) {
        const detB64 = img.includes(",") ? img.split(",")[1] : img;
        const detMimeMatch = img.match(/^data:(image\/\w+);/);
        detailBase64List.push(detB64);
        detailMimeList.push(detMimeMatch ? detMimeMatch[1] : "image/jpeg");
      }

      const detailResult = await extractKeyDetails(
        GEMINI_API_KEY,
        identification.domain as any,
        listing.title || identification.itemName,
        detailBase64List,
        detailMimeList,
        invocationId,
      );

      if (detailResult) {
        applyDetailOverrides(listing, detailResult, invocationId);
        console.log(
          `[${invocationId}] ✓ Detail extraction applied (domain=${detailResult.domain})`,
        );
      } else {
        console.log(
          `[${invocationId}] Detail extraction returned null (domain=${identification.domain}) — no overrides`,
        );
      }
    } catch (detailErr) {
      console.warn(
        `[${invocationId}] Detail extraction failed (non-blocking):`,
        String(detailErr),
      );
    }
    // ─── END POST-PASS ─────────────────────────────────────────────────────

    // ─── POST-AI competitor search: Fetch with AI-generated title ─────────────
    // This runs AFTER Gemini generates a better title. Use full title for accuracy.
    // If pre-AI failed/returned 0, this provides fallback data for response.
    // If pre-AI succeeded, post-AI data can be compared/enhanced.
    {
      if (listing.title && userId) {
        try {
          console.log(
            `[${invocationId}] Post-AI competitor search with title: "${listing.title.substring(0, 60)}..."`,
          );
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
            },
          );

          console.log(
            `[${invocationId}] Post-AI competitor response status: ${competitorResp.status}`,
          );

          if (competitorResp.ok) {
            try {
              const compRespText = await competitorResp.text();
              const postAICompData = JSON.parse(compRespText);

              const postAICount = postAICompData?.competitorCount || 0;
              const preAICount = preAICompetitorData?.competitorCount || 0;

              console.log(
                `[${invocationId}] Post-AI comps complete: count=${postAICount}, avg=$${
                  postAICompData?.avgPrice?.toFixed(2)
                }, median=$${postAICompData?.medianPrice?.toFixed(2)}`,
              );

              // Fallback logic: Use post-AI if pre-AI failed/returned 0
              if (!competitorData || competitorDataSource === "none") {
                competitorData = postAICompData;
                competitorDataSource = "post-ai";
                console.log(
                  `[${invocationId}] Using post-AI comps as primary (pre-AI was empty/failed)`,
                );
              } else if (postAICount > preAICount) {
                // Post-AI found more competitors — prefer it for response
                console.log(
                  `[${invocationId}] Post-AI comps found more results (${postAICount} vs ${preAICount}); using post-AI for response`,
                );
                competitorData = postAICompData;
                competitorDataSource = "post-ai";
              } else {
                // Pre-AI is still primary but log that post-AI returned data
                console.log(
                  `[${invocationId}] Keeping pre-AI comps (${preAICount} results); post-AI returned ${postAICount}`,
                );
              }
            } catch (jsonErr) {
              console.warn(
                `[${invocationId}] Post-AI competitor JSON parse failed:`,
                jsonErr,
              );
            }
          } else {
            const errText = await competitorResp.text();
            console.warn(`[${invocationId}] Post-AI competitor search failed:`, {
              status: competitorResp.status,
              error: errText.substring(0, 200),
            });
          }
        } catch (compErr) {
          console.warn(
            `[${invocationId}] Post-AI competitor fetch error (non-blocking):`,
            compErr,
          );
        }
      } else {
        console.log(
          `[${invocationId}] Skipping post-AI competitor search (title=${!!listing.title}, userId=${!!userId})`,
        );
      }
    }
    // ─── END post-AI competitor search ────────────────────────────────────────

    // --- Server-side melt value enforcement ---
    let meltValue: number | null = null;
    console.log(
      `[${invocationId}] 💰 Melt check: metalType=${listing.metalType}, weight=${listing.metalWeightOz}, spotGold=${spotGold}`,
    );
    if (
      listing.metalType && listing.metalType !== "none" &&
      listing.metalWeightOz > 0
    ) {
      const spotPrice = listing.metalType === "gold"
        ? spotGold
        : listing.metalType === "silver"
        ? spotSilver
        : listing.metalType === "platinum"
        ? spotPlatinum
        : 0;
      if (spotPrice > 0) {
        meltValue = parseFloat((spotPrice * listing.metalWeightOz).toFixed(2));
        // Enforce: priceMin must never be below melt value PLUS eBay fees.
        // ~13.25% FVF + ~2.9% payment processing = ~16% total fees. Use 1.19x for margin.
        const feeAdjustedFloor = parseFloat((meltValue * 1.19).toFixed(2));
        console.log(
          `[${invocationId}] 🔒 Melt floor: meltValue=$${meltValue}, feeAdjustedFloor=$${feeAdjustedFloor}, priceMin=$${listing.priceMin}`,
        );
        if (listing.priceMin < feeAdjustedFloor) {
          console.log(
            `[${invocationId}] ⚠️  Price below melt floor! Correcting: $${listing.priceMin} → $${feeAdjustedFloor}`,
          );
          listing.priceMin = feeAdjustedFloor;
          // Also bump priceMax if it's somehow below the floor
          if (listing.priceMax < feeAdjustedFloor) {
            listing.priceMax = parseFloat((feeAdjustedFloor * 1.1).toFixed(2));
          }
        } else {
          console.log(
            `[${invocationId}] ✓ Price above melt floor, no correction needed`,
          );
        }
      }
    } else if (
      listing.metalType && listing.metalType !== "none" &&
      listing.metalWeightOz <= 0
    ) {
      // SAFETY NET: If metalType is detected but weight is missing/zero, enforce conservative minimum
      // This prevents Gemini from pricing gold coins at $8 when weight extraction fails
      const minPrice = listing.metalType === "gold"
        ? 100
        : listing.metalType === "silver"
        ? 20
        : listing.metalType === "platinum"
        ? 150
        : 0;

      if (minPrice > 0 && listing.priceMin < minPrice) {
        console.warn(
          `[${invocationId}] 🛡️  SAFETY NET activated: ${listing.metalType} detected (weight=${listing.metalWeightOz}). Setting minimum: $${listing.priceMin} → $${minPrice}`,
        );
        listing.priceMin = minPrice;
        if (listing.priceMax < minPrice) {
          listing.priceMax = parseFloat((minPrice * 1.5).toFixed(2));
        }
      }
    } else {
      console.log(
        `[${invocationId}] ℹ️  No melt check: metalType=${listing.metalType}, weight=${listing.metalWeightOz}`,
      );
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
      "title",
      "description",
      "condition",
      "conditionDescription",
      "ebayCategoryId",
      "suggestedCategories",
      "itemSpecifics",
      "suggestedGrade",
      "packageWeightAndSize",
      "domain",
      // Agentic Pre-Pass 0 fields (available on all tiers — no pricing info)
      "market_analysis",
      "grounded_category_id",
      "agentic_inspection",
      // Locked to paid: priceMin, priceMax, meltValue, spotPrices, pricingNotes, gradingRationale, competitorData
    ]);

    // ─ Assemble agentic fields from Pre-Pass 0 (additive — never replace existing fields) ─
    const agenticFields: {
      market_analysis?: string | null;
      grounded_category_id?: string | null;
      agentic_inspection?: {
        zoom_regions_examined: string[];
        key_findings: string;
        confidence_boost: number;
        identification_correction?: string;
      } | null;
    } = {};
    if (prePassResult) {
      agenticFields.market_analysis = prePassResult.marketAnalysis;
      agenticFields.grounded_category_id = prePassResult.groundedCategoryId;
      if (prePassResult.agenticInspection) {
        agenticFields.agentic_inspection = {
          zoom_regions_examined: prePassResult.agenticInspection.zoomRegionsExamined,
          key_findings: prePassResult.agenticInspection.keyFindings,
          confidence_boost: prePassResult.agenticInspection.confidenceBoost,
          identification_correction: prePassResult.agenticInspection.identificationCorrection,
        };
      } else {
        agenticFields.agentic_inspection = null;
      }
    }

    // --- Post-process competitor data for response ─────────────────────────────
    // Always include competitor data if available (even if 0 competitors found)
    if (competitorData) {
      listing.competitorData = {
        competitorCount: competitorData.competitorCount || 0,
        avgPrice: competitorData.avgPrice || 0,
        minPrice: competitorData.minPrice || 0,
        maxPrice: competitorData.maxPrice || 0,
        medianPrice: competitorData.medianPrice || 0,
        fromCache: competitorData.fromCache || false,
      };
      console.log(
        `[${invocationId}] Final response includes competitor data from ${competitorDataSource}: ${competitorData.competitorCount} competitors`,
      );
    } else {
      console.log(
        `[${invocationId}] No competitor data available for response (pre-AI and post-AI both failed or returned 0)`,
      );
    }

    let responsePayload = {
      ...listing,
      meltValue,
      spotPrices: {
        gold: spotGold,
        silver: spotSilver,
        platinum: spotPlatinum,
      },
    };
    if (tier === "starter") {
      responsePayload = Object.fromEntries(
        Object.entries(responsePayload).filter(([k]) => FREE_TIER_ALLOWED_FIELDS.has(k)),
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

    // Build eBay metadata so the frontend can use real aspects/conditions
    const ebayMetadata = (categoryAspects || categoryConditions)
      ? {
        requiredAspects: categoryAspects?.aspects
          ?.filter((a: any) => a.required)
          .map((a: any) => a.name) ?? [],
        suggestedAspects: categoryAspects?.aspects
          ?.filter((a: any) => !a.required)
          .map((a: any) => a.name) ?? [],
        allowedConditions: categoryConditions?.conditions
          ?.map((c: any) => c.conditionDescription || String(c.conditionId)) ??
          [],
      }
      : null;

    const finalResponse = {
      ...responsePayload,
      // Agentic Pre-Pass 0 fields (new — additive, backward compatible)
      ...agenticFields,
      ...(ebayMetadata ? { _ebayMetadata: ebayMetadata } : {}),
      _meta: {
        tier,
        creditsUsed: creditsUsed,
        creditsRemaining: creditsRemaining,
        creditsResetAt: creditsResetAt,
      },
    };

    // ─── FINAL RESPONSE LOGGING (for diagnostics) ──────────────────────────────
    console.log(`[${invocationId}] 📊 FINAL RESPONSE PRICING & METALS:`, {
      title: finalResponse.title?.slice(0, 60),
      domain: finalResponse.domain,
      metalType: finalResponse.metalType,
      metalWeightOz: finalResponse.metalWeightOz,
      meltValue: finalResponse.meltValue,
      priceMin: finalResponse.priceMin,
      priceMax: finalResponse.priceMax,
      pricingNotes: finalResponse.pricingNotes?.slice(0, 80),
      competitorCount: finalResponse.competitorData?.competitorCount,
      competitorAvg: finalResponse.competitorData?.avgPrice,
      competitorMedian: finalResponse.competitorData?.medianPrice,
      competitorSource: competitorDataSource,
    });
    // ─── END FINAL RESPONSE LOGGING ──────────────────────────────────────────

    console.log(
      `[${invocationId}] ✅ analyze-item COMPLETE (${Date.now() - startTime}ms)`,
    );

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(
      `[${invocationId}] ❌ analyze-item FAILED after ${elapsed}ms:`,
      e,
    );
    if (e instanceof Error) {
      console.error(`[${invocationId}] Error name: ${e.name}`);
      console.error(`[${invocationId}] Error message: ${e.message}`);
      console.error(
        `[${invocationId}] Error stack:`,
        e.stack?.split("\n").slice(0, 5).join("\n"),
      );
    }
    captureException(e, { function: "analyze-item", invocationId });

    const errorMsg = e instanceof Error ? e.message : String(e);
    const errorResponse = {
      error: errorMsg,
      invocationId,
      timestamp: new Date().toISOString(),
    };
    console.error(
      `[${invocationId}] 📤 Returning error response:`,
      errorResponse,
    );

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
