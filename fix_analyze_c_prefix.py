"""
Fix analyze-item/index.ts:
- Remove all C: prefix instructions from system prompt
- Update itemSpecifics schema to use bare keys
"""

with open('supabase/functions/analyze-item/index.ts', 'r') as f:
    content = f.read()

original = content

# ================================================================
# 1. Fix the system prompt — Section 5 "STRUCTURED ITEM SPECIFICS"
# ================================================================
old_section5 = '''5. STRUCTURED ITEM SPECIFICS — C: PREFIX REQUIRED
ALL aspect keys in itemSpecifics for coin and bullion items MUST use the "C:" prefix (e.g., "C:Fineness", "C:Grade", "C:Certification"). This prefix is mandatory for eBay's Inventory API.

EXCEPTIONS — these keys do NOT get the C: prefix (they are metadata, not eBay aspects):
  Type, Brand, Material, Color, Size, Mintage, Series, Modified Item, Mint Mark

ASPECT VALUE FORMATS (strictly enforced):
- C:Fineness: decimal format ONLY → "0.999", "0.9999", "0.925", "0.900" (NOT "999 fine", "99.9%", "999/1000")
- C:Grade: space-separated format → "MS 65", "AU 55", "VF 30" (NOT "MS-65", "MS65")
- C:Denomination (half dollar series): exactly "50C" (NOT "Half Dollar", "50 Cents", "$0.50")
- C:Denomination (dollar series): exactly "$1" (NOT "One Dollar", "1 Dollar", "$1.00")
- C:Circulated/Uncirculated: exactly "Circulated", "Uncirculated", or "Unknown"
- C:Certification: exactly one of "Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC"
- C:Strike Type: exactly one of "Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte"
- C:Shape (bullion): exactly "Bar" or "Round"
- C:Composition: exactly one of "Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel"

For bullion (bars, rounds, ingots): Type, C:Shape, C:Metal, C:Fineness, C:Precious Metal Content per Unit, C:Year, C:Country of Origin, C:Brand/Mint, C:Denomination, Modified Item.
For coins: Type, C:Year, C:Denomination, C:Grade, C:Circulated/Uncirculated, C:Mint Location, C:Country of Origin, C:Composition, C:Certification, C:Strike Type, C:Fineness, C:Precious Metal Content per Unit.
For non-coin collectibles: Type, Brand, Material, Color, Size, C:Country of Origin, C:Year.
Omit fields that cannot be confidently determined.'''

new_section5 = '''5. STRUCTURED ITEM SPECIFICS — BARE KEYS (NO C: PREFIX)
ALL aspect keys in itemSpecifics must use BARE key names — no "C:" prefix. The eBay Inventory API expects plain keys like Fineness, Grade, Year, Certification. The C: prefix only exists in eBay's internal Category Tree taxonomy and must NEVER appear in listing payloads.

ASPECT VALUE FORMATS (strictly enforced):
- Fineness: decimal format ONLY → "0.999", "0.9999", "0.925", "0.900" (NOT "999 fine", "99.9%", "999/1000")
- Grade: space-separated format → "MS 65", "AU 55", "VF 30" (NOT "MS-65", "MS65")
- Denomination (half dollar series): exactly "50C" (NOT "Half Dollar", "50 Cents", "$0.50")
- Denomination (dollar series): exactly "$1" (NOT "One Dollar", "1 Dollar", "$1.00")
- Circulated/Uncirculated: exactly "Circulated", "Uncirculated", or "Unknown"
- Certification: exactly one of "Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC"
- Strike Type: exactly one of "Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte"
- Shape (bullion): exactly "Bar" or "Round"
- Composition: exactly one of "Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel"

For bullion (bars, rounds, ingots): Type, Shape, Metal, Fineness, Precious Metal Content per Unit, Year, Country of Origin, Brand/Mint, Denomination, Modified Item.
For coins: Type, Year, Denomination, Grade, Circulated/Uncirculated, Mint Location, Country of Origin, Composition, Certification, Strike Type, Fineness, Precious Metal Content per Unit.
For non-coin collectibles: Type, Brand, Material, Color, Size, Country of Origin, Year.
Omit fields that cannot be confidently determined.'''

if old_section5 in content:
    content = content.replace(old_section5, new_section5, 1)
    print("✅ System prompt Section 5 updated")
else:
    print("❌ Section 5 not found — searching for partial match...")
    if "C: PREFIX REQUIRED" in content:
        print("  Found 'C: PREFIX REQUIRED' — partial match exists")
    if "BARE KEYS" in content:
        print("  Already has BARE KEYS")

