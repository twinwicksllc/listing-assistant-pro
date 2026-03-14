"""
PR #120 — Fix condition codes, schema, pricing, UX improvements
Based on Claude Opus analysis of the eBay Inventory API requirements.
"""

# ================================================================
# FIX EBAY-PUBLISH/INDEX.TS
# ================================================================
with open('supabase/functions/ebay-publish/index.ts', 'r') as f:
    pub = f.read()

print("=== FIXING ebay-publish/index.ts ===\n")

# 1. Replace CONDITION_ID_MAP — add USED_* family, keep *_REFURBISHED for non-coin categories
old_cid_map = '''const CONDITION_ID_MAP: Record<string, number> = {
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
};'''

new_cid_map = '''const CONDITION_ID_MAP: Record<string, number> = {
  // Universal conditions
  NEW: 1000,
  NEW_OTHER: 1500,
  NEW_WITH_DEFECTS: 1750,
  LIKE_NEW: 2750,
  // Refurbished (electronics/appliances — NOT for coins)
  CERTIFIED_REFURBISHED: 2000,
  SELLER_REFURBISHED: 2500,
  // USED_* family — correct for Coins & Paper Money category tree
  USED_EXCELLENT: 3000,   // AU-50 to XF-45
  USED_VERY_GOOD: 4000,   // VF-20 to VF-35
  USED_GOOD: 5000,         // F-12 to VG-10
  USED_ACCEPTABLE: 6000,   // G-4 to G-6
  FOR_PARTS_OR_NOT_WORKING: 7000, // Damaged/holed/bent coins, junk
  // Legacy *_REFURBISHED aliases — mapped to USED_* for coin categories
  EXCELLENT_REFURBISHED: 3000,
  VERY_GOOD_REFURBISHED: 4000,
  GOOD_REFURBISHED: 5000,
  PRE_OWNED_GOOD: 3000,
  PRE_OWNED_FAIR: 5000,
  PRE_OWNED_POOR: 6000,
};'''

if old_cid_map in pub:
    pub = pub.replace(old_cid_map, new_cid_map, 1)
    print("✅ CONDITION_ID_MAP updated with USED_* family")
else:
    print("❌ CONDITION_ID_MAP not found")

# 2. Replace CONDITION_DESCRIPTIONS — add USED_* descriptions
old_desc = '''const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NEW: "Brand new, unused, unopened item in original packaging.",
  LIKE_NEW: "Like new condition. May be open box but unused.",
  NEW_OTHER: "New without original packaging or tags.",
  NEW_WITH_DEFECTS: "New item with minor cosmetic defects.",
  CERTIFIED_REFURBISHED: "Professionally refurbished and certified to work like new.",
  EXCELLENT_REFURBISHED: "Refurbished to excellent working condition.",
  VERY_GOOD_REFURBISHED: "Refurbished to very good working condition.",
  GOOD_REFURBISHED: "Refurbished to good working condition.",
  SELLER_REFURBISHED: "Seller-refurbished item in good working condition.",
  PRE_OWNED_GOOD: "Pre-owned item in good condition. May show minor signs of wear.",
  PRE_OWNED_FAIR: "Pre-owned item in fair condition. Shows visible signs of wear.",
  PRE_OWNED_POOR: "Pre-owned item in poor condition. Heavy wear or cosmetic damage.",
  FOR_PARTS_OR_NOT_WORKING: "Item is not fully functional. Sold for parts or repair.",
};'''

