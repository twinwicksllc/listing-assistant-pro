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
  console.error(
    "Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY",
  );
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
    metadata: {
      domain: "luxury_handbags",
      term: "general_authentication_checkpoints",
    },
  },
  {
    category: "handbag_authentication",
    content:
      "Condition grading for pre-owned luxury handbags: 'Pristine/Like New' - no visible wear; 'Excellent' - light corner wear or minor hardware tarnish; 'Very Good' - noticeable corner wear, light interior staining; 'Good/Fair' - visible wear, marks, or repairs that should be disclosed with photos.",
    metadata: { domain: "luxury_handbags", term: "condition_grading" },
  },
];

const TRADING_CARD_GRADING = [
  {
    category: "trading_card_grading",
    content:
      "PSA grades trading cards on four criteria: centering, corners, edges, and surface. PSA 10 (Gem Mint) requires all four to be virtually flawless - no more than one minor flaw among the four categories, and centering must be 55/45 or better on the front and 75/25 or better on the back. PSA does NOT use half grades (a 9.5 does not exist); grades are whole numbers 1 through 10.",
    metadata: { domain: "trading_cards", term: "psa_grading_overview" },
  },
  {
    category: "trading_card_grading",
    content:
      "PSA 9 (Mint) allows one minor flaw - typically a slightly off-center front, a single faint surface print mark, or a minor corner imperfection. The key distinction from PSA 10 is that a PSA 9 card has one noticeable flaw that prevents Gem Mint, whereas a PSA 10 has at most a single trivial imperfection that is nearly invisible to the naked eye.",
    metadata: { domain: "trading_cards", term: "psa_9_vs_10" },
  },
  {
    category: "trading_card_grading",
    content:
      "Beckett (BGS) uses a 10-point scale WITH half grades (e.g., 9.5) and assigns four subgrades: centering, corners, edges, and surface (each scored 1-10). The overall BGS grade is the lowest subgrade or an average depending on the era of the card. BGS is often preferred for modern cards because the subgrades give buyers transparency into specific weaknesses.",
    metadata: { domain: "trading_cards", term: "bgs_subgrades" },
  },
  {
    category: "trading_card_grading",
    content:
      "Edges: On dark-bordered cards (e.g., 1986 Fleer Basketball, Pokemon base set dark energy cards), edge whitening and chipping are highly visible and a leading cause of downgrades. Examine card edges under good lighting for white speckling or fraying. A PSA 10 requires clean edges with no visible chipping; even minor whitening typically caps a card at PSA 8 or 9.",
    metadata: { domain: "trading_cards", term: "edge_whitening_dark_borders" },
  },
  {
    category: "trading_card_grading",
    content:
      "Surface: Inspect the card surface (front and back) for print defects (print lines, print dots, snow, fish-eye printing), scratches, and indentations. A surface wrinkle or crease - even one visible only under backlighting - caps a card at PSA 6 (EX-MT) or lower. Factory print defects present on the unopened pack product can still result in a lowered grade.",
    metadata: { domain: "trading_cards", term: "surface_defects" },
  },
  {
    category: "trading_card_grading",
    content:
      "Corners: PSA 10 requires razor-sharp corners on all four corners with no fraying, dinging, or rounding. Corners are inspected on both front and back. A single softly touched (dinged) corner typically results in a PSA 9. Multiple corner issues or a noticeably rounded corner will drop the grade to PSA 7-8 range.",
    metadata: { domain: "trading_cards", term: "corner_condition" },
  },
];

