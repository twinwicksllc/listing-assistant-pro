# eBay Taxonomy Module Integration Guide

## Overview

The `ebayTaxonomy.ts` module provides a complete system for:
1. **Finding the right eBay category** for an item using AI-generated descriptions
2. **Fetching required/recommended item specifics** (aspects) for that category
3. **Validating user-provided aspects** before publishing
4. **Caching results** to minimize API calls (24h for categories, 7d for aspects)

## Module Structure

```typescript
// Main Functions (exported)
- getCategorySuggestions(description, token) → CategorySuggestion[]
- getRequiredAspects(categoryId, token) → AspectRequirements
- validateAspects(categoryId, providedAspects, token) → ValidationResult
- clearCache() → void

// Types (exported)
- CategorySuggestion
- AspectDetail
- AspectRequirements
- ValidationResult
- EBAY_CATEGORIES (constant)

// Utilities (internal)
- getCachedData<T>(key, ttlHours) → T | null
- setCachedData<T>(key, data) → void
- fetchTaxonomyAPI<T>(endpoint, token) → T
```

---

## Integration with AnalyzePage

The module is designed to integrate seamlessly with the existing `AnalyzePage.tsx` for listing creation.

### Step 1: Add State for Category and Aspects

```tsx
// In AnalyzePage.tsx, add after other form state:

const [categoryId, setCategoryId] = useState<string>("");
const [categoryName, setCategoryName] = useState<string>("");
const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestion[]>([]);
const [aspects, setAspects] = useState<AspectRequirements | null>(null);
const [aspectValidation, setAspectValidation] = useState<ValidationResult | null>(null);
const [loadingCategory, setLoadingCategory] = useState(false);
```

### Step 2: Add Category Discovery Hook

```tsx
import {
  getCategorySuggestions,
  getRequiredAspects,
  validateAspects,
  type CategorySuggestion,
  type AspectRequirements,
  type ValidationResult,
} from "@/lib/ebayTaxonomy";

// Add this function to AnalyzePage:

const handleCategoryDiscovery = async () => {
  if (!title || !ebayToken) {
    toast.error("Title and eBay connection required");
    return;
  }

  setLoadingCategory(true);
  try {
    // Get category suggestions
    const suggestions = await getCategorySuggestions(title, ebayToken);
    
    if (suggestions.length === 0) {
      toast.error("No matching categories found. Try a different description.");
      setCategorySuggestions([]);
      setLoadingCategory(false);
      return;
    }

    setCategorySuggestions(suggestions);
    
    // Auto-select the first (most relevant) suggestion
    const selected = suggestions[0];
    setCategoryId(selected.categoryId);
    setCategoryName(selected.categoryName);

    // Fetch required aspects for this category
    const requirements = await getRequiredAspects(selected.categoryId, ebayToken);
    setAspects(requirements);

    toast.success(`Category selected: ${selected.categoryName}`);
  } catch (error) {
    console.error("Category discovery error:", error);
    const message = error instanceof Error ? error.message : "Failed to discover category";
    toast.error(message);
  } finally {
    setLoadingCategory(false);
  }
};
```

### Step 3: Add Aspect Validation Hook

```tsx
const validateItemAspects = async () => {
  if (!categoryId || !ebayToken) {
    toast.error("Category not selected");
    return;
  }

  try {
    // Build provided aspects from current form state
    const provided: Record<string, string[]> = {};
    
    // Add any filled-in specifics from itemSpecifics
    if (itemSpecifics) {
      for (const [key, value] of Object.entries(itemSpecifics)) {
        if (value && value.trim()) {
          provided[key] = [value];
        }
      }
    }

    // Validate
    const result = await validateAspects(categoryId, provided, ebayToken);
    setAspectValidation(result);

    if (!result.isValid) {
      const errors = [
        ...result.missingRequired.map(name => `Missing required: ${name}`),
        ...result.invalidValues.map(
          inv => `${inv.aspectName}: "${inv.providedValue}" not in allowed values`
        ),
      ];
      toast.error(`Validation failed:\n${errors.join("\n")}`);
      return false;
    }

    if (result.missingSuggested.length > 0) {
      toast.info(
        `Consider filling in: ${result.missingSuggested.join(", ")}`
      );
    }

    toast.success("All required aspects valid!");
    return true;
  } catch (error) {
    console.error("Aspect validation error:", error);
    const message = error instanceof Error ? error.message : "Validation failed";
    toast.error(message);
    return false;
  }
};
```

### Step 4: Update handlePublish

