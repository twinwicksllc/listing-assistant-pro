with open('supabase/functions/ebay-publish/index.ts', 'r') as f:
    content = f.read()

# Fix 1: duplicate rawSpecifics["Grade"] in gradeHint line
old1 = '      const gradeHint = (rawSpecifics["Grade"] as string) || (rawSpecifics["Grade"] as string);'
new1 = '      const gradeHint = (rawSpecifics["Grade"] as string) || undefined;'
if old1 in content:
    content = content.replace(old1, new1, 1)
    print("✅ Fixed duplicate gradeHint lookup")
else:
    print("❌ gradeHint line not found")

# Fix 2: stale C: in console.log string literal
old2 = '      console.log(`buildAndNormalizeAspects: derived C:Circulated/Uncirculated="${circVal}" from grade="${grade}"`);'
new2 = '      console.log(`buildAndNormalizeAspects: derived Circulated/Uncirculated="${circVal}" from grade="${grade}"`);'
if old2 in content:
    content = content.replace(old2, new2, 1)
    print("✅ Fixed console.log string literal")
else:
    print("❌ console.log string literal not found")

with open('supabase/functions/ebay-publish/index.ts', 'w') as f:
    f.write(content)

# Final check: any remaining C: in non-comment, non-string-literal lines
print("\n--- Final C: prefix scan ---")
for line_no, line in enumerate(content.split('\n'), 1):
    stripped = line.strip()
    # Skip comment lines and the normalizeAspectKey function itself (which mentions C: legitimately)
    if stripped.startswith('//') or stripped.startswith('*'):
        continue
    if '"C:' in line or "'C:" in line:
        # Skip the legitimate C: stripping logic in normalizeAspectKey
        if 'startsWith("C:")' in line or "slice(2)" in line:
            continue
        print(f"  line {line_no}: {stripped}")