const VINTAGE_CLOTHING_AUTHENTICATION = [
  {
    category: "vintage_clothing_authentication",
    content:
      "ILGWU union label timeline for dating vintage garments: 1900-1936 AFL label; 1936-1940 CIO label; 1940-1955 AFL label; 1955-1963 AFL-CIO scalloped crest WITHOUT an 'R' (Registered) trademark symbol; 1964-1973 AFL-CIO label WITH 'R' trademark symbol added; 1974-1995 red/white/blue color-coded label; 1995-2005 UNITE! label (ILGWU merged with ACTWU); 2005+ UNITE HERE! label. The presence and design of a union label can date a garment to within a 10-20 year window.",
    metadata: {
      domain: "vintage_clothing",
      term: "ilgwu_union_label_timeline",
    },
  },
  {
    category: "vintage_clothing_authentication",
    content:
      "RN (Registered Identification Number) numbers on garment tags were assigned by the FTC starting in 1952. An RN number lower than approximately 13617 indicates a garment manufactured before 1959 (numbers were assigned sequentially). An RN number of 11722 or lower generally indicates pre-1956 manufacture. RN numbers are issued to manufacturers and can be looked up on the FTC database to identify the company.",
    metadata: { domain: "vintage_clothing", term: "rn_number_dating" },
  },
  {
    category: "vintage_clothing_authentication",
    content:
      "Care label requirement: The FTC Care Labeling Rule required care labels on all textile wearing apparel starting July 3, 1972. A garment WITHOUT a care label that is clearly post-1972 in style may be homemade, non-US market, or pre-1972 vintage. The absence of a care label on an otherwise modern-looking garment is a useful dating clue (pre-1972).",
    metadata: { domain: "vintage_clothing", term: "care_label_1972" },
  },
  {
    category: "vintage_clothing_authentication",
    content:
      "Country-of-origin labeling: 'Made in USA' vs 'Made in U.S.A.' vs 'Made in U.S. of A.' wording variations changed by era, but the most useful dating clue is the shift from US domestic manufacturing to imported garments. A garment labeled with a country like 'Made in Hong Kong' or 'Made in Korea' suggests 1960s-1980s import era. The introduction of country-of-origin requirements and tariff codes provides a terminus post quem (earliest possible date).",
    metadata: { domain: "vintage_clothing", term: "country_of_origin_dating" },
  },
  {
    category: "vintage_clothing_authentication",
    content:
      "Tag and label design clues: Look for tag material (paper vs woven vs printed acetate), font styles, and brand logo changes. Nylon and polyester (early synthetics) appeared in mainstream clothing from the 1950s onward; pure acetate linings suggest 1930s-1950s. Metal zippers (pre-1960s, especially Talon) vs plastic zippers (post-1960s YKK dominance) is a reliable dating feature. Side-seam zippers on dresses suggest 1930s-1950s; back zippers became standard from the 1960s.",
    metadata: { domain: "vintage_clothing", term: "tag_and_zipper_dating" },
  },
];

const MUSICAL_INSTRUMENT_AUTHENTICATION = [
  {
    category: "instrument_identification",
    content:
      "Fender serial number location by era: Bridge plate (1950-1954, early Broadcaster/Telecaster); neckplate (1954-1976); headstock front or back (1976+). Post-1976 Fender US serials use a letter prefix indicating decade: 'S' = 1970s, 'E' = 1980s, 'N' = 1990s, 'Z' = 2000s, 'US10' or higher = 2010s+. The serial number provides an approximate production-year estimate only, because Fender's modular construction means necks and bodies were stockpiled and assembled later.",
    metadata: {
      domain: "musical_instruments",
      term: "fender_serial_number_eras",
    },
  },
  {
    category: "instrument_identification",
    content:
      "Fender Made in Japan (MIJ) serial prefixes: 'JV' = 1982-1984, 'SQ' = 1983-1984, 'E' = 1984-1987, 'A' through 'L' = 1985-1997. These instruments carry a 'Made in Japan' decal. Starting in 1997, Fender switched the decal to 'Crafted in Japan' with prefixes 'A' through 'T' (1997-2010s). The distinction between 'Made in Japan' (1982-1997) and 'Crafted in Japan' (1997+) is a key dating and authentication checkpoint.",
    metadata: { domain: "musical_instruments", term: "fender_mij_prefixes" },
  },
  {
    category: "instrument_identification",
    content:
      "Fender Made in Mexico (MIM) serial prefixes: 'MN' = 1990s, 'MZ' = 2000s, 'MX10'+ = 2010s. MIM instruments are generally more affordable than US-made equivalents but are legitimate Fender products. Body and neck dating: dates pencil-written or stamped at the neck joint (butt end of the neck and inside the neck pocket) are the MOST reliable dating source, often more accurate than the headstock serial number.",
    metadata: { domain: "musical_instruments", term: "fender_mim_prefixes" },
  },
  {
    category: "instrument_identification",
    content:
      "Gibson serial numbers use a different system than Fender. Pre-1908: no serials or hand-written. 1908-1929: sequential numbers. 1930-1946: factory order number (FON) stamped inside the body. 1970-1972: serials starting with a 6-digit number where the first digit = year (e.g., 0xxxxx = 1970). 1977+: 'YYDDDSNNN' format where YY = year, DDD = day of year, S = plant code, NNN = production rank. Gibson's Nashville vs Memphis vs Bozeman plants have different serial schemes - always verify against Gibson's published charts.",
    metadata: { domain: "musical_instruments", term: "gibson_serial_systems" },
  },
  {
    category: "instrument_identification",
    content:
      "Authentication checkpoints for guitars: neck joint date stamps/pencil marks (most reliable), headstock shape and logo style (changed by era - e.g., Fender 'spaghetti' logo 1950s vs 'transition' logo mid-1960s vs 'CBS' logo 1965+), tuner type and brand (Kluson, Grover, Schaller by era), pickup bobbin and wire color, potentiometer date codes (6-digit code: YYWW where YY = year, WW = week), and neck profile. The potentiometer date code gives the earliest possible build date since pots are installed during assembly.",
    metadata: {
      domain: "musical_instruments",
      term: "guitar_authentication_checkpoints",
    },
  },
];