new_desc = '''const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NEW: "Uncirculated coin or brand new item in original packaging.",
  NEW_OTHER: "New without original packaging or tags.",
  NEW_WITH_DEFECTS: "New item with minor cosmetic defects.",
  LIKE_NEW: "Like new condition.",
  CERTIFIED_REFURBISHED: "Professionally refurbished and certified to work like new.",
  SELLER_REFURBISHED: "Seller-refurbished item in good working condition.",
  // USED_* — correct conditions for Coins & Paper Money category tree
  USED_EXCELLENT: "Lightly circulated. AU-50 to XF-45. Shows minimal wear on high points only.",
  USED_VERY_GOOD: "Moderately circulated. VF-20 to VF-35. Major details clear with moderate wear.",
  USED_GOOD: "Heavily circulated. F-12 to VG-10. All major features visible but worn.",
  USED_ACCEPTABLE: "Heavily worn but identifiable. G-4 to G-6. Outline and major features visible.",
  FOR_PARTS_OR_NOT_WORKING: "Damaged, holed, bent, or corroded. Not suitable for collecting.",
  // Legacy aliases kept for backward compatibility
  EXCELLENT_REFURBISHED: "Lightly circulated. Shows minimal wear on high points only.",
  VERY_GOOD_REFURBISHED: "Moderately circulated. Major details clear with moderate wear.",
  GOOD_REFURBISHED: "Heavily circulated. All major features visible but worn.",
  PRE_OWNED_GOOD: "Pre-owned item in good condition.",
  PRE_OWNED_FAIR: "Pre-owned item in fair condition.",
  PRE_OWNED_POOR: "Pre-owned item in poor condition.",
};'''

if old_desc in pub:
    pub = pub.replace(old_desc, new_desc, 1)
    print("✅ CONDITION_DESCRIPTIONS updated")
else:
    print("❌ CONDITION_DESCRIPTIONS not found")

# 3. Replace LEGACY_CONDITION_MAP — now maps OLD *_REFURBISHED → USED_* 
old_legacy = '''const LEGACY_CONDITION_MAP: Record<string, string> = {
  USED_EXCELLENT: "PRE_OWNED_GOOD",
  USED_VERY_GOOD: "PRE_OWNED_GOOD",
  USED_GOOD: "PRE_OWNED_FAIR",
  USED_ACCEPTABLE: "PRE_OWNED_POOR",
};'''

new_legacy = '''const LEGACY_CONDITION_MAP: Record<string, string> = {
  // Map old *_REFURBISHED and PRE_OWNED_* to correct USED_* for coin categories
  EXCELLENT_REFURBISHED: "USED_EXCELLENT",
  VERY_GOOD_REFURBISHED: "USED_VERY_GOOD",
  GOOD_REFURBISHED: "USED_GOOD",
  PRE_OWNED_GOOD: "USED_EXCELLENT",
  PRE_OWNED_FAIR: "USED_GOOD",
  PRE_OWNED_POOR: "USED_ACCEPTABLE",
};'''

if old_legacy in pub:
    pub = pub.replace(old_legacy, new_legacy, 1)
    print("✅ LEGACY_CONDITION_MAP updated")
else:
    print("❌ LEGACY_CONDITION_MAP not found")

# 4. Replace normalizeConditionForCategory — use USED_* for coins
old_normalize = '''  if (isCoin) {
    // Named coin series: strict restricted set
    const validCoinConditions = new Set([
      "NEW", "CERTIFIED_REFURBISHED", "EXCELLENT_REFURBISHED",
      "VERY_GOOD_REFURBISHED", "GOOD_REFURBISHED", "FOR_PARTS_OR_NOT_WORKING",
    ]);
    if (!validCoinConditions.has(condition)) {
      const fallbackMap: Record<string, string> = {
        LIKE_NEW: "NEW",
        NEW_OTHER: "NEW",
        NEW_WITH_DEFECTS: "GOOD_REFURBISHED",
        SELLER_REFURBISHED: "GOOD_REFURBISHED",
        PRE_OWNED_GOOD: "EXCELLENT_REFURBISHED",
        PRE_OWNED_FAIR: "GOOD_REFURBISHED",
        PRE_OWNED_POOR: "FOR_PARTS_OR_NOT_WORKING",
      };
      const mapped = fallbackMap[condition] ?? "EXCELLENT_REFURBISHED";
      console.log(`normalizeConditionForCategory: coin category ${categoryId} — ${condition} -> ${mapped}`);
      return { condition: mapped, corrected: true };
    }
  } else if (isBullion || isLegacyBullion) {
    // Bullion: allow everything except LIKE_NEW
    if (condition === "LIKE_NEW") {
      console.log(`normalizeConditionForCategory: bullion category ${categoryId} — LIKE_NEW -> NEW`);
      return { condition: "NEW", corrected: true };
    }
  }'''

