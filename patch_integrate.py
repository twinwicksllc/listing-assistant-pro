#!/usr/bin/env python3
"""
Applies three targeted patches to analyze-item/index.ts:
  PATCH A: After Pass 1 ends — upgrade Pre-Pass 0 with real domain + itemName
  PATCH B: Category priority ladder — inject grounded category as tier-2
  PATCH C: buildSystemPrompt call — pass prePassContext
  PATCH D: Final response — add market_analysis, grounded_category_id, agentic_inspection
"""

filepath = "supabase/functions/analyze-item/index.ts"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

original_len = len(content)
patches_applied = []

# ─── PATCH A: After END PASS 1, upgrade prePassResult with real domain + itemName ──
# Insert right before the "Pre-lookup: Deterministic category resolution" section.
# We detect the two-line sequence: END PASS 1 box line, blank line, then Pre-lookup

PATCH_A_SEARCH = (
    "\n\n    // \u2500\u2500 Pre-lookup: Deterministic category resolution \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "    let categoryHints"
)

PATCH_A_REPLACE = (
    "\n\n    // \u2500\u2500\u2500 POST-PASS-1: Upgrade Pre-Pass 0 with real domain + item name \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "    // Now that Pass 1 has identified the item, re-run Pre-Pass 0 if the\n"
    "    // preliminary domain guess was wrong OR if itemName is now more precise.\n"
    "    // This ensures grounding is run with the best possible item name.\n"
    "    if (prePassResult === null ||\n"
    "        (identification.domain !== 'general' && identification.itemName !== 'collectible item' && identification.itemName !== 'item')) {\n"
    "      try {\n"
    "        const { runAgenticPrePass: runAgenticPrePassUpgrade } = await import('../_helpers/agenticPrePass.ts');\n"
    "        // Only re-run if we have a meaningful item name from Pass 1\n"
    "        if (identification.itemName && identification.itemName !== 'item' && identification.itemName.length > 3) {\n"
    "          const upgradeBase64: string[] = [];\n"
    "          const upgradeMime: string[] = [];\n"
    "          for (const img of imageList.slice(0, 3)) {\n"
    "            const upB64 = img.includes(',') ? img.split(',')[1] : img;\n"
    "            const upMimeMatch = img.match(/^data:(image\\/\\w+);/);\n"
    "            upgradeBase64.push(upB64);\n"
    "            upgradeMime.push(upMimeMatch ? upMimeMatch[1] : 'image/jpeg');\n"
    "          }\n"
    "          const upgradeResult = await runAgenticPrePassUpgrade(\n"
    "            GEMINI_API_KEY,\n"
    "            identification.domain as any,\n"
    "            identification.itemName,\n"
    "            upgradeBase64,\n"
    "            upgradeMime,\n"
    "            invocationId,\n"
    "          );\n"
    "          if (upgradeResult !== null) {\n"
    "            prePassResult = upgradeResult;\n"
    "            console.log(`[${invocationId}] Pre-Pass 0 upgraded with real domain=${identification.domain}, item=${identification.itemName}`);\n"
    "          }\n"
    "        }\n"
    "      } catch (upgradeErr) {\n"
    "        console.warn(`[${invocationId}] Pre-Pass 0 upgrade failed (non-blocking):`, String(upgradeErr));\n"
    "      }\n"
    "    }\n"
    "    // \u2500\u2500\u2500 END POST-PASS-1 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "\n"
    "    // \u2500\u2500 Pre-lookup: Deterministic category resolution \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "    let categoryHints"
)

if PATCH_A_SEARCH in content:
    content = content.replace(PATCH_A_SEARCH, PATCH_A_REPLACE, 1)
    patches_applied.append("A")
    print("PATCH A applied: Post-Pass-1 Pre-Pass upgrade")
else:
    print("PATCH A FAILED: search string not found")
    # Debug
    idx = content.find("Pre-lookup: Deterministic category resolution")
    if idx != -1:
        print(f"  Found 'Pre-lookup' at char offset {idx}")
        print(f"  Context around it: {repr(content[idx-50:idx+80])}")