const TOYS_COLLECTIBLES_AUTHENTICATION = [
  {
    category: "toy_authentication",
    content:
      "Authentication via wear patterns: Natural use wear is uneven - concentrated on edges, protruding parts, and areas a child would naturally grip. Artificial distressing (fake aging) tends to be uniform across the surface. Genuine vintage paint loss shows layered chipping revealing undercoat then bare metal, while faux aging is a single uniform layer. This wear-pattern analysis is a primary authentication method for antique and vintage toys.",
    metadata: {
      domain: "toys_collectibles",
      term: "wear_pattern_authentication",
    },
  },
  {
    category: "toy_authentication",
    content:
      "Manufacturer marks and date codes: Mattel Hot Wheels baseplate date codes - the year molded into the base indicates the year the MOLD was created, not the production year (a 1968 mold could still be cast in 1972). Kenner Star Wars figures carry Country of Origin (COO) stamps on the leg or back - 'Hong Kong' and 'Taiwan' are the most common. Barbie body markings changed by year: early 1959 Ponytail Barbie has 'Barbie' and '1958' molded inside the torso; markings evolved with each era. Always cross-reference manufacturer-specific marking databases.",
    metadata: { domain: "toys_collectibles", term: "manufacturer_date_codes" },
  },
  {
    category: "toy_authentication",
    content:
      "Materials by era: Pre-WWII toys used tin, cast iron, steel, and celluloid. 1950s toys used early plastics (acetate, polystyrene) that become brittle and show shrinkage cracks over decades. 1960s toys introduced ABS plastic which yellows but does not crack. Die-cast zinc alloy toys (post-1930s) can suffer 'zinc pest' or 'zinc rot' - crystalline swelling and cracking that confirms genuine age (it does not occur in modern reproductions). The presence of zinc pest on a die-cast toy is strong evidence of authentic vintage age.",
    metadata: { domain: "toys_collectibles", term: "materials_by_era" },
  },
  {
    category: "toy_authentication",
    content:
      "Packaging authentication: Vintage toy packaging used offset lithography printing which shows a characteristic dot pattern (rosette/halftone dots) under magnification. Modern reproductions and counterfeits use digital printing which shows a smooth, pixelated pattern without the dot rosette. Cardboard aging (yellowing, edge foxing, staple rust) on genuine vintage packaging is difficult to reproduce convincingly. A pristine box with modern digital printing on aged-looking cardboard is a red flag.",
    metadata: { domain: "toys_collectibles", term: "packaging_authentication" },
  },
  {
    category: "toy_authentication",
    content:
      "AFA (Action Figure Authority) grading: AFA grades action figures and related collectibles on a 1-100 scale with three subgrades: Card, Bubble, and Figure. AFA 85 (Near Mint+) is the typical target for high-value vintage figures; AFA 90+ is exceptional. AFA also assigns a 'C' (C-ollection) grade for loose (unboxed) figures. The bubble (the clear plastic blister holding the figure) is often the weakest component - edge cracks, yellowing, and dents are common and significantly reduce grade.",
    metadata: { domain: "toys_collectibles", term: "afa_grading" },
  },
];

