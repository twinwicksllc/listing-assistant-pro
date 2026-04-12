# eBay Taxonomy API - Quick Test Guide

## Testing Without Integration

You can test the taxonomy module directly in the browser console or in a test file.

### Browser Console Testing

```javascript
// 1. Import the module
import { 
  getCategorySuggestions, 
  getRequiredAspects, 
  validateAspects,
  clearCache 
} from './src/lib/ebayTaxonomy.ts';

// 2. Get your eBay OAuth token from localStorage
const token = localStorage.getItem('ebay-user-token');

// 3. Test category discovery
const suggestions = await getCategorySuggestions('1921 Morgan Dollar', token);
console.log("Categories:", suggestions);
// Output:
// [
//   { categoryId: "11116", categoryName: "US Coins", categoryLevel: 2 },
//   { categoryId: "256", categoryName: "World Coins", categoryLevel: 2 },
//   ...
// ]

// 4. Test aspect fetching for the first category
const categoryId = suggestions[0].categoryId;
const aspects = await getRequiredAspects(categoryId, token);
console.log("Required aspects:", aspects.required);
console.log("Recommended aspects:", aspects.recommended);

// 5. Test validation
const validation = await validateAspects(
  categoryId,
  {
    "Denomination": ["Dollar"],
    "Composition": ["Silver"],
    "Grade": ["MS 65"],
    "Year": ["1921"],
  },
  token
);
console.log("Validation result:", validation);
// Output:
// {
//   isValid: true,
//   missingRequired: [],
//   invalidValues: [],
//   missingSuggested: ["Certifier", "Variety"]
// }

// 6. Clear cache if needed
clearCache();
console.log("Cache cleared");
```

## Environment Setup for Testing

### 1. Get a Valid eBay OAuth Token

```bash
# These tokens are obtained through the eBay OAuth flow
# They're stored in localStorage under 'ebay-user-token'

# For testing locally:
1. Go to http://localhost:8080
2. Click "Connect eBay"
3. Complete OAuth flow
4. Token saved automatically to localStorage
5. Can access in DevTools Console: localStorage.getItem('ebay-user-token')
```

### 2. Verify Token Validity

```javascript
// Check your token in Network tab:
// Go to DevTools → Network
// Look for requests to "api.ebay.com/commerce/taxonomy/v1"
// Authorization header should be: Bearer YOUR_TOKEN_HERE

// Quick validation:
fetch('https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=silver', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('ebay-user-token')}`,
    'Content-Type': 'application/json'
  }
}).then(r => r.json()).then(console.log)
```

### 3. Common Test Queries

```javascript
const token = localStorage.getItem('ebay-user-token');

// Test 1: Generic coin (should return multiple results)
await getCategorySuggestions('1921 Morgan Dollar', token);

// Test 2: Specific bullion (should return bullion categories)
await getCategorySuggestions('1 ounce silver bar', token);

// Test 3: Gold (should return gold-specific categories)
await getCategorySuggestions('gold bullion coin', token);

// Test 4: Rare coin (should verify categorization)
await getCategorySuggestions('rare ancient Roman coin', token);

// Test 5: Mixed precious metals
await getCategorySuggestions('silver and gold combo', token);
```

## Expected API Responses

### Category Suggestions (Success)

```json
{
  "suggestionsByCategory": [
    {
      "categoryId": "11116",
      "categoryName": "Coins & Paper Money",
      "categoryLevel": 2,
      "matchCount": 1500
    },
    {
      "categoryId": "39482",
      "categoryName": "Bullion",
      "categoryLevel": 2,
      "matchCount": 950
    }
  ]
}
```

### Category Suggestions (No Results)

```json
{
  "suggestionsByCategory": []
}
// Module returns empty array
```

### Item Aspects (Success)

```json
{
  "aspectConstraints": [
    {
      "aspectDefinition": {
        "name": "Composition",
        "aspectDataType": "STRING",
        "aspectValues": [
          { "valueId": "1", "valueName": "Silver" },
          { "valueId": "2", "valueName": "Gold" }
        ]
      },
      "aspectConstraint": {
        "aspectRequired": true,
        "aspectUsage": "RECOMMENDED",
        "maxValues": 1
      }
    }
  ]
}
```

### Item Aspects (Token Error)

```json
{
  "errors": [
    {
      "errorId": 1001,
      "domain": "OAuth",
      "category": "REQUEST",
      "message": "Invalid access token",
      "longMessage": "The provided access token is invalid or expired"
    }
  ]
}
// Module throws: "Invalid or expired OAuth token. Please reconnect your eBay account."
```

## Debugging Tips

### 1. Check Network Requests

```javascript
// Open DevTools → Network tab
// Filter for: "api.ebay.com"
// Look for:
// - GET requests to /category_tree/0/get_category_suggestions
// - GET requests to /category_tree/0/get_item_aspects_for_category
// - Status 200 = success, 401 = token expired, 404 = not found, 429 = rate limited
```

### 2. Monitor Cache

```javascript
// Check what's cached
JSON.parse(localStorage.getItem('ebay_category_11116_silver'));
JSON.parse(localStorage.getItem('ebay_aspects_11116'));