# ─── PATCH B: Category priority ladder — inject grounded category as tier-2 ──
# After the user-lock block but before the deterministic DB lookup.
# We find: "if (!userCategoryId) try {  // skip lookup if user already provided a category"
# and insert grounding check right before it.

PATCH_B_SEARCH = (
    "    if (!userCategoryId) try {  // skip lookup if user already provided a category"
)

PATCH_B_REPLACE = (
    "    // \u2500\u2500 Tier-2: Grounded category from Pre-Pass 0 Google Search \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "    // If Pre-Pass 0 found a category ID via live Google Search, verify it\n"
    "    // as a leaf via category-lookup. If verified, use it as a high-confidence lock.\n"
    "    // Priority: user lock > grounded verified leaf > deterministic DB > AI hint\n"
    "    if (!userCategoryId && prePassResult?.groundedCategoryId) {\n"
    "      try {\n"
    "        const _groundedVerifyUrl = Deno.env.get('SUPABASE_URL');\n"
    "        const _groundedVerifyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');\n"
    "        if (_groundedVerifyUrl && _groundedVerifyKey) {\n"
    "          const groundedVerifyResp = await fetch(\n"
    "            `${_groundedVerifyUrl}/functions/v1/category-lookup`,\n"
    "            {\n"
    "              method: 'POST',\n"
    "              headers: {\n"
    "                'Authorization': `Bearer ${_groundedVerifyKey}`,\n"
    "                'Content-Type': 'application/json',\n"
    "              },\n"
    "              body: JSON.stringify({ action: 'verify', categoryId: prePassResult.groundedCategoryId }),\n"
    "            }\n"
    "          );\n"
    "          if (groundedVerifyResp.ok) {\n"
    "            const groundedVerifyText = await groundedVerifyResp.text();\n"
    "            let groundedVerifyData: any;\n"
    "            try { groundedVerifyData = JSON.parse(groundedVerifyText); } catch { groundedVerifyData = {}; }\n"
    "\n"
    "            if (groundedVerifyData.isLeaf === true && groundedVerifyData.valid !== false) {\n"
    "              // Grounded leaf verified — use as a strong (but not absolute) lock\n"
    "              lockedCategoryId = prePassResult.groundedCategoryId;\n"
    "              lockedCategoryName = groundedVerifyData.categoryName || '';\n"
    "              lockedBreadcrumb = groundedVerifyData.breadcrumb || groundedVerifyData.categoryName || '';\n"
    "              categoryHints += `\\n- **GROUNDED CATEGORY** (verified leaf from live Google Search): **${lockedCategoryId}** \u2014 ${lockedBreadcrumb}. This was found by searching eBay\\'s current 2026 taxonomy. USE THIS CATEGORY unless you have strong evidence it is incorrect.`;\n"
    "              console.log(`[${invocationId}] GROUNDED LOCK: category ${lockedCategoryId} (${lockedBreadcrumb}) verified as leaf via Pre-Pass 0`);\n"
    "            } else {\n"
    "              // Not a valid leaf — downgrade to a strong hint\n"
    "              categoryHints += `\\n- GROUNDING HINT (unverified leaf): **${prePassResult.groundedCategoryId}** (from live Google Search — use as hint, verify before locking).`;\n"
    "              console.log(`[${invocationId}] Grounded category ${prePassResult.groundedCategoryId} NOT a verified leaf (isLeaf=${groundedVerifyData.isLeaf}) \u2014 using as hint only`);\n"
    "            }\n"
    "          }\n"
    "        }\n"
    "      } catch (groundedLookupErr) {\n"
    "        console.warn(`[${invocationId}] Grounded category verification failed (non-blocking):`, String(groundedLookupErr));\n"
    "      }\n"
    "    }\n"
    "    // \u2500\u2500 End grounded category tier \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "\n"
    "    if (!userCategoryId) try {  // skip lookup if user already provided a category"
)

if PATCH_B_SEARCH in content:
    content = content.replace(PATCH_B_SEARCH, PATCH_B_REPLACE, 1)
    patches_applied.append("B")
    print("PATCH B applied: Grounded category tier-2 in category ladder")
else:
    print("PATCH B FAILED: search string not found")