new_normalize = '''  if (isCoin) {
    // Coins & Paper Money category tree uses USED_* condition family, NOT *_REFURBISHED.
    // Valid coin conditions per eBay's getItemConditionPolicies for this category tree:
    const validCoinConditions = new Set([
      "NEW",             // MS-60 to MS-70 (uncirculated) and slabbed/certified
      "USED_EXCELLENT",  // AU-50 to XF-45 (lightly circulated)
      "USED_VERY_GOOD",  // VF-20 to VF-35 (moderately circulated)
      "USED_GOOD",       // F-12 to VG-10 (heavily circulated)
      "USED_ACCEPTABLE", // G-4 to G-6 (heavily worn but identifiable)
      "FOR_PARTS_OR_NOT_WORKING", // Damaged/holed/bent only
    ]);
    if (!validCoinConditions.has(condition)) {
      const fallbackMap: Record<string, string> = {
        LIKE_NEW: "NEW",
        NEW_OTHER: "NEW",
        NEW_WITH_DEFECTS: "USED_GOOD",
        CERTIFIED_REFURBISHED: "NEW",      // slabbed coins are "new" on eBay
        SELLER_REFURBISHED: "USED_GOOD",
        EXCELLENT_REFURBISHED: "USED_EXCELLENT",
        VERY_GOOD_REFURBISHED: "USED_VERY_GOOD",
        GOOD_REFURBISHED: "USED_GOOD",
        PRE_OWNED_GOOD: "USED_EXCELLENT",
        PRE_OWNED_FAIR: "USED_GOOD",
        PRE_OWNED_POOR: "USED_ACCEPTABLE",
      };
      const mapped = fallbackMap[condition] ?? "USED_EXCELLENT";
      console.log(`normalizeConditionForCategory: coin category ${categoryId} — ${condition} -> ${mapped}`);
      return { condition: mapped, corrected: true };
    }
  } else if (isBullion || isLegacyBullion) {
    // Bullion: allow everything except LIKE_NEW
    if (condition === "LIKE_NEW") {
      console.log(`normalizeConditionForCategory: bullion category ${categoryId} — LIKE_NEW -> NEW`);
      return { condition: "NEW", corrected: true };
    }
  }'''

if old_normalize in pub:
    pub = pub.replace(old_normalize, new_normalize, 1)
    print("✅ normalizeConditionForCategory updated to USED_* for coins")
else:
    print("❌ normalizeConditionForCategory isCoin block not found")

# 5. Fix default raw condition fallback (line ~1165: "PRE_OWNED_GOOD" default)
old_default = '      const rawCondition = condition || "PRE_OWNED_GOOD";'
new_default = '      const rawCondition = condition || "USED_EXCELLENT";'
if old_default in pub:
    pub = pub.replace(old_default, new_default, 1)
    print("✅ Default condition fallback updated to USED_EXCELLENT")
else:
    print("❌ Default condition fallback not found")

# 6. Update melt value enforcement to include eBay fee buffer (×1.19)
old_melt = '''        if (listing.priceMin < meltValue) {
          console.warn(`priceMin ${listing.priceMin} below melt value ${meltValue} — correcting`);
          listing.priceMin = meltValue;
          // Also bump priceMax if it's somehow below melt
          if (listing.priceMax < meltValue) {
            listing.priceMax = parseFloat((meltValue * 1.1).toFixed(2));
          }
        }'''
new_melt = '''        if (listing.priceMin < meltValue) {
          // Apply eBay fee buffer: ~13.25% FVF + ~2.9% payment processing = ~16% total.
          // Use 1.19x multiplier to ensure listing at priceMin still covers melt after fees.
          const feeAdjustedFloor = parseFloat((meltValue * 1.19).toFixed(2));
          console.warn(`priceMin ${listing.priceMin} below fee-adjusted melt floor ${feeAdjustedFloor} (melt: ${meltValue}) — correcting`);
          listing.priceMin = feeAdjustedFloor;
          // Also bump priceMax if it's somehow below the floor
          if (listing.priceMax < feeAdjustedFloor) {
            listing.priceMax = parseFloat((feeAdjustedFloor * 1.1).toFixed(2));
          }
        }'''