```tsx
const handlePublish = async () => {
  if (!canPublish) {
    toast.error(`Monthly publish limit reached`);
    navigate("/billing");
    return;
  }

  // NEW: Validate policies and aspects
  if (!selectedPolicies.fulfillmentPolicyId || 
      !selectedPolicies.paymentPolicyId || 
      !selectedPolicies.returnPolicyId) {
    toast.error("Please select all eBay policies");
    return;
  }

  if (!categoryId) {
    toast.error("Please select a category");
    return;
  }

  // Validate aspects before publishing
  const aspectsValid = await validateItemAspects();
  if (!aspectsValid) {
    return;
  }

  setPublishing(true);
  try {
    if (!ebayToken) {
      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_auth_url" },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      localStorage.setItem("pending_listing", JSON.stringify({
        title,
        description: getDescriptionWithFooter(),
        listingFormat,
        listingPrice,
        auctionStartPrice,
        auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
        imageUrl: imageUrls[0],
        ebayCategoryId: categoryId, // Use discovered category
        itemSpecifics,
        condition,
      }));
      window.location.href = data.authUrl;
      return;
    }

    const { data, error } = await supabase.functions.invoke("ebay-publish", {
      body: {
        action: "create_draft",
        userToken: ebayToken,
        title,
        description: getDescriptionWithFooter(),
        listingFormat,
        listingPrice,
        auctionStartPrice,
        auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
        imageUrl: imageUrls[0],
        condition,
        ebayCategoryId: categoryId, // Use discovered category
        itemSpecifics,
        listingPolicies: {
          fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
          paymentPolicyId: selectedPolicies.paymentPolicyId,
          returnPolicyId: selectedPolicies.returnPolicyId,
        },
      },
    });

    if (error || data?.error) {
      if (data?.error?.includes("401")) {
        localStorage.removeItem("ebay-user-token");
        toast.error("eBay session expired. Please reconnect.");
        return;
      }
      throw new Error(data?.error || error?.message || "Publish failed");
    }

    const msg = data.listingId
      ? `Listed on eBay! (ID: ${data.listingId})`
      : `Draft created (Offer ID: ${data.offerId})`;
    toast.success(msg);
    await recordUsage("ebay_publish");
    navigate("/dashboard");
  } catch (err: any) {
    console.error("Publish error:", err);
    toast.error(err.message || "Failed to publish");
  } finally {
    setPublishing(false);
  }
};
```

### Step 5: Add UI Section for Category Discovery

```tsx
{/* Add this AFTER the "AI Suggested Grade" section and BEFORE "Pricing" section */}
{generated && (
  <div className="space-y-3 border-t border-border pt-4">
    <div className="flex items-center gap-1.5">
      <Tag className="w-3.5 h-3.5 text-primary" />
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        eBay Category Discovery
      </label>
    </div>

    {!categoryId ? (
      <button
        onClick={handleCategoryDiscovery}
        disabled={loadingCategory || !title}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-foreground text-xs font-medium transition-all hover:bg-secondary/80 active:scale-[0.98] disabled:opacity-60"
      >
        {loadingCategory ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Discovering category...
          </>
        ) : (
          <>
            <Search className="w-3.5 h-3.5" />
            Discover Category
          </>
        )}
      </button>
    ) : (
      <div className="space-y-2">
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs font-medium text-muted-foreground">Selected Category</p>
          <p className="text-sm font-semibold text-foreground">{categoryName}</p>
          <p className="text-[10px] text-muted-foreground mt-1">ID: {categoryId}</p>
        </div>

        {aspects && (
          <div className="bg-muted/40 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">
              Required Specifics ({aspects.required.length})
            </p>
            <div className="grid grid-cols-2 gap-2">
              {aspects.required.map((aspect) => (
                <div
                  key={aspect.name}
                  className="text-[10px] text-muted-foreground bg-card rounded px-2 py-1"
                >
                  {aspect.name}
                  {aspect.allowedValues && (
                    <span className="block text-[9px] text-primary/70">
                      {aspect.allowedValues.length} options
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            setCategoryId("");
            setCategoryName("");
            setAspects(null);
            setAspectValidation(null);
            setCategorySuggestions([]);
          }}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          Change Category
        </button>
      </div>
    )}

    {categorySuggestions.length > 1 && categoryId && (
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Other suggestions ({categorySuggestions.length - 1})
        </summary>
        <div className="mt-2 space-y-1">
          {categorySuggestions.slice(1).map((cat) => (
            <button
              key={cat.categoryId}
              onClick={async () => {
                setCategoryId(cat.categoryId);
                setCategoryName(cat.categoryName);
                const reqs = await getRequiredAspects(cat.categoryId, ebayToken!);
                setAspects(reqs);
                toast.success(`Switched to ${cat.categoryName}`);
              }}
              className="block text-left w-full text-primary hover:underline py-1"
            >
              {cat.categoryName}
            </button>
          ))}
        </div>
      </details>
    )}
  </div>
)}
```

