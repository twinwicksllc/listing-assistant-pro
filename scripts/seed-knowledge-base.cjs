/**
 * seed-knowledge-base.js
 * Ingests ANA standards and sample sales history into the Supabase knowledge_base.
 *
 * Usage:
 * SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GEMINI_API_KEY=... node scripts/seed-knowledge-base.js
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  console.error("Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ANA_STANDARDS = [
  {
    category: "grading_standard",
    content:
      "MS-70 (Perfect Uncirculated): A coin with no trace of wear, no visible marks, and full original luster. Eye appeal is outstanding.",
    metadata: { series: "general", grade: 70, letter: "MS" },
  },
  {
    category: "grading_standard",
    content:
      "MS-65 (Choice Uncirculated): A coin with full luster and very few minor marks or hairlines. None of the marks are in focal points.",
    metadata: { series: "general", grade: 65, letter: "MS" },
  },
  {
    category: "grading_standard",
    content:
      "MS-63 (Select Uncirculated): A coin with full luster but allows for minor bag marks or contact marks, even in focal points.",
    metadata: { series: "general", grade: 63, letter: "MS" },
  },
  {
    category: "grading_standard",
    content:
      "AU-58 (Choice About Uncirculated): Only the slightest trace of wear on the highest points of the design. Full luster remains in the fields.",
    metadata: { series: "general", grade: 58, letter: "AU" },
  },
  {
    category: "grading_standard",
    content:
      "EF-45 (Choice Extremely Fine): Typical light wear on all high points. Nearly all design details remain sharp.",
    metadata: { series: "general", grade: 45, letter: "EF" },
  },
  {
    category: "grading_standard",
    content:
      "VF-20 (Very Fine): Moderate wear on the high points. All major design elements are visible, though somewhat flattened.",
    metadata: { series: "general", grade: 20, letter: "VF" },
  },
];

// --- Phase 4: Domain knowledge base expansion beyond coin grading ---
// Each entry follows the same additive pattern as ANA_STANDARDS above:
// short, verifiable reference facts (not opinions) that ground the Visual
// Agent's inspection for that domain. See DOMAIN_RAG_CATEGORIES in
// supabase/functions/_helpers/agent-system/registry.ts for the category
// each domain queries.

const SNEAKER_AUTHENTICATION = [
  {
    category: "sneaker_authentication",
    content:
      "Deadstock (DS): Brand new, unworn, with original box and all accessories (extra laces, tags). No creasing on the toe box, clean outsole with no dirt or wear patterns.",
    metadata: { domain: "sneakers", term: "deadstock" },
  },
  {
    category: "sneaker_authentication",
    content:
      "VNDS (Very Near Deadstock): Tried on or worn very briefly indoors. Extremely minor toe creasing, no outsole wear, box may show minor shelf wear.",
    metadata: { domain: "sneakers", term: "vnds" },
  },
  {
    category: "sneaker_authentication",
    content:
      "Used/Worn condition: Visible outsole wear, toe box creasing, and possible discoloration. Grade based on percentage of sole tread remaining and midsole yellowing.",
    metadata: { domain: "sneakers", term: "used" },
  },
  {
    category: "sneaker_authentication",
    content:
      "Common counterfeit indicators to check: stitching consistency (authentic pairs have even, tight stitching), font/logo alignment on box labels, QR code/UPC on the box matching the shoebox style, and the presence of a size tag sewn into the tongue matching the box label.",
    metadata: { domain: "sneakers", term: "counterfeit_indicators" },
  },
  {
    category: "sneaker_authentication",
    content:
      "Nike/Jordan SKU (style) codes are typically a 6-digit number followed by a 3-digit color code (e.g., 555088-063), found on the inner tag and the box label. This code uniquely identifies the model and colorway and should match between the shoe and box.",
    metadata: { domain: "sneakers", term: "sku_decoding" },
  },
  {
    category: "sneaker_authentication",
    content:
      "adidas style codes are alphanumeric (e.g., GY7378) and appear on both the tongue tag and the box label; the first letters often indicate the release season/collection.",
    metadata: { domain: "sneakers", term: "sku_decoding_adidas" },
  },
];

const ELECTRONICS_STANDARDS = [
  {
    category: "electronics_spec_standard",
    content:
      "Battery health for rechargeable devices (phones, laptops) should be reported as a percentage of original design capacity when available (e.g., iOS Battery Health, Android battery info). Below 80% is generally considered degraded and should be disclosed.",
    metadata: { domain: "electronics", term: "battery_health" },
  },
  {
    category: "electronics_spec_standard",
    content:
      "Model number verification: consumer electronics model numbers are typically printed on a rear/bottom regulatory label alongside FCC ID, serial number, and manufacture date code. The model number determines exact spec variant (storage size, region, generation) and should match the listing title.",
    metadata: { domain: "electronics", term: "model_number" },
  },
  {
    category: "electronics_spec_standard",
    content:
      "Grade A/Refurbished (electronics resale standard): fully functional, minimal cosmetic wear, no cracks or dents. Grade B: functional with moderate cosmetic wear (scratches, scuffs). Grade C: functional but with heavy cosmetic wear. 'For parts/not working' means one or more core functions fail.",
    metadata: { domain: "electronics", term: "cosmetic_grading" },
  },
  {
    category: "electronics_spec_standard",
    content:
      "Ports and connectors (USB-C, Lightning, HDMI) should be visually inspected for bent pins, corrosion, or debris, as these are common failure points that affect functionality and resale value even when the device otherwise powers on.",
    metadata: { domain: "electronics", term: "port_inspection" },
  },
];

const JEWELRY_STANDARDS = [
  {
    category: "jewelry_hallmark_standard",
    content:
      "Gold purity hallmarks: 10K = 41.7% pure gold, 14K = 58.3% pure gold, 18K = 75% pure gold, 24K = 99.9% pure gold. Common US stamps are '10K', '14K', '18K', or the European fineness numbers '417', '585', '750', '999'.",
    metadata: { domain: "jewelry", term: "karat_hallmark" },
  },
  {
    category: "jewelry_hallmark_standard",
    content:
      "Silver purity hallmarks: 'Sterling' or '925' indicates 92.5% pure silver. '999' indicates fine silver (99.9% pure). Silver-plated items are typically stamped 'EP' (electroplate) or 'EPNS' (electroplated nickel silver) and are not solid silver.",
    metadata: { domain: "jewelry", term: "silver_hallmark" },
  },
  {
    category: "jewelry_hallmark_standard",
    content:
      "Platinum hallmarks are usually stamped 'PT' or 'PLAT' followed by a purity number, e.g., 'PT950' (95% pure platinum) or 'PT900' (90% pure platinum).",
    metadata: { domain: "jewelry", term: "platinum_hallmark" },
  },
  {
    category: "jewelry_hallmark_standard",
    content:
      "Hallmark location: stamps are typically found on the inside of a ring band, the clasp of a necklace/bracelet, or the post of an earring. A missing or illegible hallmark does not confirm the metal is fake, but should be disclosed as 'unmarked' rather than assumed.",
    metadata: { domain: "jewelry", term: "hallmark_location" },
  },
  {
    category: "jewelry_hallmark_standard",
    content:
      "Diamond clarity/color grading (GIA scale, for reference only - do not assign a grade without certification): Clarity ranges from FL (Flawless) to I3 (Included); Color ranges from D (colorless) to Z (light yellow/brown). Listings should state 'as graded by [lab]' if a grading report is present, otherwise describe visually observable characteristics only.",
    metadata: { domain: "jewelry", term: "diamond_grading_reference" },
  },
];

const AUTO_PARTS_STANDARDS = [
  {
    category: "auto_parts_fitment",
    content:
      "OEM (Original Equipment Manufacturer) part numbers are unique identifiers assigned by the vehicle manufacturer and are the most reliable way to confirm exact fitment. Aftermarket parts often carry a different manufacturer part number but should list an OEM cross-reference number for compatibility verification.",
    metadata: { domain: "auto_parts", term: "oem_cross_reference" },
  },
  {
    category: "auto_parts_fitment",
    content:
      "Fitment should always be confirmed by Year/Make/Model/Trim and, where applicable, engine size or VIN-specific attributes, since the same part category can differ between trims of the same model year (e.g., different brake caliper designs on base vs. sport trims).",
    metadata: { domain: "auto_parts", term: "fitment_basics" },
  },
  {
    category: "auto_parts_fitment",
    content:
      "Part numbers are typically stamped, laser-etched, or on an adhesive label directly on the part (common locations: alternator housing, brake caliper casting, engine block, ECU casing). This stamped number should be used for identification over a guessed part name.",
    metadata: { domain: "auto_parts", term: "part_number_location" },
  },
  {
    category: "auto_parts_fitment",
    content:
      "Used auto part condition disclosure should note: mileage/hours if known, visible corrosion or fluid leaks, whether the part was pulled from a running vehicle vs. a non-running donor, and any modifications from stock.",
    metadata: { domain: "auto_parts", term: "condition_disclosure" },
  },
];

const HANDBAG_AUTHENTICATION = [
  {
    category: "handbag_authentication",
    content:
      "Louis Vuitton date codes are typically 2 letters followed by 4 digits (e.g., 'SD0123'), stamped on a leather tab inside the bag. The letters indicate the factory/country of manufacture and the digits encode the month/year of production (format and encoding changed over eras, so exact decoding requires era-specific reference).",
    metadata: { domain: "luxury_handbags", term: "lv_date_code" },
  },
  {
    category: "handbag_authentication",
    content:
      "Chanel authenticity cards historically included a serial number sticker inside the bag matching the printed authenticity card (Chanel discontinued serial number stickers in 2021 in favor of a microchip system) - the absence of a matching serial number on pre-2021 bags is a red flag.",
    metadata: { domain: "luxury_handbags", term: "chanel_serial" },
  },
  {
    category: "handbag_authentication",
    content:
      "Common authentication checkpoints across luxury handbag brands: stitching consistency and thread color match, hardware weight and engraving quality (authentic hardware is typically heavier with crisp, evenly-spaced engraving), interior lining material and stamping, and symmetry of logo placement.",
    metadata: { domain: "luxury_handbags", term: "general_authentication_checkpoints" },
  },
  {
    category: "handbag_authentication",
    content:
      "Condition grading for pre-owned luxury handbags: 'Pristine/Like New' - no visible wear; 'Excellent' - light corner wear or minor hardware tarnish; 'Very Good' - noticeable corner wear, light interior staining; 'Good/Fair' - visible wear, marks, or repairs that should be disclosed with photos.",
    metadata: { domain: "luxury_handbags", term: "condition_grading" },
  },
];

const ALL_NEW_DOMAIN_CONTENT = [
  ...SNEAKER_AUTHENTICATION,
  ...ELECTRONICS_STANDARDS,
  ...JEWELRY_STANDARDS,
  ...AUTO_PARTS_STANDARDS,
  ...HANDBAG_AUTHENTICATION,
];

async function getEmbedding(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API Error: ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

async function ingest(items) {
  for (const item of items) {
    // Idempotency check: skip if this exact content already exists for the
    // category (allows safely re-running the script after adding new arrays
    // without duplicating previously-seeded rows).
    const { data: existing, error: lookupError } = await supabase
      .from("knowledge_base")
      .select("id")
      .eq("category", item.category)
      .eq("content", item.content)
      .limit(1);

    if (lookupError) {
      console.error("Supabase lookup error:", lookupError);
      continue;
    }
    if (existing && existing.length > 0) {
      console.log(`Skipping (already seeded): ${item.content.substring(0, 50)}...`);
      continue;
    }

    console.log(`Ingesting [${item.category}]: ${item.content.substring(0, 50)}...`);
    try {
      const embedding = await getEmbedding(item.content);
      const { error } = await supabase.from("knowledge_base").insert({
        content: item.content,
        metadata: item.metadata,
        category: item.category,
        embedding: embedding,
      });

      if (error) console.error("Supabase Error:", error);
    } catch (e) {
      console.error("Failed to ingest item:", e.message);
    }
  }
}

async function main() {
  console.log("Starting knowledge base ingestion...");

  await ingest(ANA_STANDARDS);
  await ingest(ALL_NEW_DOMAIN_CONTENT);

  console.log("Ingestion complete.");
}

main();