# ─── PATCH C: buildSystemPrompt call — pass prePassContext ──────────────────
# Find the buildSystemPrompt call and add prePassContext to the context object.

PATCH_C_SEARCH = (
    "      systemPrompt = buildSystemPrompt(identification.domain, {\n"
    "        itemName: identification.itemName,\n"
    "        imageCount: imageList.length,\n"
    "        voiceNote: voiceNote || undefined,\n"
    "        suggestedCategoryId: lockedCategoryId ?? undefined,\n"
    "        suggestedCategoryName: lockedCategoryName ?? undefined,\n"
    "        spotPrices: (identification.isMetal || identification.metalType !== \"none\")\n"
    "          ? { gold: spotGold, silver: spotSilver, platinum: spotPlatinum }\n"
    "          : undefined,\n"
    "        metalType: identification.metalType,\n"
    "        competitorData:\n"
    "          competitorData && (competitorData.competitorCount ?? 0) > 0 ? competitorData : null,\n"
    "      });"
)

PATCH_C_REPLACE = (
    "      systemPrompt = buildSystemPrompt(identification.domain, {\n"
    "        itemName: identification.itemName,\n"
    "        imageCount: imageList.length,\n"
    "        voiceNote: voiceNote || undefined,\n"
    "        suggestedCategoryId: lockedCategoryId ?? undefined,\n"
    "        suggestedCategoryName: lockedCategoryName ?? undefined,\n"
    "        spotPrices: (identification.isMetal || identification.metalType !== \"none\")\n"
    "          ? { gold: spotGold, silver: spotSilver, platinum: spotPlatinum }\n"
    "          : undefined,\n"
    "        metalType: identification.metalType,\n"
    "        competitorData:\n"
    "          competitorData && (competitorData.competitorCount ?? 0) > 0 ? competitorData : null,\n"
    "        // \u2500 Pre-Pass 0 agentic context (grounding + vision inspection findings) \u2500\n"
    "        prePassContext: prePassResult ? {\n"
    "          marketAnalysis: prePassResult.marketAnalysis ?? undefined,\n"
    "          groundedCategoryId: prePassResult.groundedCategoryId ?? undefined,\n"
    "          agenticInspection: prePassResult.agenticInspection ? {\n"
    "            zoomRegionsExamined: prePassResult.agenticInspection.zoomRegionsExamined,\n"
    "            keyFindings: prePassResult.agenticInspection.keyFindings,\n"
    "            confidenceBoost: prePassResult.agenticInspection.confidenceBoost,\n"
    "            identificationCorrection: prePassResult.agenticInspection.identificationCorrection,\n"
    "          } : undefined,\n"
    "        } : null,\n"
    "      });"
)

if PATCH_C_SEARCH in content:
    content = content.replace(PATCH_C_SEARCH, PATCH_C_REPLACE, 1)
    patches_applied.append("C")
    print("PATCH C applied: prePassContext injected into buildSystemPrompt")
else:
    print("PATCH C FAILED: search string not found")
    idx = content.find("systemPrompt = buildSystemPrompt")
    if idx != -1:
        print(f"  Found buildSystemPrompt at char {idx}")
        print(f"  Context: {repr(content[idx:idx+400])}")

# ─── PATCH D: Final response — add new agentic fields ───────────────────────
# We extend the finalResponse object to include the three new fields.
# Find the line: "    let responsePayload = { ...listing, meltValue, spotPrices: ..."

PATCH_D_SEARCH = (
    "    let responsePayload = { ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } };"
)

