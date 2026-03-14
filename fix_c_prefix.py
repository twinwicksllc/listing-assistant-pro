"""
PR #119 — Strip C: prefix from all aspect keys in ebay-publish/index.ts
eBay Inventory API expects bare keys: Fineness, Grade, Year — NOT C:Fineness, C:Grade, C:Year
The C: prefix only exists in eBay's Category Tree API taxonomy responses.
"""

with open('supabase/functions/ebay-publish/index.ts', 'r') as f:
    content = f.read()

original = content

# ================================================================
# 1. CATEGORY_ASPECT_RULES — strip C: from all keys
# ================================================================
rules_replacements = [
    # preferred arrays
    ('"C:Shape"', '"Shape"'),
    ('"C:Precious Metal Content per Unit"', '"Precious Metal Content per Unit"'),
    ('"C:Brand/Mint"', '"Brand/Mint"'),
    ('"C:Fineness"', '"Fineness"'),
    ('"C:Certification"', '"Certification"'),
    ('"C:Type"', '"Type"'),
    ('"C:KM Number"', '"KM Number"'),
    ('"C:Circulated/Uncirculated"', '"Circulated/Uncirculated"'),
    ('"C:Year"', '"Year"'),
    ('"C:Strike Type"', '"Strike Type"'),
    ('"C:Mint Location"', '"Mint Location"'),
    ('"C:Denomination"', '"Denomination"'),
    ('"C:Composition"', '"Composition"'),
    ('"C:Grade"', '"Grade"'),
    ('"C:Coin"', '"Coin"'),
    ('"C:Country of Origin"', '"Country of Origin"'),
    ('"C:Total Precious Metal Content"', '"Total Precious Metal Content"'),
    ('"C:Certification Number"', '"Certification Number"'),
    ('"C:Variety"', '"Variety"'),
    ('"C:Era"', '"Era"'),
    ('"C:Cleaned/Uncleaned"', '"Cleaned/Uncleaned"'),
    ('"C:Provenance"', '"Provenance"'),
    ('"C:Metal"', '"Metal"'),
]

for old, new in rules_replacements:
    count = content.count(old)
    content = content.replace(old, new)
    if count:
        print(f"  Replaced {count}x {old} → {new}")

# ================================================================
# 2. VALID_ASPECT_VALUES — keys need bare names
# ================================================================
# Already handled by rules_replacements above since same string patterns

# ================================================================
# 3. ASPECT_KEY_ALIASES — values should map to bare keys (not C: prefixed)
# ================================================================
# After step 1, the aliases now correctly map to bare keys since we replaced
# all "C:X" with "X" globally. But let's verify the aliases themselves
# still make sense — they map FROM AI variants TO canonical bare keys.
# The alias KEYS (left side) should stay as-is since they're the AI's output variants.
# The alias VALUES (right side) were already fixed by step 1 above.

# ================================================================
# 4. normalizeAspectKey() — strip C: instead of adding it
# ================================================================
old_normalize = '''function normalizeAspectKey(key: string): string {
  if (key.startsWith("C:")) return key;
  if (NON_ASPECT_KEYS.has(key)) return key;
  if (ASPECT_KEY_ALIASES[key]) return ASPECT_KEY_ALIASES[key];
  return `C:${key}`;
}'''

new_normalize = '''function normalizeAspectKey(key: string): string {
  // eBay Inventory API expects BARE keys (Fineness, Grade, Year — NOT C:Fineness etc.)
  // The C: prefix is only used in eBay's Category Tree API taxonomy responses, never in payloads.
  // Strip any C: prefix the AI might have output, then resolve aliases to canonical bare names.
  const bare = key.startsWith("C:") ? key.slice(2) : key;
  if (NON_ASPECT_KEYS.has(bare)) return bare;
  if (ASPECT_KEY_ALIASES[bare]) return ASPECT_KEY_ALIASES[bare];
  return bare;
}'''

if old_normalize in content:
    content = content.replace(old_normalize, new_normalize, 1)
    print("✅ normalizeAspectKey() updated to strip C: prefix")
else:
    print("❌ normalizeAspectKey() not found — checking...")
    # Find it manually
    idx = content.find('function normalizeAspectKey')
    if idx >= 0:
        print(repr(content[idx:idx+300]))