# ================================================================
# 2. Fix category routing section — remove C: from fixed aspects
# ================================================================
old_fixed = '''FIXED ASPECTS for priority coin categories (do NOT override these — they are enforced server-side):
  Morgan Dollars (39464):          C:Composition="Silver", C:Fineness="0.900", C:Denomination="$1"
  Peace Dollars (11980):           C:Composition="Silver", C:Fineness="0.900", C:Denomination="$1"
  Barber Half Dollars (11971):     C:Composition="Silver", C:Fineness="0.900", C:Denomination="50C"
  Liberty Walking Half (41099):    C:Composition="Silver", C:Fineness="0.900", C:Denomination="50C"
  Gold Bars & Rounds (178906):     C:Composition="Gold"
  Silver Bars & Rounds (39489):    C:Composition="Silver"
  Other Silver Bullion (3361):     C:Composition="Silver"

REQUIRED ASPECTS for priority coin categories (always include these):
  Eisenhower, Morgan, Peace, Barber, Liberty Walking → C:Certification, C:Circulated/Uncirculated
  Other Silver Bullion (3361)                        → C:Certification (default: "Uncertified")'''

new_fixed = '''FIXED ASPECTS for priority coin categories (do NOT override these — they are enforced server-side):
  Morgan Dollars (39464):          Composition="Silver", Fineness="0.900", Denomination="$1"
  Peace Dollars (11980):           Composition="Silver", Fineness="0.900", Denomination="$1"
  Barber Half Dollars (11971):     Composition="Silver", Fineness="0.900", Denomination="50C"
  Liberty Walking Half (41099):    Composition="Silver", Fineness="0.900", Denomination="50C"
  Gold Bars & Rounds (178906):     Composition="Gold"
  Silver Bars & Rounds (39489):    Composition="Silver"
  Other Silver Bullion (3361):     Composition="Silver"

REQUIRED ASPECTS for priority coin categories (always include these):
  Eisenhower, Morgan, Peace, Barber, Liberty Walking → Certification, Circulated/Uncirculated
  Other Silver Bullion (3361)                        → Certification (default: "Uncertified")'''

if old_fixed in content:
    content = content.replace(old_fixed, new_fixed, 1)
    print("✅ Fixed aspects section updated")
else:
    print("❌ Fixed aspects section not found")

# ================================================================
# 3. Fix itemSpecifics schema — replace C:-prefixed property names with bare keys
# ================================================================
old_schema = '''                      properties: {
                        // --- Non-aspect metadata fields (NO C: prefix) ---
                        Type: { type: "string", description: "Product type metadata (e.g., 'Bullion Coin', 'Bar', 'Round', 'Medal', 'Coin') — NO C: prefix" },
                        Series: { type: "string", description: "Series or theme name (e.g., 'Disney', 'Star Wars') — NO C: prefix" },
                        "Modified Item": { type: "string", description: "Whether item has been modified — almost always 'No' — NO C: prefix" },
                        Mintage: { type: "string", description: "Total mintage/edition size if known (e.g., '250', '5000') — NO C: prefix" },
                        "Mint Mark": { type: "string", description: "Mint mark on the coin (e.g., 'P', 'D', 'S', 'W', 'CC', 'O', 'None') — NO C: prefix" },
                        Brand: { type: "string", description: "Brand name for non-coin items — NO C: prefix" },
                        Material: { type: "string", description: "Material for non-coin items — NO C: prefix" },

                        // --- C: prefixed eBay aspect fields (REQUIRED prefix) ---
                        "C:Year": { type: "string", description: "Year of manufacture/minting (e.g., '2025')" },
                        "C:Metal": { type: "string", description: "Primary precious metal (e.g., 'Silver', 'Gold', 'Platinum', 'Palladium')" },
                        "C:Fineness": { type: "string", description: "Fineness as decimal ONLY: '0.999', '0.9999', '0.9675', '0.925', '0.900' — never '999 fine' or '99.9%'" },
                        "C:Composition": { type: "string", enum: ["Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel", "Steel", "Zinc"], description: "Metal composition — must match allowed values exactly" },
                        "C:Precious Metal Content per Unit": { type: "string", description: "Metal weight per piece (e.g., '1 Troy oz', '1/2 Troy oz', '1/4 Troy oz', '1 g')" },
                        "C:Country of Origin": { type: "string", description: "Country that issued or manufactured the item" },
                        "C:Grade": { type: "string", description: "Coin grade with SPACE separator: 'MS 65', 'AU 55', 'VF 30' — never 'MS-65' or 'MS65'" },
                        "C:Denomination": { type: "string", description: "Face value: half-dollar series use '50C'; dollar series use '$1'; other denominations as shown on coin" },
                        "C:Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated", "Unknown"], description: "Circulation status — must be exactly one of the three allowed values" },
                        "C:Certification": { type: "string", enum: ["Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC"], description: "Grading certification — default to 'Uncertified' if no slab visible" },
                        "C:Strike Type": { type: "string", enum: ["Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte"], description: "Type of strike — use 'Business' for standard circulation strikes" },
                        "C:Shape": { type: "string", enum: ["Bar", "Round"], description: "Bullion physical form — must be exactly 'Bar' or 'Round'" },
                        "C:Mint Location": { type: "string", description: "Mint facility (e.g., 'Philadelphia', 'Denver', 'San Francisco', 'West Point', 'Carson City', 'New Orleans')" },
                        "C:Brand/Mint": { type: "string", description: "Who made/minted bullion (e.g., 'New Zealand Mint', 'Perth Mint', 'APMEX', 'Scottsdale Mint')" },
                        "C:KM Number": { type: "string", description: "Krause-Mishler catalog number for ancient/medieval/world coins" },
                        "C:Era": { type: "string", description: "Historical era for ancient/medieval coins (e.g., 'Byzantine', 'Roman Imperial', 'Medieval')" },
                        "C:Cleaned/Uncleaned": { type: "string", description: "Whether ancient/medieval coin has been cleaned" },
                        "C:Provenance": { type: "string", description: "Known provenance or collection history for ancient/medieval coins" },
                        "C:Variety": { type: "string", description: "Die variety or VAM designation if known" },
                      },'''

