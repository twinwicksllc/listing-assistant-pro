import { fetchWithTimeout } from "./fetch.ts";
import { corsHeaders } from "./constants.ts";
import { assertCallerOwnsUser } from "./supabase.ts";
import { fetchEbayVideoStatus } from "./video.ts";
import { buildEbayJsonHeaders } from "./publish.ts";
import {
  type ConditionDescriptorSelection,
  resolvePolicyCondition,
  validateConditionSelection,
} from "../_helpers/conditionPolicy.ts";
import {
  buildAndNormalizeAspects,
  buildCoinConditionDescriptors,
  buildFixedPriceOffer,
  buildListingUrl,
  buildPackageWeightAndSize,
  CATEGORY_ASPECT_RULES,
  categoryAcceptsCondition,
  type CoinConditionDetail,
  EBAY_CONDITION_ID_GRADED,
  ensureInventoryLocation,
  fetchCoinConditionDescriptors,
  fetchCurrentConditionPolicy,
  generateDraftSku,
  getMissingAspectNameFromEbayErrors,
  getMissingRequiredAspects,
  HARDCODED_COIN_CATEGORY_IDS,
  isGrainBar,
  normalizeCoinConditionDetail,
  prepareListingDescription,
  resolveAspectCategory,
  resolveCategoryTreeType,
  resolveDraftBusinessPolicies,
  resolveDraftImageUrls,
  verifyOrRerouteLeafCategory,
} from "./publish-helpers.ts";

export interface CreateDraftContext {
  req: Request;
  payload: Record<string, unknown>;
  apiBase: string;
  ebayEnv: string;
  clientId?: string;
  clientSecret?: string;
}

function isConditionDescriptorSelection(value: unknown): value is ConditionDescriptorSelection[] {
  return Array.isArray(value) && value.every((descriptor: unknown) => {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return false;
    const candidate = descriptor as Record<string, unknown>;
    return typeof candidate.name === "string" && candidate.name.trim().length > 0 &&
      (candidate.values === undefined ||
        (Array.isArray(candidate.values) && candidate.values.every((entry: unknown) => typeof entry === "string"))) &&
      (candidate.additionalInfo === undefined || typeof candidate.additionalInfo === "string");
  });
}

/**
 * Publish a single draft to eBay: builds inventory item + offer, ensures
 * location/policies, applies category-aware condition/aspect normalization,
 * and publishes the offer live.
 */