# ================================================================
# 5. buildAndNormalizeAspects() — fix key checks (C:Fineness → Fineness etc.)
# ================================================================
old_build1 = '''    if (key === "C:Fineness") value = normalizeFineness(trimmed);
    else if (key === "C:Grade") value = normalizeGrade(trimmed);
    else if (key === "C:Denomination") value = normalizeDenomination(trimmed, categoryId);
    else if (key === "C:Circulated/Uncirculated") {
      const gradeHint = (rawSpecifics["Grade"] as string) || (rawSpecifics["C:Grade"] as string);'''

new_build1 = '''    if (key === "Fineness") value = normalizeFineness(trimmed);
    else if (key === "Grade") value = normalizeGrade(trimmed);
    else if (key === "Denomination") value = normalizeDenomination(trimmed, categoryId);
    else if (key === "Circulated/Uncirculated") {
      const gradeHint = (rawSpecifics["Grade"] as string) || (rawSpecifics["C:Grade"] as string);'''

if old_build1 in content:
    content = content.replace(old_build1, new_build1, 1)
    print("✅ buildAndNormalizeAspects() key checks updated")
else:
    print("❌ buildAndNormalizeAspects() key checks not found")

old_build2 = '''    if (
      rule.required.includes("C:Circulated/Uncirculated") &&
      !aspects["C:Circulated/Uncirculated"]
    ) {
      const grade = aspects["C:Grade"]?.[0];
      const circVal = normalizeCirculatedUncirculated(undefined, grade);
      aspects["C:Circulated/Uncirculated"] = [circVal];
      console.log(`buildAndNormalizeAspects: derived C:Circulated/Uncirculated="${circVal}" from grade="${grade}"`);'''

new_build2 = '''    if (
      rule.required.includes("Circulated/Uncirculated") &&
      !aspects["Circulated/Uncirculated"]
    ) {
      const grade = aspects["Grade"]?.[0];
      const circVal = normalizeCirculatedUncirculated(undefined, grade);
      aspects["Circulated/Uncirculated"] = [circVal];
      console.log(`buildAndNormalizeAspects: derived Circulated/Uncirculated="${circVal}" from grade="${grade}"`);'''

if old_build2 in content:
    content = content.replace(old_build2, new_build2, 1)
    print("✅ buildAndNormalizeAspects() Circulated/Uncirculated logic updated")
else:
    print("❌ buildAndNormalizeAspects() Circulated/Uncirculated logic not found")

# ================================================================
# 6. Update version banner to v9
# ================================================================
old_banner = '*** EBAY-PUBLISH FUNCTION STARTED (v8 - Content-Language: en-US in all 3 header locations, Accept-Language omitted) ***'
new_banner = '*** EBAY-PUBLISH FUNCTION STARTED (v9 - bare aspect keys, no C: prefix in inventory payloads) ***'

if old_banner in content:
    content = content.replace(old_banner, new_banner, 1)
    print("✅ Version banner updated to v9")
else:
    print("❌ v8 banner not found")

old_comment = '// Force redeploy v8: Content-Language: en-US in all 3 eBay API header locations, Accept-Language omitted'
new_comment = '// Force redeploy v9: Strip C: prefix from all aspect keys — eBay Inventory API uses bare keys only'
if old_comment in content:
    content = content.replace(old_comment, new_comment, 1)
    print("✅ Top comment updated to v9")

# ================================================================
# 7. Write and verify
# ================================================================
with open('supabase/functions/ebay-publish/index.ts', 'w') as f:
    f.write(content)

# Final verification
remaining_c_prefix_keys = []
for line_no, line in enumerate(content.split('\n'), 1):
    if '"C:' in line and 'strip' not in line.lower() and 'prefix' not in line.lower() and '//' not in line.split('"C:')[0]:
        remaining_c_prefix_keys.append(f"  line {line_no}: {line.strip()}")

if remaining_c_prefix_keys:
    print(f"\n⚠️  {len(remaining_c_prefix_keys)} remaining C: key references in non-comment lines:")
    for r in remaining_c_prefix_keys[:20]:
        print(r)
else:
    print("\n✅ No C: prefixed keys remain in non-comment lines")

print(f"\nFile size: {len(content)} chars")
print(f"Changes: {len(original) - len(content):+d} chars")