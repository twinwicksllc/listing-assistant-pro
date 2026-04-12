with open('supabase/functions/ebay-publish/index.ts', 'r') as f:
    content = f.read()

old = '*** EBAY-PUBLISH FUNCTION STARTED (v6 - Accept-Language/Content-Language suppressed in ALL header locations) ***'
new = '*** EBAY-PUBLISH FUNCTION STARTED (v8 - Content-Language: en-US in all 3 header locations, Accept-Language omitted) ***'

if old in content:
    content = content.replace(old, new, 1)
    with open('supabase/functions/ebay-publish/index.ts', 'w') as f:
        f.write(content)
    print('Banner updated to v8')
else:
    print('Banner not found - searching...')
    import re
    matches = [line for line in content.split('\n') if 'FUNCTION STARTED' in line]
    for m in matches:
        print(repr(m))

# Also update the force-redeploy comment at top
old2 = '// Force redeploy v7: Category-aware aspect engine'
new2 = '// Force redeploy v8: Content-Language: en-US in all 3 eBay API header locations, Accept-Language omitted'
if old2 in content:
    content = content.replace(old2, new2, 1)
    with open('supabase/functions/ebay-publish/index.ts', 'w') as f:
        f.write(content)
    print('Top comment updated to v8')