// View all cache entries
Object.keys(localStorage).filter(k => k.startsWith('ebay_')).forEach(k => {
  const data = JSON.parse(localStorage.getItem(k));
  console.log(k, 'age:', (Date.now() - data.timestamp) / 1000 / 60, 'minutes');
});

// Clear specific cache
localStorage.removeItem('ebay_category_11116_silver');

// Clear all eBay cache
clearCache();
```

### 3. Test Error Scenarios

```javascript
const token = localStorage.getItem('ebay-user-token');

// Test invalid token
try {
  await getCategorySuggestions('silver', 'invalid_token');
} catch (error) {
  console.log("Expected error:", error.message);
  // "Invalid or expired OAuth token. Please reconnect your eBay account."
}

// Test rate limiting (make many rapid requests)
for (let i = 0; i < 20; i++) {
  try {
    await getCategorySuggestions(`query${i}`, token);
  } catch (error) {
    if (error.message.includes('Rate limited')) {
      console.log("Hit rate limit at request", i);
      break;
    }
  }
}

// Test invalid category
try {
  await getRequiredAspects('9999999', token);
} catch (error) {
  console.log("InvalidCategory:", error.message);
  // "Resource not found (404). Invalid category ID or endpoint."
}
```

## Performance Baseline

### Expected Response Times

```
First call (no cache):
- getCategorySuggestions: 200-500ms
- getRequiredAspects: 150-400ms
- validateAspects: 150-400ms (includes getRequiredAspects call)

Cached calls:
- < 5ms (instant)

Cache hit rate after usage:
- Categories: ~95% on repeated descriptions
- Aspects: ~99% (same categories queried repeatedly)
```

### Load Time Test

```javascript
console.time('category-discovery');
const cats = await getCategorySuggestions('silver bar', token);
console.timeEnd('category-discovery');
// Output: category-discovery: 234.56ms (varies by network)

console.time('validation');
const validation = await validateAspects(categoryId, provided, token);
console.timeEnd('validation');
// Output: validation: 156.78ms (varies by network)
```

## Integration Checklist

Before deploying the integration:

- [ ] Test with valid eBay OAuth token
- [ ] Verify category suggestions return expected results
- [ ] Confirm aspect requirements fetch correctly
- [ ] Test validation with valid data (passes)
- [ ] Test validation with invalid data (fails appropriately)
- [ ] Check cache is persisting across page reloads
- [ ] Test cache expiration (after 24h for categories, 7d for aspects)
- [ ] Verify error messages are user-friendly
- [ ] Test on slow network (throttle in DevTools)
- [ ] Verify TypeScript compilation (npm run build)
- [ ] Check for any console errors
- [ ] Test on mobile browser

## Common Issues

### "Invalid or expired OAuth token"
✅ Solution: User needs to reconnect eBay account via "Connect eBay" button

### Empty category suggestions
✅ Solution: Try more specific description (e.g., "1921 silver Morgan dollar" instead of "coin")

### Missing aspects for category
✅ Solution: Check eBay category is valid. Try category ID directly from EBAY_CATEGORIES constant

### Cache not clearing
✅ Solution: Use `clearCache()` function or manually delete localStorage entries starting with `ebay_`

### Rate limit errors
✅ Solution: Implement exponential backoff. Limit queries to 1 per second per user

### "TypeError: Cannot read property 'toString' of undefined"
✅ Solution: Ensure all aspect values are strings, not undefined. Check provided aspects structure

---

## Module Statistics

| Metric | Value |
|--------|-------|
| Lines of Code | 590+ |
| Exported Functions | 7 |
| Exported Types | 6 |
| Error Scenarios Handled | 8 |
| Cache Levels | 2 (categories + aspects) |
| Unit Test Cases Needed | ~15 |

---

For more detailed integration instructions, see [EBAY_TAXONOMY_INTEGRATION.md](./EBAY_TAXONOMY_INTEGRATION.md)
