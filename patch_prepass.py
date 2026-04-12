#!/usr/bin/env python3
"""
Inserts the Pre-Pass 0 block into analyze-item/index.ts right after the
GEMINI_API_KEY guard (line ~289), before Pass 1.
"""

import re

filepath = "supabase/functions/analyze-item/index.ts"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Find the exact insertion point: right after the closing brace of the
# "GEMINI_API_KEY is not configured" guard block, before the Pass 1 comment.
# We search for the literal sequence we know exists.
SEARCH = '    }\n\n    // \u2500\u2500\u2500 PASS 1: Fast item identification'

PRE_PASS_BLOCK = '''    }

    // \u2500\u2500\u2500 PRE-PASS 0: Agentic Grounding + Vision Inspection \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Uses the NATIVE Gemini generateContent API with googleSearch + codeExecution
    // tools. Runs BEFORE Pass 1 so grounded category & market data can influence
    // the entire downstream pipeline.
    // Non-blocking: any failure leaves prePassResult = null, pipeline continues.
    let prePassResult: { marketAnalysis: string | null; groundedCategoryId: string | null; agenticInspection: { zoomRegionsExamined: string[]; keyFindings: string; confidenceBoost: number; identificationCorrection?: string } | null } | null = null;
    try {
      const { runAgenticPrePass } = await import("../_helpers/agenticPrePass.ts");

      // Build base64 + mime lists for pre-pass (parse from data URLs)
      const prePassBase64List: string[] = [];
      const prePassMimeList: string[] = [];
      for (const img of imageList.slice(0, 3)) {
        const ppBase64 = img.includes(",") ? img.split(",")[1] : img;
        const ppMimeMatch = img.match(/^data:(image\\/\\w+);/);
        const ppMimeType = ppMimeMatch ? ppMimeMatch[1] : "image/jpeg";
        prePassBase64List.push(ppBase64);
        prePassMimeList.push(ppMimeType);
      }

      // Fast preliminary domain guess from voice note keywords.
      // Pass 1 hasn\'t run yet, so we use heuristics here.
      type PrePassDomain = "coins_bullion" | "trading_cards" | "jewelry" | "electronics" | "vintage_clothing" | "general";
      let prelimDomain: PrePassDomain = "general";
      const noteForDomain = (voiceNote + " " + String(body.voiceNote || "")).toLowerCase();
      if (/\\bcoin|bullion|silver|gold|dollar|eagle|morgan|kennedy|quarter|dime|nickel|cent|peso\\b/.test(noteForDomain)) {
        prelimDomain = "coins_bullion";
      } else if (/\\bcard|pokemon|magic|yugioh|baseball|football|basketball|nba|nfl|mlb\\b/.test(noteForDomain)) {
        prelimDomain = "trading_cards";
      } else if (/\\bring|necklace|bracelet|earring|jewel|watch|pendant|brooch\\b/.test(noteForDomain)) {
        prelimDomain = "jewelry";
      } else if (/\\bphone|laptop|tablet|console|camera|iphone|samsung|macbook|xbox|playstation\\b/.test(noteForDomain)) {
        prelimDomain = "electronics";
      } else if (/\\bshirt|jacket|dress|pants|vintage|coat|blouse|skirt|denim|levi\\b/.test(noteForDomain)) {
        prelimDomain = "vintage_clothing";
      }

      // Use voice note or generic placeholder as preliminary item name
      const prelimItemName = voiceNote.trim().slice(0, 80) || "collectible item";

      prePassResult = await runAgenticPrePass(
        GEMINI_API_KEY,
        prelimDomain,
        prelimItemName,
        prePassBase64List,
        prePassMimeList,
        invocationId,
      );
    } catch (prePassErr) {
      console.warn(`[${invocationId}] Pre-Pass 0 outer catch (non-blocking):`, String(prePassErr));
    }
    // \u2500\u2500\u2500 END PRE-PASS 0 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    // \u2500\u2500\u2500 PASS 1: Fast item identification'''

if SEARCH in content:
    new_content = content.replace(SEARCH, PRE_PASS_BLOCK, 1)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("SUCCESS: Pre-Pass 0 block inserted.")
else:
    # Try to locate approximate position by line number
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if "PASS 1: Fast item identification" in line:
            print(f"Found PASS 1 comment at line {i+1}: {repr(line[:80])}")
    print("FAILED: Could not find exact insertion point.")
    print("Dumping lines 286-296:")
    for i, line in enumerate(lines[285:296], start=286):
        print(f"  {i}: {repr(line)}")