const HOME_GARDEN_TOOLS_IDENTIFICATION = [
  {
    category: "tool_identification",
    content:
      "Vintage tool dating via patina and materials: An antique tool should be at least 100 years old and a vintage tool at least 20 years old. Key age indicators: patina (natural tarnish, honest rust, chipped paint from real use), materials (worn wood handles, cast iron, forged steel suggest pre-mid-20th-century; stainless steel and modern plastics indicate mid-20th-century onward), and construction methods (hand-forging, hand-filed surfaces, forge-welded seams vs arc-welded or machine-milled). A tool showing hand-finishing marks is likely quite old.",
    metadata: { domain: "home_garden_tools", term: "vintage_tool_dating" },
  },
  {
    category: "tool_identification",
    content:
      "Maker's marks and patent dates: Examine the tool for stamps on blades, shafts, flat metal surfaces, and handles. A maker's mark or company name identifies the manufacturer and can be cross-referenced against the company's active years to date the tool. A patent number stamped on a tool is one of the most precise dating tools available - patent numbers can be looked up at the US Patent and Trademark Office (USPTO) to find the exact patent issue date, which establishes the earliest possible manufacture date for that tool design.",
    metadata: { domain: "home_garden_tools", term: "makers_mark_patent_date" },
  },
  {
    category: "tool_identification",
    content:
      "Power tool safety certification marks: 'UL Listed' means the COMPLETE finished product was independently tested by Underwriters Laboratories against safety standards (UL 745 / UL 60745 for hand-held motor-operated electric tools) and found compliant - this is the mark required for US retail sale. 'UL Recognized' applies only to COMPONENTS (motors, switches, cords), NOT the finished product - a UL Recognized component does NOT make the finished tool UL Listed. Do not confuse these two marks when verifying a power tool.",
    metadata: { domain: "home_garden_tools", term: "ul_listed_vs_recognized" },
  },
  {
    category: "tool_identification",
    content:
      "ETL Listed mark is issued by Intertek and is an OSHA-recognized Nationally Recognized Testing Laboratory (NRTL) equivalent to UL for US workplace and retail compliance. From a regulatory standpoint ETL and UL are equivalent - both satisfy OSHA NRTL requirements and both are accepted by major US retailers (Home Depot, Lowe's, Walmart). ETL certification is typically faster (8-14 weeks vs UL's 10-20 weeks) and lower cost. 'cUL' and 'cETL' marks indicate the certification also covers Canadian (CSA) requirements.",
    metadata: { domain: "home_garden_tools", term: "etl_vs_ul" },
  },
  {
    category: "tool_identification",
    content:
      "European power tool certification marks: 'CE' marking is mandatory for all power tools sold in the European Economic Area and is largely a manufacturer SELF-declaration (no independent authority approves it) - the CE mark is only as reliable as the technical file behind it. 'GS' (Geprufte Sicherheit, 'tested safety') is a voluntary third-party certification (TUV Rheinland, TUV SUD, DEKRA, or VDE) that is NOT self-declared and is strongly preferred by German/DACH retailers. GS is to CE what UL third-party testing is to manufacturer self-testing.",
    metadata: { domain: "home_garden_tools", term: "ce_vs_gs_marks" },
  },
  {
    category: "tool_identification",
    content:
      "Power tool model and serial number locations: The model number and serial number are typically found on a nameplate/rating plate - check the main tool body housing, near the motor, on the handle underside, or on a sticker/plate near the power cord entry. These numbers identify the exact model, manufacturing date range, and parts compatibility. For vintage power tools, the nameplate design itself (logo style, address, 'Made in USA' vs imported) is a dating clue - early Black & Decker and Stanley tools carried distinct nameplate designs that changed by decade.",
    metadata: { domain: "home_garden_tools", term: "model_serial_location" },
  },
];

const ALL_NEW_DOMAIN_CONTENT = [
  ...SNEAKER_AUTHENTICATION,
  ...ELECTRONICS_STANDARDS,
  ...JEWELRY_STANDARDS,
  ...AUTO_PARTS_STANDARDS,
  ...HANDBAG_AUTHENTICATION,
  ...TRADING_CARD_GRADING,
  ...VINTAGE_CLOTHING_AUTHENTICATION,
  ...MUSICAL_INSTRUMENT_AUTHENTICATION,
  ...TOYS_COLLECTIBLES_AUTHENTICATION,
  ...HOME_GARDEN_TOOLS_IDENTIFICATION,
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
      console.log(
        `Skipping (already seeded): ${item.content.substring(0, 50)}...`,
      );
      continue;
    }

    console.log(
      `Ingesting [${item.category}]: ${item.content.substring(0, 50)}...`,
    );
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