### Step 6: Update Imports

```tsx
import { 
  Loader2, 
  ArrowLeft, 
  Sparkles,
  Search, // NEW
  Tag, // Add if not already present
  // ... other imports
} from "lucide-react";
import {
  getCategorySuggestions,
  getRequiredAspects,
  validateAspects,
  type CategorySuggestion,
  type AspectRequirements,
  type ValidationResult,
} from "@/lib/ebayTaxonomy";
```

---

## Error Handling

The module handles various error scenarios:

```typescript
// Invalid token
try {
  await getCategorySuggestions("silver bar", invalidToken);
} catch (error) {
  // "Invalid or expired OAuth token. Please reconnect your eBay account."
}

// Rate limited
try {
  await getCategorySuggestions("silver bar", token);
} catch (error) {
  // "Rate limited by eBay API. Please wait a moment and try again."
}

// Category not found
try {
  await getRequiredAspects("99999999", token);
} catch (error) {
  // "Resource not found (404). Invalid category ID or endpoint."
}
```

---

## Caching Behavior

The module automatically caches results using localStorage:

```typescript
// Category suggestions cached for 24 hours
getCategorySuggestions("silver bar", token)
// First call: API fetch
// Second call within 24h: Returns cached results
// After 24h: Cache expires, API fetch again

// Aspect requirements cached for 7 days
getRequiredAspects("39482", token)
// First call: API fetch
// Subsequent calls within 7d: Returns cached results

// Manual cache clear
clearCache() // Removes all eBay taxonomy cache entries
```

---

## Quick Reference: Common Categories

```typescript
import { EBAY_CATEGORIES } from "@/lib/ebayTaxonomy";

// Coins & Bullion
EBAY_CATEGORIES.COINS_PAPER_MONEY  // "11116"
EBAY_CATEGORIES.US_COINS            // "11116"
EBAY_CATEGORIES.BULLION             // "39482"
EBAY_CATEGORIES.SILVER_BULLION      // "39489"
EBAY_CATEGORIES.GOLD_BULLION        // "39487"
EBAY_CATEGORIES.PLATINUM_BULLION    // "39488"
EBAY_CATEGORIES.WORLD_COINS         // "256"
EBAY_CATEGORIES.EXONUMIA            // "3452"
```

---

## FAQ

**Q: Why is category discovery separate from publish?**
A: Allows user to verify/change category before commitment. Some items may match multiple categories.

**Q: How often should I validate aspects?**
A: Validate just before publishing. The module handles this in `handlePublish()`.

**Q: Can I skip category discovery?**
A: Yes, you can set `categoryId` directly using `EBAY_CATEGORIES` constants. But discovery is recommended for accuracy.

**Q: What if no categories match?**
A: Empty array returned. Show user message to refine description (e.g., "try 'precious metal bullion' instead of 'bar'").

**Q: How do I update cache TTL?**
A: Edit constants in `ebayTaxonomy.ts`:
```typescript
const CACHE_TTL_CATEGORIES_HOURS = 24;
const CACHE_TTL_ASPECTS_HOURS = 7 * 24; // 7 days
```

---

## Example: Full Workflow

```typescript
// User uploads coin image → AI identifies "1921 Morgan Dollar"
async function completeListingWorkflow(imageFile: File, token: string) {
  // 1. Run AI analysis
  const aiResult = await analyzeImage(imageFile);
  // { description: "1921 Morgan Dollar", composition: "Silver", ... }

  // 2. Discover category
  const categories = await getCategorySuggestions(aiResult.description, token);
  const categoryId = categories[0].categoryId; // "11116" (US Coins)

  // 3. Get requirements
  const aspects = await getRequiredAspects(categoryId, token);
  // Needs: Denomination, Composition, Grade, Year, etc.

  // 4. Fill in aspects from AI data
  const provided = {
    "Denomination": ["Dollar"],
    "Composition": ["Silver"],
    "Grade": [aiResult.grade],
    "Year": ["1921"],
    "Certifier": [aiResult.certifier],
  };

  // 5. Validate
  const validation = await validateAspects(categoryId, provided, token);
  
  if (validation.isValid) {
    // Ready to publish!
    // Proceed with listing creation using categoryId + validated aspects
  }
}
```

---

## Next Steps

1. ✅ Module created in `src/lib/ebayTaxonomy.ts`
2. 👉 Integrate into AnalyzePage using steps above
3. Add UI components for category selector
4. Test with real eBay token
5. Add error recovery UI (retry buttons, reconnect prompts)