if old_melt in pub:
    pub = pub.replace(old_melt, new_melt, 1)
    print("✅ Melt value floor updated with eBay fee buffer (×1.19)")
else:
    print("❌ Melt value enforcement block not found")

# 7. Update version banner to v10
old_banner = '*** EBAY-PUBLISH FUNCTION STARTED (v9 - bare aspect keys, no C: prefix in inventory payloads) ***'
new_banner = '*** EBAY-PUBLISH FUNCTION STARTED (v10 - USED_* condition codes for coins, fee-adjusted melt floor) ***'
if old_banner in pub:
    pub = pub.replace(old_banner, new_banner, 1)
    print("✅ Version banner updated to v10")
else:
    print("❌ v9 banner not found")

old_top = '// Force redeploy v9: Strip C: prefix from all aspect keys — eBay Inventory API uses bare keys only'
new_top = '// Force redeploy v10: USED_* condition codes for coins, fee-adjusted melt floor (×1.19)'
if old_top in pub:
    pub = pub.replace(old_top, new_top, 1)
    print("✅ Top comment updated to v10")

with open('supabase/functions/ebay-publish/index.ts', 'w') as f:
    f.write(pub)

print(f"\nebay-publish done. File size: {len(pub)} chars")


# ================================================================
# FIX ANALYZE-ITEM/INDEX.TS
# ================================================================
with open('supabase/functions/analyze-item/index.ts', 'r') as f:
    ana = f.read()

print("\n=== FIXING analyze-item/index.ts ===\n")

# 1. Fix condition mapping in system prompt (Section 4)
old_condition_map = '''Condition Code Mapping (output as the "condition" field):
- MS-60 to MS-70 → NEW
- AU-50 to AU-58 → EXCELLENT_REFURBISHED
- XF-40 to XF-45 → EXCELLENT_REFURBISHED
- VF-20 to VF-35 → VERY_GOOD_REFURBISHED
- F-12 to VF-12 → GOOD_REFURBISHED
- VG-8 to VG-10 → GOOD_REFURBISHED
- G-4 to G-6 → FOR_PARTS_OR_NOT_WORKING
- FR or lower → FOR_PARTS_OR_NOT_WORKING
NEVER use "LIKE_NEW" or "PRE_OWNED_*" — these are invalid for coin categories.'''

new_condition_map = '''Condition Code Mapping (output as the "condition" field):

For COIN categories (Morgan, Peace, Barber, Liberty Walking, Eisenhower, Silver Eagle, etc.):
eBay's Coins & Paper Money category tree uses the USED_* condition family — NOT *_REFURBISHED.
- MS-60 to MS-70 (Uncirculated) → NEW
- Slabbed/Certified coins (any grade) → NEW
- AU-50 to AU-58, XF-40 to XF-45 → USED_EXCELLENT
- VF-20 to VF-35 → USED_VERY_GOOD
- F-12 to F-15, VG-8 to VG-10 → USED_GOOD
- G-4 to G-6 → USED_ACCEPTABLE  (worn but identifiable — NOT "for parts")
- FR-2 or lower, damaged/holed/bent/corroded → FOR_PARTS_OR_NOT_WORKING

NEVER use *_REFURBISHED, LIKE_NEW, or PRE_OWNED_* for coin categories — eBay rejects these.

For NON-COIN items (electronics, general collectibles, etc.):
- Unused/sealed → NEW
- Open but unused → LIKE_NEW
- Light use → USED_EXCELLENT
- Moderate use → USED_VERY_GOOD
- Heavy use → USED_GOOD
- Poor condition → USED_ACCEPTABLE
- Non-functional → FOR_PARTS_OR_NOT_WORKING'''

if old_condition_map in ana:
    ana = ana.replace(old_condition_map, new_condition_map, 1)
    print("✅ System prompt condition mapping updated to USED_*")
