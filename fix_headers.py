import re

with open('supabase/functions/ebay-publish/index.ts', 'r') as f:
    content = f.read()

# Fix 1: ensureInventoryLocation headers (POST location)
old1 = '''      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        // eBay rejects Accept-Language header (errorId 25709); override Deno's automatic injection
        "Accept-Language": "",
        "Content-Language": "",
      },
      body: JSON.stringify(locationBody),'''

new1 = '''      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        // Accept-Language intentionally omitted — empty string causes errorId 25709
      },
      body: JSON.stringify(locationBody),'''

# Fix 2: create_draft authHeaders
old2 = '''      // NOTE: eBay Inventory API rejects Accept-Language and Content-Language
      // headers with errorId 25709. Deno fetch may inject Accept-Language automatically
      // based on system locale, so we explicitly override with empty string to suppress it.
      const authHeaders = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "",
        "Content-Language": "",
      };'''

new2 = '''      // NOTE: Accept-Language must be OMITTED entirely — setting it to "" sends an invalid
      // empty locale string which eBay rejects with errorId 25709. Content-Language must
      // be a valid locale (en-US). Simply don't include Accept-Language at all.
      const authHeaders = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      };'''

# Fix 3: get_policies authHeaders
old3 = '''      // NOTE: eBay Inventory API rejects Accept-Language and Content-Language
      // headers with errorId 25709. Deno fetch may inject Accept-Language automatically
      // based on system locale, so we explicitly override with empty string to suppress it.
      const authHeaders = {
        Authorization: `Bearer ${resolvedToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "",
        "Content-Language": "",
      };'''

new3 = '''      // NOTE: Accept-Language must be OMITTED entirely — setting it to "" sends an invalid
      // empty locale string which eBay rejects with errorId 25709. Content-Language must
      // be a valid locale (en-US). Simply don't include Accept-Language at all.
      const authHeaders = {
        Authorization: `Bearer ${resolvedToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      };'''

# Apply fixes
count = 0
if old1 in content:
    content = content.replace(old1, new1, 1)
    count += 1
    print("✅ Fix 1 (ensureInventoryLocation) applied")
else:
    print("❌ Fix 1 NOT FOUND")

if old2 in content:
    content = content.replace(old2, new2, 1)
    count += 1
    print("✅ Fix 2 (create_draft authHeaders) applied")
else:
    print("❌ Fix 2 NOT FOUND")

if old3 in content:
    content = content.replace(old3, new3, 1)
    count += 1
    print("✅ Fix 3 (get_policies authHeaders) applied")
else:
    print("❌ Fix 3 NOT FOUND")

if count > 0:
    with open('supabase/functions/ebay-publish/index.ts', 'w') as f:
        f.write(content)
    print(f"\n✅ Wrote {count} fix(es) to file")
else:
    print("\n❌ No fixes applied — file not modified")

# Verify no empty string headers remain
remaining = content.count('"Accept-Language": ""') + content.count('"Content-Language": ""')
print(f"\nRemaining empty-string language headers: {remaining}")

# Verify valid Content-Language headers exist
valid = content.count('"Content-Language": "en-US"')
print(f"Valid Content-Language: en-US headers: {valid}")