PATCH_D_REPLACE = (
    "    // \u2500 Assemble agentic fields from Pre-Pass 0 (additive — never replace existing fields) \u2500\n"
    "    const agenticFields: {\n"
    "      market_analysis?: string | null;\n"
    "      grounded_category_id?: string | null;\n"
    "      agentic_inspection?: {\n"
    "        zoom_regions_examined: string[];\n"
    "        key_findings: string;\n"
    "        confidence_boost: number;\n"
    "        identification_correction?: string;\n"
    "      } | null;\n"
    "    } = {};\n"
    "    if (prePassResult) {\n"
    "      agenticFields.market_analysis = prePassResult.marketAnalysis;\n"
    "      agenticFields.grounded_category_id = prePassResult.groundedCategoryId;\n"
    "      if (prePassResult.agenticInspection) {\n"
    "        agenticFields.agentic_inspection = {\n"
    "          zoom_regions_examined: prePassResult.agenticInspection.zoomRegionsExamined,\n"
    "          key_findings: prePassResult.agenticInspection.keyFindings,\n"
    "          confidence_boost: prePassResult.agenticInspection.confidenceBoost,\n"
    "          identification_correction: prePassResult.agenticInspection.identificationCorrection,\n"
    "        };\n"
    "      } else {\n"
    "        agenticFields.agentic_inspection = null;\n"
    "      }\n"
    "    }\n"
    "\n"
    "    let responsePayload = { ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } };"
)

if PATCH_D_SEARCH in content:
    content = content.replace(PATCH_D_SEARCH, PATCH_D_REPLACE, 1)
    patches_applied.append("D")
    print("PATCH D applied: agenticFields assembled before responsePayload")
else:
    print("PATCH D FAILED: search string not found")

# ─── PATCH E: Merge agenticFields into finalResponse ────────────────────────
# Find: "    const finalResponse = {\n      ...responsePayload,"
PATCH_E_SEARCH = (
    "    const finalResponse = {\n"
    "      ...responsePayload,\n"
    "      ...(ebayMetadata ? { _ebayMetadata: ebayMetadata } : {}),\n"
    "      _meta: {"
)

PATCH_E_REPLACE = (
    "    const finalResponse = {\n"
    "      ...responsePayload,\n"
    "      // Agentic Pre-Pass 0 fields (new — additive, backward compatible)\n"
    "      ...agenticFields,\n"
    "      ...(ebayMetadata ? { _ebayMetadata: ebayMetadata } : {}),\n"
    "      _meta: {"
)

if PATCH_E_SEARCH in content:
    content = content.replace(PATCH_E_SEARCH, PATCH_E_REPLACE, 1)
    patches_applied.append("E")
    print("PATCH E applied: agenticFields spread into finalResponse")
else:
    print("PATCH E FAILED: search string not found")
    idx = content.find("const finalResponse = {")
    if idx != -1:
        print(f"  Found finalResponse at char {idx}")
        print(f"  Context: {repr(content[idx:idx+300])}")

# ─── PATCH F: FREE_TIER_ALLOWED_FIELDS — add grounded fields ─────────────────
# market_analysis is useful even for free tier (no pricing info). Add it.
PATCH_F_SEARCH = (
    '      "title", "description", "condition", "conditionDescription",\n'
    '      "ebayCategoryId", "suggestedCategories",\n'
    '      "itemSpecifics",\n'
    '      "suggestedGrade", "packageWeightAndSize",\n'
    '      "domain",\n'
    '      // Locked to paid: priceMin, priceMax, meltValue, spotPrices, pricingNotes, gradingRationale, competitorData'
)

PATCH_F_REPLACE = (
    '      "title", "description", "condition", "conditionDescription",\n'
    '      "ebayCategoryId", "suggestedCategories",\n'
    '      "itemSpecifics",\n'
    '      "suggestedGrade", "packageWeightAndSize",\n'
    '      "domain",\n'
    '      // Agentic Pre-Pass 0 fields (available on all tiers — no pricing info)\n'
    '      "market_analysis", "grounded_category_id", "agentic_inspection",\n'
    '      // Locked to paid: priceMin, priceMax, meltValue, spotPrices, pricingNotes, gradingRationale, competitorData'
)

if PATCH_F_SEARCH in content:
    content = content.replace(PATCH_F_SEARCH, PATCH_F_REPLACE, 1)
    patches_applied.append("F")
    print("PATCH F applied: agentic fields added to FREE_TIER_ALLOWED_FIELDS")
else:
    print("PATCH F FAILED: search string not found")

# ─── Write the result ────────────────────────────────────────────────────────
with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print(f"\nPatches applied: {patches_applied}")
print(f"File size: {original_len} → {len(content)} chars (delta: +{len(content)-original_len})")