else:
    print("❌ Condition mapping section not found")

# 2. Fix "omit unknown fields" instruction — add after condition section
old_grading_end = '''NEVER use "LIKE_NEW" or "PRE_OWNED_*" — these are invalid for coin categories.

5. STRUCTURED ITEM SPECIFICS'''

# Already replaced above, so look for the new text
old_after_condition = '''NEVER use *_REFURBISHED, LIKE_NEW, or PRE_OWNED_* for coin categories — eBay rejects these.

For NON-COIN items (electronics, general collectibles, etc.):
- Unused/sealed → NEW
- Open but unused → LIKE_NEW
- Light use → USED_EXCELLENT
- Moderate use → USED_VERY_GOOD
- Heavy use → USED_GOOD
- Poor condition → USED_ACCEPTABLE
- Non-functional → FOR_PARTS_OR_NOT_WORKING

5. STRUCTURED ITEM SPECIFICS'''

new_after_condition = '''NEVER use *_REFURBISHED, LIKE_NEW, or PRE_OWNED_* for coin categories — eBay rejects these.

For NON-COIN items (electronics, general collectibles, etc.):
- Unused/sealed → NEW
- Open but unused → LIKE_NEW
- Light use → USED_EXCELLENT
- Moderate use → USED_VERY_GOOD
- Heavy use → USED_GOOD
- Poor condition → USED_ACCEPTABLE
- Non-functional → FOR_PARTS_OR_NOT_WORKING

IMPORTANT — OMIT UNKNOWN FIELDS: If a value cannot be determined from the images, OMIT the field entirely. Do NOT output placeholder values like "Unknown", "N/A", "Not Specified", "Not Applicable", "None", or "Other". An absent field is always better than a placeholder.

5. STRUCTURED ITEM SPECIFICS'''

if old_after_condition in ana:
    ana = ana.replace(old_after_condition, new_after_condition, 1)
    print("✅ Added 'omit unknown fields' instruction")
else:
    print("❌ Section transition not found for omit instruction")

# 3. Fix metalWeightOz conversion instructions in pricing section
old_pricing_notes = '''Return pricingNotes explaining exactly which comparables or logic you used.

Return your analysis using the provided tool.`'''

new_pricing_notes = '''Return pricingNotes explaining exactly which comparables or logic you used.

metalWeightOz: Always express in TROY OUNCES (not grams, not avoirdupois ounces).
Common conversions: 1 troy oz = 31.1035g | 5g = 0.1607 oz | 10g = 0.3215 oz | 1/2 oz = 0.5 | 1/4 oz = 0.25 | 1/10 oz = 0.1
Set to 0 for non-precious-metal items.

Return your analysis using the provided tool.`'''

if old_pricing_notes in ana:
    ana = ana.replace(old_pricing_notes, new_pricing_notes, 1)
    print("✅ metalWeightOz conversion instructions added")
else:
    print("❌ Pricing notes section not found")

# 4. Fix voice note integration — make it authoritative
old_voice = '''    if (voiceNote) {
      userText += `\\n\\nIMPORTANT — The seller recorded the following voice note about the item's condition, flaws, or special features. You MUST incorporate this information into the item description and condition assessment:\\n\\n"${voiceNote}"`;
    }'''

new_voice = '''    if (voiceNote) {
      userText += `\\n\\nSELLER'S VOICE NOTE (treat as authoritative — override visual assessment where applicable):
The seller recorded the following about this item. Follow these rules:
- If the seller mentions specific flaws NOT visible in photos: include them in description and adjust grade/condition downward accordingly.
- If the seller mentions cleaning, damage, repairs, or alterations: disclose in description and lower condition.
- If the seller mentions provenance, purchase history, or authentication details: include in description.
- If the seller mentions packaging, accessories, certificates, or extras: note them in description.
- If the seller's assessment contradicts your visual grade (e.g., they say "heavily worn" but photos look better): trust the seller.

Seller's note: "${voiceNote}"`;
    }'''

