// eBay Taxonomy API helpers for the analyze-item edge function.
// Provides app-token acquisition (cached in memory for the function's lifetime),
// category suggestions, and category-aspect lookups.
//
// All functions return null/empty on error — callers must gracefully degrade.

let _cachedToken: { token: string; expiresAt: number } | null = null;

/** Fetches an OAuth app token using the client_credentials grant. Caches in memory. */
export async function getEbayAppToken(
  clientId: string,
  clientSecret: string,
  ebayEnv: string,
): Promise<string | null> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) {
    return _cachedToken.token;
  }

  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      console.warn("[ebayTaxonomy] token request failed:", resp.status);
      return null;
    }
    const data = await resp.json();
    if (!data.access_token) return null;
    _cachedToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 7200) * 1_000,
    };
    return data.access_token;
  } catch (e) {
    console.warn("[ebayTaxonomy] getEbayAppToken error:", e);
    return null;
  }
}

/** Returns the top 3 eBay category suggestions for the given item query. */
export async function getCategorySuggestions(
  query: string,
  appToken: string,
  ebayEnv: string,
): Promise<Array<{ categoryId: string; categoryName: string }>> {
  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

  try {
    const resp = await fetch(
      `${base}/commerce/taxonomy/v1/category_suggestions?q=${encodeURIComponent(query)}&category_tree_id=0`,
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.categorySuggestions ?? [])
      .slice(0, 3)
      .map((s: any) => ({
        categoryId: String(s.category?.categoryId ?? ""),
        categoryName: String(s.category?.categoryName ?? ""),
      }))
      .filter((s: any) => s.categoryId);
  } catch (e) {
    console.warn("[ebayTaxonomy] getCategorySuggestions error:", e);
    return [];
  }
}

/** Returns required/recommended aspects and allowed values for an eBay category. */
export async function getCategoryAspects(
  categoryId: string,
  appToken: string,
  ebayEnv: string,
): Promise<{
  required: string[];
  recommended: string[];
  allowedValues: Record<string, string[]>;
}> {
  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

  const empty = { required: [], recommended: [], allowedValues: {} };

  try {
    const resp = await fetch(
      `${base}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${
        encodeURIComponent(
          categoryId,
        )
      }`,
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resp.ok) return empty;
    const data = await resp.json();

    const required: string[] = [];
    const recommended: string[] = [];
    const allowedValues: Record<string, string[]> = {};

    for (const aspect of data.aspects ?? []) {
      const name: string = aspect.localizedAspectName;
      if (!name) continue;
      const constraint = aspect.aspectConstraint ?? {};
      if (constraint.aspectRequired) {
        required.push(name);
      } else if (constraint.aspectUsage === "RECOMMENDED") {
        recommended.push(name);
      }
      if (
        Array.isArray(aspect.aspectValues) &&
        aspect.aspectValues.length > 0
      ) {
        allowedValues[name] = aspect.aspectValues
          .slice(0, 20)
          .map((v: any) => v.localizedValue)
          .filter(Boolean);
      }
    }

    return { required, recommended, allowedValues };
  } catch (e) {
    console.warn("[ebayTaxonomy] getCategoryAspects error:", e);
    return empty;
  }
}