export async function handleCreateDraft({
  req,
  payload,
  apiBase,
  ebayEnv,
  clientId,
  clientSecret,
}: CreateDraftContext): Promise<Response> {
  const {
    userId,
    userToken,
    sku: incomingSku,
    title,
    description,
    listingFormat,
    listingPrice,
    auctionStartPrice,
    auctionBuyItNow,
    auctionDuration,
    imageUrl,
    imageUrls,
    condition,
    ebayCategoryId,
    itemSpecifics,
    postalCode,
    city: payloadCity,
    fulfillmentPolicyId: draftFulfillmentPolicyId,
    paymentPolicyId: draftPaymentPolicyId,
    returnPolicyId: draftReturnPolicyId,
    bestOfferEnabled,
    bestOfferAutoAcceptPrice,
    bestOfferAutoDeclinePrice,
    quantity: payloadQuantity,
    pricingMode,
    ebayVideoId: payloadEbayVideoId,
    packageWeightAndSize: payloadPackageWeightAndSize,
  } = payload;

  if (!userToken) throw new Error("No eBay user token provided");

  // Security: verify caller owns this userId before allowing SKU generation and RPC calls
  if (userId) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseServiceKey) {
      await assertCallerOwnsUser(
        req,
        String(userId),
        supabaseUrl,
        supabaseServiceKey,
      );
    }
  }

  console.log(
    `create_draft: starting publish - title="${title}", format=${listingFormat}, env=${ebayEnv}`,
  );
  console.log(`create_draft: received condition from payload: ${condition}`);
  console.log(
    `create_draft: postalCode from payload:`,
    postalCode,
    `city from payload:`,
    payloadCity,
  );
  console.log(
    `create_draft: _debug_postalCode:`,
    payload._debug_postalCode,
    `_debug_city:`,
    payload._debug_city,
  );
  console.log(
    `create_draft: received ebayCategoryId=${ebayCategoryId}, condition=${condition}, itemSpecifics=${
      JSON.stringify(
        itemSpecifics || {},
      )
    }`,
  );
  console.log(
    `create_draft: itemSpecifics received:`,
    JSON.stringify(itemSpecifics || {}, null, 2),
  );

  const sku = await generateDraftSku(incomingSku, userId);

  console.log(`create_draft: sku=${sku}`);

  // ----------------------------------------------------------------
  // GRAIN BAR CATEGORY OVERRIDE
  // eBay policy (errorId 25019) requires all grain bars to be listed in
  // category 3360 (Coins & Paper Money > Bullion > Gold > Other).
  // Detect grain bars by checking title/description for "grain" keywords.
  // ----------------------------------------------------------------
  let finalCategoryId = String(ebayCategoryId ?? "");
  if (isGrainBar(title as string, description as string | undefined)) {
    finalCategoryId = "3360"; // Coins & Paper Money > Bullion > Gold > Other
    console.log(
      `create_draft: GRAIN BAR DETECTED - overriding category ${ebayCategoryId} -> ${finalCategoryId}`,
    );
  }

  // ── Graded world coin re-route ─────────────────────────────────────────
  // eBay category 45243 ("Coins: World") is a ROLLUP/parent category that
  // does NOT accept the "Graded" condition (LIKE_NEW / conditionId 2750).
  // Publishing a slabbed NGC/PCGS coin there fails with
  // "publish failed with invalid condition for category 45243", and no raw
  // condition fallback can save it. The correct home for a graded world coin
  // is a graded-friendly LEAF category (which supports the Grade item
  // specific + condition 2750). We map based on Country of Origin, defaulting
  // to the generic Coins: World catch-all leaf (257 — confirmed live leaf;
  // 256 was previously used here but is itself a non-leaf rollup, confirmed
  // absent from ebay_taxonomy_cache, Finding B) when the country is unknown.
  {
    const _rerouteIS = itemSpecifics && typeof itemSpecifics === "object"
      ? (itemSpecifics as Record<string, unknown>)
      : {};
    const _rerouteCcd = _rerouteIS._coinConditionDetail as { type?: string } | null | undefined;
    const _rerouteCert = typeof _rerouteIS.Certification === "string"
      ? (_rerouteIS.Certification as string)
      : undefined;
    const _rerouteGraded = _rerouteCcd?.type === "graded" ||
      String(condition ?? "").toUpperCase() === "LIKE_NEW" ||
      (!!_rerouteCert &&
        _rerouteCert.trim().toLowerCase() !== "uncertified" &&
        _rerouteCert.trim() !== "");

    // Parent world-coin categories that reject the Graded (2750) condition.
    // RETAINED AS A BACKUP/OFFLINE PATH. The authoritative check is now the
    // dynamic `categoryAcceptsCondition()` probe below, which asks eBay
    // directly instead of relying on this list staying current.
    const GRADED_UNFRIENDLY_WORLD_PARENTS = new Set(["45243", "256"]);

    // ── Dynamic condition-capability gate ───────────────────────────────
    // Ask eBay whether this category actually accepts the Graded (2750)
    // condition rather than trusting the hardcoded set above. This catches
    // rollups we have never hit in production and automatically adapts if
    // eBay changes a category's policy.
    //
    // Resolution:
    //   false → eBay says 2750 is NOT accepted, reroute (even if not listed)
    //   true  → eBay says 2750 IS accepted, do NOT reroute
    //   null  → unknown (no creds / API error); fall back to the hardcoded set
    //
    // Costs no extra API calls in practice: the response is cached and the
    // same endpoint is already called moments later for conditionDescriptors.
    let _acceptsGraded: boolean | null = null;
    if (_rerouteGraded && clientId && clientSecret) {
      _acceptsGraded = await categoryAcceptsCondition(
        finalCategoryId,
        EBAY_CONDITION_ID_GRADED,
        clientId,
        clientSecret,
        apiBase,
      );
      console.log(
        `create_draft: dynamic graded-condition check for category ${finalCategoryId}: ${
          _acceptsGraded === null
            ? "UNKNOWN (falling back to static list)"
            : _acceptsGraded
            ? "ACCEPTS 2750"
            : "REJECTS 2750"
        }`,
      );
    }

    const _needsGradedReroute = _acceptsGraded === false ||
      (_acceptsGraded === null && GRADED_UNFRIENDLY_WORLD_PARENTS.has(finalCategoryId));

    if (_rerouteGraded && _needsGradedReroute) {
      const country = (
        typeof _rerouteIS["Country of Origin"] === "string" ? (_rerouteIS["Country of Origin"] as string) : ""
      )
        .trim()
        .toLowerCase();

      // South Pacific leaf (3392): Cook Islands, Fiji, Niue, Palau, Tuvalu,
      // Tokelau, Samoa, Solomon Islands, Kiribati, Nauru, Vanuatu, Tonga.
      const SOUTH_PACIFIC_COUNTRIES = new Set([
        "cook islands",
        "fiji",
        "niue",
        "palau",
        "tuvalu",
        "tokelau",
        "samoa",
        "solomon islands",
        "kiribati",
        "nauru",
        "vanuatu",
        "tonga",
      ]);

      const rerouteTarget = SOUTH_PACIFIC_COUNTRIES.has(country)
        ? "3392" // Coins: World > South Pacific
        : "257"; // Coins: World > Other Coins of the World — confirmed live leaf, safe default

      console.log(
        `create_draft: GRADED WORLD COIN in graded-unfriendly category ${finalCategoryId} — re-routing to ${rerouteTarget} (country="${
          country || "unknown"
        }", detectedBy=${
          _acceptsGraded === false ? "eBay condition policy" : "static fallback list"
        }) so the Graded condition (2750) is accepted`,
      );
      finalCategoryId = rerouteTarget;
    }
  }

  // ── UNIVERSAL LEAF-CATEGORY GUARD (last line of defense, any domain) ──
  // analyze-item runs several best-effort leaf checks upstream, but every
  // one of them is non-blocking, and a manually-edited draft can also carry
  // whatever category id the user last picked in the dropdown. Verify
  // finalCategoryId against eBay's live/cached taxonomy HERE, immediately
  // before it is used to build aspects/conditions/offer, so a non-leaf
  // rollup (e.g. category 212 "Sports Trading Cards", or any other
  // domain's rollup we've never seen before) is caught and rerouted BEFORE
  // eBay's API ever sees it — rather than eBay rejecting the publish with
  // "invalid data ... provided condition id is invalid for the selected
  // primary category id" after the fact. This check is intentionally
  // domain-agnostic (no card/coin/jewelry-specific logic) so it works for
  // any category, per the requirement that this fix must not be limited to
  // any single vertical.
  if (finalCategoryId) {
    const leafCheck = await verifyOrRerouteLeafCategory(finalCategoryId, String(title ?? ""));
    console.log(
      `create_draft: leaf category check for ${finalCategoryId} — isLeaf=${leafCheck.isLeaf}, changed=${leafCheck.changed}, reason=${leafCheck.reason}`,
    );
    if (leafCheck.changed) {
      finalCategoryId = leafCheck.categoryId;
    } else if (leafCheck.isLeaf === false) {
      return new Response(
        JSON.stringify({
          error:
            `The selected eBay category (${finalCategoryId}) is not a valid, listable leaf category and no verified ` +
            `replacement could be found. Please choose a more specific category before publishing. (${leafCheck.reason})`,
          invalidCategory: true,
          categoryId: finalCategoryId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  }

  // Build eBay-formatted item specifics (aspects) using the category-aware
  // normalisation engine. This handles:
  //   - C: prefix normalisation (AI may omit it)
  //   - Fineness format: "999 fine" / "99.9%" -> "0.999"
  //   - Grade format: "MS-65" -> "MS 65"
  //   - Denomination: "Half Dollar" -> "50C", "One Dollar" -> "$1"
  //   - Circulated/Uncirculated: derived from grade if missing
  //   - Required aspect safety-fill (Certification, Circulated/Uncirculated)
  //   - Fixed values for known categories (Composition, Fineness for silver dollars, etc.)
  //   - Drops placeholder values (none / unknown / n/a / other / etc.)

  const { categoryForAspects, dynamicRuleApplied } = await resolveAspectCategory(String(finalCategoryId ?? ""));
  const aspectRule = CATEGORY_ASPECT_RULES[categoryForAspects];

  let aspects: Record<string, string[]>;
  try {
    aspects = buildAndNormalizeAspects(
      (itemSpecifics && typeof itemSpecifics === "object" ? itemSpecifics : {}) as Record<string, unknown>,
      categoryForAspects,
      aspectRule,
    );
  } finally {
    // Clean up temporary dynamic rule from the map even if aspect normalization throws.
    if (dynamicRuleApplied) {
      delete CATEGORY_ASPECT_RULES[categoryForAspects];
    }
  }

  console.log(
    `create_draft: aspects built for category ${finalCategoryId}:`,
    JSON.stringify(aspects, null, 2),
  );

  // ── Coin-condition → Certification aspect bridge ────────────────────────
  // If no Certification aspect was resolved (not in itemSpecifics, not in dynamic
  // or hardcoded defaults), derive it from _coinConditionDetail.
  // Covers any coin/bullion category where eBay requires Certification but the
  // category-level defaults did not set it.
  if (!aspects["Certification"]) {
    const _bridgeIS = itemSpecifics && typeof itemSpecifics === "object"
      ? (itemSpecifics as Record<string, unknown>)
      : {};
    const _ccd = _bridgeIS._coinConditionDetail as { type?: string; graded?: { company?: string } } | null | undefined;
    if (_ccd) {
      if (_ccd.type === "graded" && _ccd.graded?.company) {
        aspects["Certification"] = [_ccd.graded.company];
        console.log(
          `create_draft: bridged Certification="${_ccd.graded.company}" from graded coin condition detail`,
        );
      } else if (_ccd.type === "raw") {
        aspects["Certification"] = ["Uncertified"];
        console.log(
          `create_draft: bridged Certification="Uncertified" from raw coin condition detail`,
        );
      }
    }
  }

  // Get the final normalized certification value from aspects (already normalized above)
  const finalCertValue = aspects["Certification"]?.[0];

  const { finalTitle, htmlDescription } = prepareListingDescription(
    title as string,
    description as string,
    finalCertValue,
  );

  // Extract the item Type (e.g., "Coin", "Round", "Bar") from itemSpecifics
  // This is used to disambiguate coins from bullion when validating conditions
  const itemType = itemSpecifics && typeof itemSpecifics === "object"
    ? ((itemSpecifics as Record<string, unknown>).Type as string | undefined)
    : undefined;

  const packageWeightAndSize = buildPackageWeightAndSize(
    payloadPackageWeightAndSize,
    itemSpecifics,
  );

  const categoryTreeType = await resolveCategoryTreeType(
    finalCategoryId,
    itemType,
  );

  const rawCondition = condition === null || condition === undefined ? "" : String(condition).trim();
  const conditionPolicy = await fetchCurrentConditionPolicy(
    finalCategoryId,
    String(userId ?? ""),
  );
  if (conditionPolicy.status !== "available") {
    return new Response(
      JSON.stringify({
        error: `Unable to verify eBay condition policy for category ${finalCategoryId}. ${
          conditionPolicy.reason ?? "Please try again."
        }`,
        conditionPolicyUnavailable: true,
        sku,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const selectedPolicyCondition = resolvePolicyCondition(conditionPolicy, rawCondition);
  if (rawCondition && !selectedPolicyCondition) {
    return new Response(
      JSON.stringify({
        error:
          `The selected condition "${rawCondition}" is not supported for eBay category ${finalCategoryId}. Choose a condition offered for this category and try again.`,
        invalidCondition: true,
        sku,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (selectedPolicyCondition && !selectedPolicyCondition.conditionEnum) {
    return new Response(
      JSON.stringify({
        error:
          `The selected eBay condition "${selectedPolicyCondition.conditionDescription}" has no supported Inventory API mapping. Choose another condition or contact support.`,
        invalidCondition: true,
        sku,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (
    selectedPolicyCondition &&
    !/^\d+$/.test(selectedPolicyCondition.conditionId)
  ) {
    return new Response(
      JSON.stringify({
        error:
          `The eBay condition policy for category ${finalCategoryId} contains an invalid condition ID. Refresh the category and try again.`,
        conditionPolicyUnavailable: true,
        sku,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const conditionEnum = selectedPolicyCondition?.conditionEnum ?? "";
  const conditionId = selectedPolicyCondition ? Number(selectedPolicyCondition.conditionId) : undefined;
  const effectiveConditionEnum = conditionEnum;
  const effectiveConditionId = conditionId;
  const conditionDesc = selectedPolicyCondition?.conditionDescription ?? "";
  if (!rawCondition) {
    const omission = validateConditionSelection(conditionPolicy, finalCategoryId, "");
    if (!omission.valid) {
      return new Response(
        JSON.stringify({
          error: `A condition is required for eBay category ${finalCategoryId}. ${omission.errors.join("; ")}`,
          invalidCondition: true,
          sku,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  console.log(
    `create_draft: condition policy selected=${conditionEnum || "omitted"}, conditionId=${
      conditionId ?? "omitted"
    }, categoryId=${finalCategoryId}`,
  );

  // NOTE: Accept-Language must be explicitly set to "en-US".
  // Deno's runtime auto-injects the system locale when this header is omitted,
  // sending an invalid value that eBay rejects with errorId 25709.
  // Explicitly providing "en-US" overrides Deno's injected value.
  const authHeaders = buildEbayJsonHeaders(userToken);

  // Step 1: Ensure inventory location exists before creating the item.
  // The item's shipToLocationAvailability references this location by key,
  // so it must exist first.
  // Step 2: Create/update inventory item (PUT is idempotent — safe to retry)
  // NOTE: description goes in the OFFER (listingDescription), not the inventory item.
  // The inventory item holds product data; the offer holds listing-specific data.

  const resolvedImageUrls = await resolveDraftImageUrls(imageUrl, imageUrls);

  // IMPORTANT: condition and conditionDescription belong at the ROOT level
  // of the inventory item body, NOT inside product. Placing them inside product
  // causes eBay error 25021 ("Item condition is required for this category")
  // at publish time, even though the offer creation succeeds.
  // Reference: https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
  const inventoryBody: Record<string, unknown> = {
    product: {
      title: finalTitle,
      imageUrls: resolvedImageUrls,
    },
    ...(conditionEnum ? { condition: conditionEnum, conditionDescription: conditionDesc } : {}),
    packageWeightAndSize,
    availability: {
      // shipToLocationAvailability: use only the top-level quantity.
      // availabilityDistributions is for multi-warehouse sellers and causes
      // eBay error 25604 ("Availability not found") for standard single-location accounts.
      shipToLocationAvailability: {
        quantity: Number(payloadQuantity) || 1,
      },
    },
  };

  // ── Trading card: inject Card Condition item specific (eBay errorId 40001) ────
  // eBay requires "Card Condition" as an item specific for trading card categories
  // even though the Sell form marks it optional. Derive from effectiveConditionEnum
  // if the AI/user did not already supply it in itemSpecifics.
  if (categoryTreeType === "trading_card" && !aspects["Card Condition"]) {
    const CARD_CONDITION_MAP: Record<string, string> = {
      USED_VERY_GOOD: "Very Good",
      USED_GOOD: "Good",
      USED_ACCEPTABLE: "Poor",
    };
    const cardCond = CARD_CONDITION_MAP[effectiveConditionEnum];
    if (cardCond) {
      aspects["Card Condition"] = [cardCond];
      console.log(
        `create_draft: injected Card Condition="${cardCond}" for trading card category ${finalCategoryId} (condition=${effectiveConditionEnum})`,
      );
    }
  }

  const missingRequiredAspects = getMissingRequiredAspects(
    aspects,
    aspectRule?.required ?? [],
  );
  if (missingRequiredAspects.length > 0) {
    const names = missingRequiredAspects.join(", ");
    return new Response(
      JSON.stringify({
        error:
          `This eBay category requires a value for ${names}. Enter a valid value or an eBay-supported unknown/not-applicable option, then try again.`,
        missingRequiredAspects,
        invalidItemSpecifics: true,
        sku,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Add aspects (item specifics) to the product
  if (Object.keys(aspects).length > 0) {
    (inventoryBody.product as Record<string, unknown>).aspects = aspects;
  }

  // Add video if it has been uploaded and is LIVE on eBay.
  //
  // The frontend already gates on this (usePublishDraft.ts only sends
  // ebayVideoId once draft.ebayVideoStatus === "LIVE"), so payloadEbayVideoId
  // being present here already implies the client believed it was live. This
  // re-verifies server-side rather than trusting that unconditionally --
  // defense in depth, not a fix for an active exploit, since nothing in this
  // codebase currently sends a video id it doesn't believe is live.
  //
  // If the verification call itself fails (network blip, eBay-side hiccup),
  // fall back to attaching the video anyway rather than failing the whole
  // publish over a check that couldn't complete -- the frontend's own gate
  // is still the primary safeguard, and being stricter here would make video
  // attachment less reliable than before this change, not more.
  if (payloadEbayVideoId) {
    let shouldAttachVideo = true;
    try {
      const { status: liveStatus } = await fetchEbayVideoStatus(
        String(payloadEbayVideoId),
        String(userToken),
        ebayEnv,
      );
      if (liveStatus !== "LIVE") {
        shouldAttachVideo = false;
        console.warn(
          `create_draft: ebayVideoId=${payloadEbayVideoId} is not LIVE on eBay (status=${liveStatus}); publishing without video`,
        );
      }
    } catch (err) {
      console.warn(
        `create_draft: could not re-verify ebayVideoId=${payloadEbayVideoId} status (${
          err instanceof Error ? err.message : String(err)
        }); attaching anyway on the frontend's LIVE gate`,
      );
    }

    if (shouldAttachVideo) {
      (inventoryBody.product as Record<string, unknown>).videoIds = [
        String(payloadEbayVideoId),
      ];
      console.log(
        `create_draft: attaching ebayVideoId=${payloadEbayVideoId} to product.videoIds`,
      );
    }
  }

  // ── eBay June 2026 Coin Condition Descriptors (MANDATORY) ──────────────────
  // Extract coinConditionDetail stored under itemSpecifics._coinConditionDetail
  // and translate it to the numeric conditionDescriptors array required by
  // the eBay Inventory API v1.18.5 for coin categories (253, 256, 3377, 4733, 18466 and all descendants).
  const rawItemSpecifics = (
    itemSpecifics && typeof itemSpecifics === "object" ? itemSpecifics : {}
  ) as Record<string, unknown>;
  const hasPayloadConditionDescriptors = Object.hasOwn(payload, "conditionDescriptors");
  const hasSavedConditionDescriptors = Object.hasOwn(rawItemSpecifics, "_conditionDescriptors");
  const suppliedConditionDescriptors = hasPayloadConditionDescriptors
    ? payload.conditionDescriptors
    : hasSavedConditionDescriptors
    ? rawItemSpecifics._conditionDescriptors
    : undefined;
  if (
    (hasPayloadConditionDescriptors || hasSavedConditionDescriptors) &&
    !isConditionDescriptorSelection(suppliedConditionDescriptors)
  ) {
    return new Response(
      JSON.stringify({
        error:
          "Invalid conditionDescriptors: expected a list of descriptor objects with a non-empty name, optional string values, and optional additionalInfo text.",
        invalidCondition: true,
        sku,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const explicitConditionDescriptors = hasPayloadConditionDescriptors || hasSavedConditionDescriptors
    ? suppliedConditionDescriptors as ConditionDescriptorSelection[]
    : undefined;
  const coinConditionDetailFromSpecifics = normalizeCoinConditionDetail(
    rawItemSpecifics._coinConditionDetail,
  );
  const coinConditionDetailFromPayload = normalizeCoinConditionDetail(
    (payload as Record<string, unknown>).coinConditionDetail,
  );
  const coinConditionDetailRaw: CoinConditionDetail | null = coinConditionDetailFromSpecifics ||
    coinConditionDetailFromPayload;

  // Coin categories MUST provide condition details per eBay June 2026 mandate.
  // categoryTreeType="coin" is detected via breadcrumb patterns and includes all descendants
  // of parent categories 253, 256, 3377, 4733, 18466.
  // Three-layer coin detection for the June 2026 conditionDescriptors mandate:
  //  1. categoryTreeType === "coin"  — covers HARDCODED_COIN_CATEGORY_IDS (expanded above)
  //  2. coinConditionDetailRaw != null — frontend sent _coinConditionDetail, which it only
  //     does for coin/bullion categories, so its presence is a reliable coin signal
  //  3. _domain === "coins_bullion" — Gemini Pass-1 classified the item as coin/bullion;
  //     catches any category ID not yet in the hardcoded list
  const publishDomain = rawItemSpecifics._domain as string | undefined;
  const hasCoinSpecificSignals = [
    "Coin",
    "Denomination",
    "Circulated/Uncirculated",
    "Strike Type",
    "Mint Location",
    "Mint Mark",
    "Fineness",
    "Certification",
  ].some((k) => {
    const v = rawItemSpecifics[k];
    return typeof v === "string" && v.trim().length > 0;
  });
  // Independent text signal: scan the listing title/description for
  // unambiguous numismatic terms. This is a safety net for uncommon
  // coin categories/domains that slip past every other signal above —
  // e.g. a mis-tagged Pass-1 domain plus a category ID outside the
  // hardcoded/DB-known coin sets should still not be enough to skip
  // the MANDATORY conditionDescriptors block for an actual coin.
  const _coinTextCheck = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  const COIN_TEXT_SIGNAL_RE =
    /\b(coin|coins|cent|cents|trime|dime|dimes|nickel|nickels|penny|pennies|quarter dollar|half dollar|silver dollar|gold dollar|morgan dollar|peace dollar|eisenhower dollar|kennedy half|franklin half|walking liberty|barber (?:dime|quarter|half)|mercury dime|roosevelt dime|buffalo nickel|jefferson nickel|wheat penny|indian head|proof set|mint set|bullion|troy oz|fine silver|fine gold|numismatic|ngc|pcgs|anacs|icg)\b/i;
  const hasCoinTextSignal = COIN_TEXT_SIGNAL_RE.test(_coinTextCheck);

  const isCoinDescriptorCategory = categoryTreeType === "coin" ||
    coinConditionDetailRaw != null ||
    publishDomain === "coins_bullion" ||
    hasCoinSpecificSignals ||
    hasCoinTextSignal;

  // VALIDATION: Coin listings in our positively-identified hardcoded list MUST have condition
  // details before we even attempt to publish. For secondary signals (_coinConditionDetail
  // present, or _domain = coins_bullion), we don't throw here — we proceed optimistically
  // and let eBay validate. This prevents blocking edge-case bullion/bar categories that
  // are tagged coins_bullion but don't actually need conditionDescriptors.
  if (!explicitConditionDescriptors && isCoinDescriptorCategory && clientId && clientSecret) {
    try {
      console.log(
        `create_draft: fetching coin condition descriptors for category ${finalCategoryId}, type=${
          coinConditionDetailRaw?.type ?? "unspecified"
        }`,
      );

      let descriptors: any[] | null = null;
      let lastError: Error | null = null;

      // Retry logic: attempt up to 2 times for transient failures
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          descriptors = await fetchCoinConditionDescriptors(
            finalCategoryId,
            clientId,
            clientSecret,
            apiBase,
          );
          if (descriptors && descriptors.length > 0) {
            break; // Success, exit retry loop
          }
        } catch (retryErr) {
          lastError = retryErr as Error;
          console.warn(
            `create_draft: Metadata API attempt ${attempt} failed. ${
              attempt < 2 ? "Retrying..." : "Will fail after this attempt."
            }`,
            lastError.message,
          );
          if (attempt < 2) {
            // Wait 500ms before retry
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }

      if (descriptors && descriptors.length > 0) {
        if (!coinConditionDetailRaw) {
          return new Response(
            JSON.stringify({
              error:
                `eBay requires coin condition details for category ${finalCategoryId}. Enter the coin's raw condition or grading details and try again.`,
              invalidCondition: true,
              sku,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const conditionDescriptors = buildCoinConditionDescriptors(
          coinConditionDetailRaw,
          descriptors,
        );
        if (conditionDescriptors && conditionDescriptors.length > 0) {
          inventoryBody.conditionDescriptors = conditionDescriptors;
          console.log(
            `create_draft: MANDATORY: added ${conditionDescriptors.length} conditionDescriptors for coin category ${finalCategoryId}:`,
            JSON.stringify(conditionDescriptors),
          );
        } else {
          // FAIL: Could not map user condition to eBay descriptor values.
          // This is a data integrity issue, not a soft warning.
          throw new Error(
            `Could not map condition details (type: ${coinConditionDetailRaw.type}) to eBay descriptor values for category ${finalCategoryId}. ` +
              `Verify the grade, company, or raw condition value is valid and try again.`,
          );
        }
      } else if (lastError !== null) {
        // FAIL: Metadata API calls threw exceptions — genuine transient failure.
        // Distinguish this from the "API responded with 0 descriptors" case below.
        throw new Error(
          `Unable to retrieve coin condition descriptors from eBay for category ${finalCategoryId} after 2 attempts. ` +
            `Error: ${lastError.message}. ` +
            `This may be a temporary service issue. Please try again or contact support.`,
        );
      } else {
        // eBay Metadata API responded successfully but returned 0 condition descriptors
        // for this category (e.g. Proof Sets 41109, 166679). This means the category is
        // NOT subject to the June 2026 condition descriptor mandate — proceed without them.
        console.log(
          `create_draft: category ${finalCategoryId} returned 0 condition descriptors from eBay ` +
            `Metadata API — not subject to the condition descriptor mandate, skipping.`,
        );
      }
    } catch (cdErr) {
      // Fatal: Coin condition descriptor error blocks the listing.
      // Phase 3: Enhanced error logging for monitoring and debugging
      const errorMessage = cdErr instanceof Error ? cdErr.message : String(cdErr);
      console.error(`create_draft: FATAL coin descriptor error:`, {
        message: errorMessage,
        stack: cdErr instanceof Error ? cdErr.stack : undefined,
        category: finalCategoryId,
        conditionType: coinConditionDetailRaw?.type,
        timestamp: new Date().toISOString(),
      });
      throw cdErr;
    }
  }
  // ── End Coin Condition Descriptors (MANDATORY) ────────────────────────────

  const selectedDescriptors = explicitConditionDescriptors ?? (
    Array.isArray(inventoryBody.conditionDescriptors)
      ? inventoryBody.conditionDescriptors as ConditionDescriptorSelection[]
      : []
  );
  if (selectedDescriptors.length > 0) {
    inventoryBody.conditionDescriptors = selectedDescriptors;
  }
  const conditionValidation = validateConditionSelection(
    conditionPolicy,
    finalCategoryId,
    rawCondition,
    selectedDescriptors,
  );
  if (!conditionValidation.valid) {
    return new Response(
      JSON.stringify({
        error: `The selected condition or its details are not valid for eBay category ${finalCategoryId}: ${
          conditionValidation.errors.join("; ")
        }. Update the condition details and try again.`,
        invalidCondition: true,
        sku,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const effectivePostalCode = postalCode || "60601";
  const effectiveCity = payloadCity || "";
  console.log("create_draft: inventory location setup", {
    receivedPostalCode: postalCode || "NOT_SET",
    receivedCity: payloadCity || "NOT_SET",
    effectivePostalCode,
    effectiveCity,
    isFallback: !postalCode,
  });
  const merchantLocationKey = await ensureInventoryLocation(
    apiBase,
    String(userToken),
    String(effectivePostalCode),
    String(effectiveCity),
  );

  console.log(
    `create_draft: creating inventory item for sku=${sku}, condition=${conditionEnum || "omitted"} (requested=${
      rawCondition || "omitted"
    }), merchantLocationKey=${merchantLocationKey}`,
  );
  console.log(
    `create_draft: inventory body condition:`,
    JSON.stringify({
      condition: conditionEnum || undefined,
      conditionDescription: conditionDesc || undefined,
      packageWeightAndSize,
    }),
  );

  const inventoryResp = await fetchWithTimeout(
    `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
    {
      method: "PUT",
      timeout: 15000,
      headers: authHeaders,
      body: JSON.stringify(inventoryBody),
    },
  );

  if (!inventoryResp.ok) {
    const errText = await inventoryResp.text();
    console.error(
      "create_draft: eBay inventory error:",
      inventoryResp.status,
      errText,
    );
    console.error(
      "create_draft: inventory request body:",
      JSON.stringify(inventoryBody, null, 2),
    );
    throw new Error(
      `Failed to create inventory item: ${inventoryResp.status} - ${errText}`,
    );
  }

  console.log(
    `create_draft: inventory item created successfully for sku=${sku}`,
  );

  // Step 3: Fetch business policies (use draft-level if set, else auto-fetch first)
  const { fulfillmentPolicyId, paymentPolicyId, returnPolicyId } = await resolveDraftBusinessPolicies({
    apiBase,
    authHeaders,
    draftFulfillmentPolicyId,
    draftPaymentPolicyId,
    draftReturnPolicyId,
  });

  // Only fulfillment and return policies are required; payment policy is optional
  if (!fulfillmentPolicyId || !returnPolicyId) {
    const missing = [
      !fulfillmentPolicyId && "Fulfillment (Shipping)",
      !returnPolicyId && "Return",
    ]
      .filter(Boolean)
      .join(", ");

    console.error(
      `create_draft: missing required policies for sku ${sku}: ${missing}. draftFulfillment=${draftFulfillmentPolicyId}, draftReturn=${draftReturnPolicyId}`,
    );

    return new Response(
      JSON.stringify({
        error:
          `Missing required eBay business policies: ${missing}. Please create these policies in your eBay Seller Hub (https://www.ebay.com/sh/ovw/policies) before publishing.`,
        missingPolicies: true,
        // sku is included so the caller can persist it and retry with the
        // SAME sku -- the inventory item PUT above already succeeded and is
        // idempotent, but only if a retry reuses this id instead of minting a
        // new one via generateDraftSku.
        sku,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  console.log(
    `create_draft: policies fetched - fulfillment=${fulfillmentPolicyId}, return=${returnPolicyId}, payment=${
      paymentPolicyId || "NONE"
    }`,
  );

  // --- SAFEGUARD: validate selected fulfillment policy services vs provided package dimensions ---
  // If the chosen fulfillment policy contains a USPS small flat rate box service and
  // the incoming package dimensions exceed that service's limits, return a clear error
  // to the client so the user can choose a different policy or adjust dimensions.
  try {
    if (
      fulfillmentPolicyId &&
      payloadPackageWeightAndSize &&
      typeof fulfillmentPolicyId === "string"
    ) {
      const policyResp = await fetchWithTimeout(
        `${apiBase}/sell/account/v1/fulfillment_policy/${encodeURIComponent(String(fulfillmentPolicyId))}`,
        { headers: authHeaders, timeout: 8000 },
      );
      if (policyResp.ok) {
        const policyJson = await policyResp.json();
        // Look for shipping services that indicate USPS small flat rate box usage.
        // eBay may expose service codes or descriptive names — check both.
        const policyServices: string[] = [];
        try {
          const shipOptions = policyJson?.shippingOptions || policyJson?.shipping || [];
          if (Array.isArray(shipOptions)) {
            shipOptions.forEach((opt: any) => {
              if (
                opt?.shippingServices &&
                Array.isArray(opt.shippingServices)
              ) {
                opt.shippingServices.forEach((s: any) => {
                  if (s?.shippingServiceCode) {
                    policyServices.push(String(s.shippingServiceCode));
                  }
                  if (s?.name) policyServices.push(String(s.name));
                });
              }
              if (opt?.services && Array.isArray(opt.services)) {
                opt.services.forEach((s: any) => {
                  if (s?.serviceCode) {
                    policyServices.push(String(s.serviceCode));
                  }
                  if (s?.name) policyServices.push(String(s.name));
                });
              }
            });
          }
        } catch (svcErr) {
          // ignore parsing errors — continue gracefully
        }

        // Normalize and search for indicators of the Small Flat Rate Box
        const normalized = policyServices.map((s) => (s || "").toString().toLowerCase());
        const indicatesSmallFlatRate = normalized.some(
          (s) =>
            s.includes("small flat rate") ||
            s.includes("priority mail small") ||
            s.includes("uspsprioritymailsmallflatratebox") ||
            s.includes("smallflatrate"),
        );

        if (indicatesSmallFlatRate) {
          const dims = (payloadPackageWeightAndSize as any).dimensions || null;
          if (dims) {
            const length = Number(dims.length || 0);
            const width = Number(dims.width || 0);
            const height = Number(dims.height || 0);
            // eBay error showed 8.6875 in — use that as a conservative per-side max for small flat rate
            const SMALL_FLAT_RATE_SIDE_MAX = 8.6875;
            if (
              length > SMALL_FLAT_RATE_SIDE_MAX ||
              width > SMALL_FLAT_RATE_SIDE_MAX ||
              height > SMALL_FLAT_RATE_SIDE_MAX
            ) {
              console.log(
                `create_draft: fulfillment policy ${fulfillmentPolicyId} contains Small Flat Rate service but package dims exceed limits: ${length}x${width}x${height} in`,
              );
              return new Response(
                JSON.stringify({
                  error:
                    `Selected shipping policy (${fulfillmentPolicyId}) includes USPS Small Flat Rate Box service which is incompatible with the provided package dimensions (${length} x ${width} x ${height} in). Please choose a different shipping policy or adjust package dimensions.`,
                  policyConflict: true,
                  fulfillmentPolicyId: fulfillmentPolicyId,
                  offendingServiceHint: "USPS Priority Mail Small Flat Rate Box",
                  // See the missingPolicies response above for why this
                  // matters: the inventory item PUT already succeeded.
                  sku,
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
            // No dimensions provided — warn but allow normal flow (eBay may infer)
            console.log(
              `create_draft: fulfillment policy ${fulfillmentPolicyId} contains Small Flat Rate service; no package dimensions provided to validate.`,
            );
          }
        }
      }
    }
  } catch (policyChkErr) {
    console.warn(
      "create_draft: unable to validate fulfillment policy services against package dimensions:",
      policyChkErr,
    );
    // Non-fatal — continue to attempt publish so we don't block users if policy API fails
  }

  // Step 4: Build offer payload
  // IMPORTANT: The eBay Inventory API (REST) only supports FIXED_PRICE format.
  // Auction listings require the legacy Trading API (XML-based) which is a
  // separate integration path. Attempting to pass format: "AUCTION" to the
  // Inventory API will result in a 400 error.
  // See: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer
  if (listingFormat === "AUCTION") {
    console.error(
      `create_draft: auction format requested but not supported by Inventory API for sku=${sku}`,
    );
    return new Response(
      JSON.stringify({
        error: "Auction format is not supported by the eBay Inventory API. " +
          "Please change the listing format to Fixed Price, or use the eBay " +
          "Seller Hub to create auction listings manually.",
        auctionNotSupported: true,
        sku,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const offerBody = buildFixedPriceOffer({
    sku,
    description: htmlDescription,
    listingPrice: (() => {
      const rawQty = Number(payloadQuantity) || 1;
      const rawPrice = Number(listingPrice ?? 0);
      return pricingMode === "total" && rawQty > 1 ? rawPrice / rawQty : rawPrice;
    })(),
    quantity: Number(payloadQuantity) || 1,
    condition: conditionEnum,
    conditionDescription: conditionDesc,
    ebayCategoryId: finalCategoryId || undefined,
    merchantLocationKey,
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    bestOfferEnabled: bestOfferEnabled === true,
    bestOfferAutoAcceptPrice: Number(bestOfferAutoAcceptPrice) || undefined,
    bestOfferAutoDeclinePrice: Number(bestOfferAutoDeclinePrice) || undefined,
  });

  console.log(
    `create_draft: built offer for sku=${sku}, price=${listingPrice}, category=${finalCategoryId || "NONE"}`,
  );
  console.log(
    `create_draft: offer body categories - categoryId in offer=${
      (offerBody as Record<string, unknown>).categoryId || "MISSING"
    }`,
  );
  console.log(`create_draft: offer body:`, JSON.stringify(offerBody, null, 2));

  const offerResp = await fetchWithTimeout(
    `${apiBase}/sell/inventory/v1/offer`,
    {
      method: "POST",
      timeout: 15000,
      headers: authHeaders,
      body: JSON.stringify(offerBody),
    },
  );

  let offerId: string | undefined;
  let offerData: Record<string, unknown> | null = null;

  if (!offerResp.ok) {
    const errText = await offerResp.text();
    console.error("create_draft: eBay offer error:", offerResp.status, errText);
    console.error(
      "create_draft: offer request body:",
      JSON.stringify(offerBody, null, 2),
    );

    // Check if this is errorId 25002 — offer already exists.
    // This can happen if a previous publish attempt created the offer but failed at publish step.
    // When this happens, UPDATE the existing offer with the corrected payload (PUT /offer/{offerId})
    // to ensure any fixes (e.g., condition, policies) take effect before publishing.
    try {
      const errJson = JSON.parse(errText);
      const offerExists = Array.isArray(errJson.errors) &&
        errJson.errors.some((e: { errorId: number }) => e.errorId === 25002);
      if (offerExists) {
        const offerIdParam = errJson.errors[0]?.parameters?.find(
          (p: { name: string; value: string }) => p.name === "offerId",
        );
        if (offerIdParam?.value) {
          offerId = offerIdParam.value;
          console.log(
            `create_draft: offer already exists (errorId 25002), updating existing offerId=${offerId} before publish`,
          );
          // Update the existing offer so our corrected payload takes effect
          const updateResp = await fetchWithTimeout(
            `${apiBase}/sell/inventory/v1/offer/${offerId}`,
            {
              method: "PUT",
              timeout: 15000,
              headers: authHeaders,
              body: JSON.stringify(offerBody),
            },
          );
          if (!updateResp.ok) {
            const updateErrText = await updateResp.text();
            console.warn(
              `create_draft: offer update failed (non-fatal), will still attempt publish: ${updateResp.status} - ${updateErrText}`,
            );
          } else {
            console.log(
              `create_draft: existing offer ${offerId} updated successfully`,
            );
          }
        }
      }
    } catch {
      // Not JSON or missing offerId — fall through to throw
    }

    if (!offerId) {
      // Structured response instead of a bare throw, matching the other
      // failure shapes in this function (missingPolicies, auctionNotSupported,
      // policyConflict, publishFailed below). A throw here would bubble up to
      // index.ts's generic outer catch, which returns {error, action} with no
      // sku -- discarding the fact that the inventory item PUT above already
      // succeeded, and orphaning it on retry since the caller would have no
      // sku to pass back into generateDraftSku. Reuses the publishFailed flag
      // so the existing frontend handler (markDraftFailed + toast) applies
      // without a new UI branch; the toast title says "offer created but
      // couldn't go live", which is not quite accurate for this specific
      // step (offer creation itself failed) -- acceptable wording gap, not a
      // functional one, since the description text is this error message.
      return new Response(
        JSON.stringify({
          error: `Failed to create offer: ${offerResp.status} - ${errText}`,
          publishFailed: true,
          sku,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } else {
    const parsedOfferData = (await offerResp.json()) as Record<string, unknown>;
    offerData = parsedOfferData;
    offerId = parsedOfferData.offerId as string | undefined;
    console.log(
      `create_draft: offer created successfully, offerId=${offerId}, about to publish...`,
    );
  }

  console.log(`create_draft: proceeding to publish offerId=${offerId}...`);

  // Step 5: Publish the offer to make it a live listing.
  // The publish endpoint does NOT accept a request body — condition is already
  // set on the inventory item (root level). Sending extra body fields causes
  // unexpected behavior. POST with no body is the correct usage.
  // Reference: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/publishOffer
  let publishResp = await fetchWithTimeout(
    `${apiBase}/sell/inventory/v1/offer/${offerId}/publish`,
    {
      method: "POST",
      timeout: 15000,
      headers: authHeaders,
    },
  );

  // A publish-time condition rejection refreshes policy for the next user attempt;
  // it must not silently replace the seller's requested condition.
  let publishErrText = "";
  let isConditionIdError = false;
  let conditionPolicyRefreshAvailable = false;
  if (!publishResp.ok) {
    publishErrText = await publishResp.text();
    // Matches both eBay's generic message ("...condition id is invalid...")
    // and the category-specific variant seen on non-coin leaves like
    // Jewelry & Watches ("...invalid for the selected primary category
    // id..."), which the narrower phrasing previously used here did not
    // catch — that exact error was reaching the seller with no
    // self-correction attempt.
    const CONDITION_ID_ERROR_RE =
      /CONDITION_ID|condition id is invalid|invalid for the selected primary category id|Condition descriptor \d+ is not valid/i;
    try {
      const parsed = JSON.parse(publishErrText);
      const errs: Array<{ errorId?: number; message?: string }> = parsed?.errors ?? [];
      isConditionIdError = errs.some(
        (e) =>
          e.errorId === 25021 ||
          e.errorId === 25060 ||
          CONDITION_ID_ERROR_RE.test(e.message ?? ""),
      );
    } catch {
      isConditionIdError = CONDITION_ID_ERROR_RE.test(publishErrText);
    }

    publishResp = new Response(publishErrText, {
      status: publishResp.status,
      statusText: publishResp.statusText,
      headers: publishResp.headers,
    });

    if (isConditionIdError) {
      const refreshedPolicy = await fetchCurrentConditionPolicy(
        finalCategoryId,
        String(userId ?? ""),
      );
      conditionPolicyRefreshAvailable = refreshedPolicy.status === "available";
      console.warn(
        `create_draft: eBay rejected the validated condition for category ${finalCategoryId}; refreshed policy status=${refreshedPolicy.status}. Returning without substituting a condition.`,
      );
    }
  }

  if (!publishResp.ok) {
    const errText = publishErrText;
    console.error(
      "create_draft: eBay publish error:",
      publishResp.status,
      errText,
    );
    console.error(
      "create_draft: failing to publish offer",
      offerId,
      "for sku",
      sku,
    );
    console.error(
      `create_draft: publish failed with condition=${effectiveConditionEnum} (id=${effectiveConditionId}), category=${finalCategoryId}, format=${listingFormat}`,
    );
    // Deficiency #8: Demote category mapping on publish failure
    // IMPORTANT: Only demote for errors that indicate a genuinely bad category
    // or condition mismatch. Do NOT demote for transient eBay server errors
    // (errorId 25001 = "Core Inventory Service internal error") or rate limits,
    // as those are eBay-side issues unrelated to our category choice.
    // errorId 25002 is OVERLOADED by eBay — it can mean:
    //   (a) "Invalid condition for category"  → demotable, condition error
    //   (b) "Seller monthly listing limit exceeded"  → NOT demotable, account limit
    //   (c) "Country of Origin value too long"  → NOT demotable, data error
    //   (d) "Missing required item specific"  → NOT demotable, data error
    // We detect seller-limit flavor by checking message text for known keywords.
    const SELLER_LIMIT_PATTERNS = [
      /exceed.*amount.*you can list/i,
      /selling limit/i,
      /monthly.*limit/i,
      /list.*more.*this month/i,
      /\$[\d,]+.*more.*total sales/i,
    ];
    // errorId 25002 also covers (e) a rejected item-specific/aspect value
    // (observed in production 2026-09-18: "A user error has occurred. Brand"
    // rejecting "Matchbox" as the Brand value on category 180506, and the
    // same misfire on 28021/180534). This flavor is NOT a condition or
    // category problem — the category was correctly resolved — so it must
    // not trigger condition retries or category demotion. Detection is kept
    // deliberately narrow (parameters[].name === "Brand", or a message that
    // literally starts with "A user error has occurred. Brand") so a real
    // condition-mismatch 25002 (which does not carry a Brand parameter and
    // does not use this exact phrasing) can never be misclassified here.
    const ASPECT_VALUE_ERROR_RE = /^A user error has occurred\.\s*Brand\b/i;
    const isAspectValueError = (
      e: { errorId?: number; message?: string; parameters?: Array<{ name?: string; value?: string }> },
    ): boolean =>
      e.errorId === 25002 &&
      (e.parameters?.some((p) => p.name === "Brand") ||
        ASPECT_VALUE_ERROR_RE.test(e.message ?? ""));
    const getAspectErrorName = (
      e: { message?: string; parameters?: Array<{ name?: string; value?: string }> },
    ): string => {
      const brandParam = e.parameters?.find((p) => p.name === "Brand");
      if (brandParam?.name) return brandParam.name;
      const match = ASPECT_VALUE_ERROR_RE.exec(e.message ?? "");
      return match ? "Brand" : "an item specific";
    };
    const DEMOTABLE_ERROR_IDS = new Set([
      21919288, // Invalid category ID
      25004, // Category not supported
      25005, // Leaf category required / invalid category ID
      25060, // Condition descriptor invalid for selected condition
      21916585, // Category requires item specifics
      25017, // Leaf category required
      25021, // Invalid condition id for selected category
      // NOTE: 25002 intentionally excluded — handled below with message-text check
    ]);
    let shouldDemote = false;
    let isSellerLimitError = false;
    let isBrandOrAspectError = false;
    let isMissingAspect = false;
    let missingAspectName = "an item specific";
    let aspectErrorName = "an item specific";
    let parsedErrJson: any = null;
    try {
      parsedErrJson = JSON.parse(errText);
      const errors: Array<
        { errorId?: number; message?: string; parameters?: Array<{ name?: string; value?: string }> }
      > = parsedErrJson?.errors ?? [];
      const errorIds: number[] = errors.map((e) => e.errorId ?? 0);

      // Check for the Brand/aspect-value flavor of 25002 next — this is
      // checked before the seller-limit check has any bearing on demotion
      // logic below, but seller-limit is still checked first here since its
      // detection loop also performs a repair side effect for legacy data.
      for (const e of errors) {
        if (isAspectValueError(e)) {
          isBrandOrAspectError = true;
          aspectErrorName = getAspectErrorName(e);
          console.warn(
            `create_draft: errorId 25002 is a BRAND/ASPECT VALUE error (not condition/category) — skipping demotion. Aspect: ${aspectErrorName}, message: ${
              e.message?.slice(0, 160)
            }`,
          );
          break;
        }
      }

      missingAspectName = getMissingAspectNameFromEbayErrors(errors) ?? missingAspectName;
      isMissingAspect = missingAspectName !== "an item specific";
      if (missingAspectName !== "an item specific") {
        console.warn(
          `create_draft: errorId 25002 reports missing required aspect ${missingAspectName} — skipping category demotion`,
        );
      }

      // Check for seller limit flavor of 25002 first
      for (const e of errors) {
        if (
          e.errorId === 25002 &&
          SELLER_LIMIT_PATTERNS.some((p) => p.test(e.message ?? ""))
        ) {
          isSellerLimitError = true;
          console.warn(
            `create_draft: errorId 25002 is a SELLER LIMIT error (not condition/category) — skipping demotion. Message: ${
              e.message?.slice(
                0,
                120,
              )
            }`,
          );
          // Undo any demotion that may have already fired for this category
          // (previous code versions incorrectly demoted on seller limit errors)
          try {
            const _repairUrl = Deno.env.get("SUPABASE_URL");
            const _repairKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (_repairUrl && _repairKey && finalCategoryId) {
              await fetch(`${_repairUrl}/functions/v1/category-lookup`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${_repairKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  action: "promote",
                  categoryId: finalCategoryId,
                }),
              });
              console.log(
                `create_draft: auto-promoted category ${finalCategoryId} to repair incorrect demotion from seller limit error`,
              );
            }
          } catch (repairErr) {
            console.warn(
              "create_draft: category repair failed (non-fatal):",
              repairErr,
            );
          }
          break;
        }
      }

      // Only demote for known category/condition mismatch errors, never for 500s, seller limit,
      // or a Brand/aspect-value rejection (the category was correctly resolved in that case).
      if (
        !isSellerLimitError && !isBrandOrAspectError && !isMissingAspect &&
        publishResp.status !== 500
      ) {
        shouldDemote = errorIds.some((id) => DEMOTABLE_ERROR_IDS.has(id));
        // 25002 is demotable ONLY when it is NOT a seller limit or Brand/aspect error
        const has25002 = errorIds.includes(25002);
        if (has25002) {
          // Check all 25002 errors in this response — if any is NOT a seller limit and NOT
          // a Brand/aspect error, it's a condition error.
          const conditionError = errors.some(
            (e) =>
              e.errorId === 25002 &&
              !SELLER_LIMIT_PATTERNS.some((p) => p.test(e.message ?? "")) &&
              !isAspectValueError(e) &&
              !getMissingAspectNameFromEbayErrors([e]),
          );
          if (conditionError) shouldDemote = true;
        }
      }

      if (!shouldDemote) {
        console.warn(
          `create_draft: skipping category demotion for ${finalCategoryId} — not a category/condition error (HTTP ${publishResp.status}, sellerLimit=${isSellerLimitError}, brandOrAspect=${isBrandOrAspectError})`,
        );
      }
    } catch (_parseErr) {
      // If we can't parse the error body, skip demotion
      shouldDemote = false;
    }
    if (shouldDemote) {
      try {
        const _supabaseUrl = Deno.env.get("SUPABASE_URL");
        const _serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_supabaseUrl && _serviceKey && finalCategoryId) {
          await fetch(`${_supabaseUrl}/functions/v1/category-lookup`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${_serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "demote",
              categoryId: finalCategoryId,
              itemType: payload.itemType || "",
              itemTypeNormalized: payload.itemTypeNormalized || "", // EA-P3-A: precise row targeting
              reason: `publish_failed_${publishResp.status}`,
            }),
          });
          console.warn(
            `create_draft: demoted category mapping for ${finalCategoryId} after publish failure`,
          );
        }
      } catch (demoteErr) {
        console.warn(
          "create_draft: demote call failed (non-fatal):",
          demoteErr,
        );
      }
    }

    // Provide a user-friendly error message based on the error type
    // Re-use parsedErrJson from the demotion block above (already parsed)
    let userFriendlyError: string;
    try {
      const firstError = parsedErrJson?.errors?.[0];
      const errorId = firstError?.errorId;
      const rawMsg = String(firstError?.message ?? "");
      const policyBlockText = `${rawMsg} ${errText}`;
      const isPolicyBlocked =
        /norfed liberty dollars|counterfeit coins policy|not permitted on ebay|do not attempt to relist/i.test(
          policyBlockText,
        );

      if (isPolicyBlocked) {
        userFriendlyError =
          "eBay blocked this listing due to policy restrictions (NORFED Liberty Dollars / Counterfeit Coins policy). This item type cannot be listed on eBay. Please choose a different item.";
      } else if (publishResp.status === 500 || errorId === 25001) {
        userFriendlyError =
          "eBay is experiencing a temporary issue. Please wait a minute and try publishing again. Your listing details are saved.";
      } else if (isSellerLimitError) {
        // Extract the human-readable portion of the seller limit message
        const limitMatch = rawMsg.match(
          /You can list up to ([$\d,.]+) more[^.]*\./i,
        );
        const remaining = limitMatch ? limitMatch[1] : null;
        userFriendlyError = remaining
          ? `Your eBay account has reached its monthly selling limit. You have ${remaining} of listing capacity remaining this month. Visit eBay's Selling Limits page to request an increase.`
          : "Your eBay account has reached its monthly selling limit. Please visit eBay's Selling Limits page to request an increase before listing high-value items.";
      } else if (isBrandOrAspectError) {
        userFriendlyError =
          `eBay rejected the value for "${aspectErrorName}" on this listing (it may be a restricted/trademarked brand name for this category). Try removing or correcting that item specific and republish.`;
      } else if (isMissingAspect) {
        userFriendlyError =
          `eBay requires the item specific "${missingAspectName}" for this category. Add a valid value and republish.`;
      } else if (isConditionIdError || errorId === 25021 || errorId === 25060) {
        userFriendlyError = `eBay rejected the selected condition or condition details for this category. ${
          conditionPolicyRefreshAvailable
            ? "Category policy was rechecked."
            : "Current category policy could not be rechecked."
        } Review the condition and its details, then try again.`;
      } else if (
        errorId === 21919288 ||
        errorId === 25004 ||
        errorId === 25005 ||
        errorId === 25017
      ) {
        userFriendlyError =
          "The selected category is not valid for this item. Please choose a different category and try again.";
      } else {
        userFriendlyError = firstError?.message ||
          `Publish failed: ${publishResp.status}. Please try again.`;
      }
    } catch (_) {
      userFriendlyError = publishResp.status === 500
        ? "eBay is experiencing a temporary issue. Please wait a minute and try publishing again."
        : `Publish failed: ${publishResp.status}. Please try again.`;
    }

    return new Response(
      JSON.stringify({
        error: userFriendlyError,
        offerId,
        sku,
        publishFailed: true,
        // Seller limit errors are also "transient" from listing perspective — not a listing defect
        isTransientError: publishResp.status === 500 || isSellerLimitError,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const publishData = await publishResp.json();
  const listingId = publishData.listingId || (offerData as any)?.listing?.listingId || null;

  // Build affiliate URL — non-fatal, wrapped in try/catch
  const affiliateUrl = listingId ? buildListingUrl(listingId) : null;

  console.log(
    `create_draft: Successfully published: listingId=${listingId}, offerId=${offerId}, sku=${sku}, publishData keys: ${
      Object.keys(
        publishData,
      ).join(", ")
    }`,
  );

  // Deficiency #8: Promote category mapping on publish success
  try {
    const _supabaseUrl = Deno.env.get("SUPABASE_URL");
    const _serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (_supabaseUrl && _serviceKey && finalCategoryId) {
      await fetch(`${_supabaseUrl}/functions/v1/category-lookup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${_serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "promote",
          categoryId: finalCategoryId,
          itemType: payload.itemType || "",
          itemTypeNormalized: payload.itemTypeNormalized || "", // EA-P3-A: precise row targeting
        }),
      });
      console.log(
        `create_draft: promoted category mapping for ${finalCategoryId}`,
      );
    }
  } catch (promoteErr) {
    console.warn("create_draft: promote call failed (non-fatal):", promoteErr);
  }

  return new Response(
    JSON.stringify({
      success: true,
      offerId,
      sku,
      listingId,
      affiliateUrl,
      message: "Listing published live on eBay!",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