if old_voice in ana:
    ana = ana.replace(old_voice, new_voice, 1)
    print("✅ Voice note integration improved")
else:
    print("❌ Voice note section not found")

# 5. Fix condition enum in tool schema — replace *_REFURBISHED / PRE_OWNED_* with USED_*
old_cond_enum = '''                    condition: {
                      type: "string",
                      enum: ["NEW", "LIKE_NEW", "NEW_OTHER", "NEW_WITH_DEFECTS", "CERTIFIED_REFURBISHED", "EXCELLENT_REFURBISHED", "VERY_GOOD_REFURBISHED", "GOOD_REFURBISHED", "SELLER_REFURBISHED", "PRE_OWNED_GOOD", "PRE_OWNED_FAIR", "PRE_OWNED_POOR", "FOR_PARTS_OR_NOT_WORKING"],
                      description: "eBay item condition. For coins/bullion: use NEW (uncirculated/MS), CERTIFIED_REFURBISHED (slabbed), EXCELLENT_REFURBISHED (AU/XF), VERY_GOOD_REFURBISHED (VF), GOOD_REFURBISHED (F/VG), or FOR_PARTS_OR_NOT_WORKING (G or poor). DO NOT use LIKE_NEW or PRE_OWNED_* for coins — they are not valid for eBay coin categories. For electronics/general items: use any condition that accurately reflects the item\'s state.",
                    },'''

new_cond_enum = '''                    condition: {
                      type: "string",
                      enum: ["NEW", "LIKE_NEW", "NEW_OTHER", "NEW_WITH_DEFECTS", "CERTIFIED_REFURBISHED", "SELLER_REFURBISHED", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"],
                      description: "eBay item condition. For COIN categories: NEW (MS/uncirculated or slabbed), USED_EXCELLENT (AU/XF), USED_VERY_GOOD (VF), USED_GOOD (F/VG), USED_ACCEPTABLE (G), FOR_PARTS_OR_NOT_WORKING (damaged/holed only). NEVER use *_REFURBISHED or PRE_OWNED_* for coins. For non-coin items: use any value that accurately reflects the item state.",
                    },'''

if old_cond_enum in ana:
    ana = ana.replace(old_cond_enum, new_cond_enum, 1)
    print("✅ Condition enum updated to USED_* family")
else:
    print("❌ Condition enum not found")

# 6. Add listingFormat to tool schema (after suggestedGrade/gradingRationale/isSlabbed)
old_islabbed = '''                    isSlabbed: {
                      type: "boolean",
                      description: "True if the coin is already in a certified grading slab (PCGS, NGC, etc.)",
                    },
                  },
                  required: ["title", "description", "priceMin", "priceMax", "pricingNotes", "metalType", "metalWeightOz", "ebayCategoryId", "suggestedCategories", "itemSpecifics", "condition", "suggestedGrade", "gradingRationale", "isSlabbed"],'''

new_islabbed = '''                    isSlabbed: {
                      type: "boolean",
                      description: "True if the coin is already in a certified grading slab (PCGS, NGC, etc.)",
                    },
                    listingFormat: {
                      type: "string",
                      enum: ["FIXED_PRICE", "AUCTION"],
                      description: "Suggested listing format. Use FIXED_PRICE for most items. Use AUCTION only for rare/key-date coins (CC mint mark Morgan, 1893-S, 1895 proof, etc.) or items where competitive bidding would likely drive price above fixed price.",
                    },
                    confidence: {
                      type: "number",
                      description: "Identification confidence score 0.0-1.0. Below 0.7 = suggest user verify. Below 0.5 = suggest better photos needed.",
                    },
                    photoSuggestions: {
                      type: "array",
                      items: { "type": "string" },
                      description: "Suggestions for additional photos that would improve identification accuracy (e.g., 'Close-up of mint mark area', 'Photo of edge/reeding', 'Reverse side needed'). Empty array if photos are sufficient.",
                    },
                  },
                  required: ["title", "description", "priceMin", "priceMax", "pricingNotes", "metalType", "metalWeightOz", "ebayCategoryId", "suggestedCategories", "itemSpecifics", "condition", "suggestedGrade", "gradingRationale", "isSlabbed", "listingFormat", "confidence", "photoSuggestions"],'''