new_schema = '''                      properties: {
                        // --- Metadata fields (not sent as eBay aspects, used for listing context) ---
                        Type: { type: "string", description: "Product type (e.g., 'Bullion Coin', 'Bar', 'Round', 'Medal', 'Coin')" },
                        Series: { type: "string", description: "Series or theme name (e.g., 'Disney', 'Star Wars')" },
                        "Modified Item": { type: "string", description: "Whether item has been modified — almost always 'No'" },
                        Mintage: { type: "string", description: "Total mintage/edition size if known (e.g., '250', '5000')" },
                        "Mint Mark": { type: "string", description: "Mint mark on the coin (e.g., 'P', 'D', 'S', 'W', 'CC', 'O', 'None')" },
                        Brand: { type: "string", description: "Brand name for non-coin items" },
                        Material: { type: "string", description: "Material for non-coin items" },

                        // --- eBay aspect fields — BARE keys, NO C: prefix ---
                        Year: { type: "string", description: "Year of manufacture/minting (e.g., '2025')" },
                        Metal: { type: "string", description: "Primary precious metal (e.g., 'Silver', 'Gold', 'Platinum', 'Palladium')" },
                        Fineness: { type: "string", description: "Fineness as decimal ONLY: '0.999', '0.9999', '0.9675', '0.925', '0.900' — never '999 fine' or '99.9%'" },
                        Composition: { type: "string", enum: ["Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel", "Steel", "Zinc"], description: "Metal composition — must match allowed values exactly" },
                        "Precious Metal Content per Unit": { type: "string", description: "Metal weight per piece (e.g., '1 Troy oz', '1/2 Troy oz', '1/4 Troy oz', '1 g')" },
                        "Country of Origin": { type: "string", description: "Country that issued or manufactured the item" },
                        Grade: { type: "string", description: "Coin grade with SPACE separator: 'MS 65', 'AU 55', 'VF 30' — never 'MS-65' or 'MS65'" },
                        Denomination: { type: "string", description: "Face value: half-dollar series use '50C'; dollar series use '$1'; other denominations as shown on coin" },
                        "Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated", "Unknown"], description: "Circulation status — must be exactly one of the three allowed values" },
                        Certification: { type: "string", enum: ["Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC"], description: "Grading certification — default to 'Uncertified' if no slab visible" },
                        "Strike Type": { type: "string", enum: ["Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte"], description: "Type of strike — use 'Business' for standard circulation strikes" },
                        Shape: { type: "string", enum: ["Bar", "Round"], description: "Bullion physical form — must be exactly 'Bar' or 'Round'" },
                        "Mint Location": { type: "string", description: "Mint facility (e.g., 'Philadelphia', 'Denver', 'San Francisco', 'West Point', 'Carson City', 'New Orleans')" },
                        "Brand/Mint": { type: "string", description: "Who made/minted bullion (e.g., 'New Zealand Mint', 'Perth Mint', 'APMEX', 'Scottsdale Mint')" },
                        "KM Number": { type: "string", description: "Krause-Mishler catalog number for ancient/medieval/world coins" },
                        Era: { type: "string", description: "Historical era for ancient/medieval coins (e.g., 'Byzantine', 'Roman Imperial', 'Medieval')" },
                        "Cleaned/Uncleaned": { type: "string", description: "Whether ancient/medieval coin has been cleaned" },
                        Provenance: { type: "string", description: "Known provenance or collection history for ancient/medieval coins" },
                        Variety: { type: "string", description: "Die variety or VAM designation if known" },
                      },'''

if old_schema in content:
    content = content.replace(old_schema, new_schema, 1)
    print("✅ itemSpecifics schema updated to bare keys")
else:
    print("❌ itemSpecifics schema not found — checking for partial...")
    if '"C:Year"' in content:
        print("  Found C:Year — schema still has C: prefix")
    if 'Year: { type: "string"' in content:
        print("  Found bare Year — schema already updated")

with open('supabase/functions/analyze-item/index.ts', 'w') as f:
    f.write(content)

# Verify
remaining = [(i+1, l.strip()) for i, l in enumerate(content.split('\n'))
             if '"C:' in l and not l.strip().startswith('//')]
print(f"\n--- Remaining C: prefix in non-comment lines: {len(remaining)} ---")
for lineno, line in remaining[:20]:
    print(f"  line {lineno}: {line}")

if not remaining:
    print("✅ No C: prefix keys remain in analyze-item")