if old_islabbed in ana:
    ana = ana.replace(old_islabbed, new_islabbed, 1)
    print("✅ Added listingFormat, confidence, photoSuggestions to tool schema")
else:
    print("❌ isSlabbed + required array not found")

# 7. Add usage_tracking insert after successful analysis (before final return)
old_final_return = '''    return new Response(JSON.stringify({ ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });'''

new_final_return = '''    // Track this analysis for rate limiting (increment usage counter)
    try {
      await svc.from("usage_tracking").insert({
        user_id: userId,
        action_type: "ai_analysis",
      });
    } catch (trackErr) {
      console.error("Failed to track usage:", trackErr);
    }

    return new Response(JSON.stringify({ ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });'''

if old_final_return in ana:
    ana = ana.replace(old_final_return, new_final_return, 1)
    print("✅ Usage tracking insert added")
else:
    print("❌ Final return statement not found")

# 8. Improve title truncation (word boundary)
old_title_trunc = '''    if (listing.title && listing.title.length > 80) {
      listing.title = listing.title.substring(0, 80);
    }'''

new_title_trunc = '''    if (listing.title && listing.title.length > 80) {
      // Truncate at last complete word within 80 chars to avoid cutting mid-word
      listing.title = listing.title.substring(0, 80).replace(/\s+\S*$/, "").trim();
    }'''

if old_title_trunc in ana:
    ana = ana.replace(old_title_trunc, new_title_trunc, 1)
    print("✅ Title truncation improved (word boundary)")
else:
    print("❌ Title truncation not found")

# 9. Upgrade Gemini model to gemini-2.5-flash
old_model = '          model: "gemini-2.0-flash",'
new_model = '          model: "gemini-2.5-flash-preview-04-17",'
count = ana.count(old_model)
if count:
    ana = ana.replace(old_model, new_model)
    print(f"✅ Gemini model upgraded to gemini-2.5-flash-preview-04-17 ({count} occurrence(s))")
else:
    print("❌ gemini-2.0-flash model string not found")

# 10. Also update the gemini_usage log insert model name
old_model_log = '        model: "gemini-2.0-flash",'
new_model_log = '        model: "gemini-2.5-flash-preview-04-17",'
count2 = ana.count(old_model_log)
if count2:
    ana = ana.replace(old_model_log, new_model_log)
    print(f"✅ Usage log model name updated ({count2} occurrence(s))")

with open('supabase/functions/analyze-item/index.ts', 'w') as f:
    f.write(ana)

print(f"\nanalyze-item done. File size: {len(ana)} chars")

# ================================================================
# VERIFICATION
# ================================================================
print("\n=== VERIFICATION ===")
print(f"ebay-publish: USED_EXCELLENT occurrences: {pub.count('USED_EXCELLENT')}")
print(f"ebay-publish: USED_VERY_GOOD occurrences: {pub.count('USED_VERY_GOOD')}")
print(f"ebay-publish: USED_GOOD occurrences: {pub.count('USED_GOOD')}")
print(f"ebay-publish: USED_ACCEPTABLE occurrences: {pub.count('USED_ACCEPTABLE')}")
print(f"ebay-publish: v10 banner: {'yes' if 'v10' in pub else 'no'}")
print(f"analyze-item: USED_EXCELLENT occurrences: {ana.count('USED_EXCELLENT')}")
print(f"analyze-item: listingFormat: {'yes' if 'listingFormat' in ana else 'no'}")
print(f"analyze-item: confidence: {'yes' if 'confidence' in ana else 'no'}")
print(f"analyze-item: usage_tracking insert: {'yes' if 'usage_tracking' in ana and 'insert' in ana else 'no'}")
print(f"analyze-item: gemini-2.5: {'yes' if 'gemini-2.5' in ana else 'no'}")
print(f"analyze-item: photoSuggestions: {'yes' if 'photoSuggestions' in ana else 'no'}")