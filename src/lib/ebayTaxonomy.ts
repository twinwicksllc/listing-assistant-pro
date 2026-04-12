/**
 * eBay Taxonomy API Module
 * 
 * Provides category discovery, required aspects fetching, and validation
 * for eBay listings using the Taxonomy API.
 * 
 * Features:
 * - Find correct eBay category ID from product description
 * - Fetch required and recommended item specifics for category
 * - Validate provided aspects against category requirements
 * - Intelligent caching (24h categories, 7d aspects)
 * 
 * @module ebayTaxonomy
 */

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

/**
 * Category suggestion from eBay Taxonomy API
 */
export interface CategorySuggestion {
  /** eBay category ID */
  categoryId: string;
  /** Human-readable category name */
  categoryName: string;
  /** Depth level in category tree */
  categoryTreeNodeLevel?: number;
}

/**
 * Detailed information about an item aspect (specific)
 */
export interface AspectDetail {
  /** Name of the aspect (e.g., "Composition", "Fineness") */
  name: string;
  /** Data type of aspect values */
  dataType: 'STRING' | 'STRING_ARRAY' | 'NUMBER';
  /** Predefined allowed values for dropdown-style aspects */
  allowedValues?: string[];
  /** Maximum length for string values */
  maxLength?: number;
}

/**
 * Required and recommended aspects for a category
 */
export interface AspectRequirements {
  /** Aspects that must be provided before listing */
  required: AspectDetail[];
  /** Aspects that should be provided for better listing quality */
  recommended: AspectDetail[];
}

/**
 * Result of aspect validation
 */
export interface ValidationResult {
  /** Whether all required aspects are valid */
  isValid: boolean;
  /** Names of required aspects that are missing */
  missingRequired: string[];
  /** Aspects with values not in allowed list */
  invalidValues: {
    aspectName: string;
    providedValue: string;
    allowedValues: string[];
  }[];
  /** Names of recommended aspects that are missing */
  missingSuggested: string[];
}

/**
 * Internal cache entry structure
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Common eBay category IDs for coins and bullion
 * 
 * Reference for quick category selection without API lookup.
 */
export const EBAY_CATEGORIES = {
  COINS_PAPER_MONEY: '11116',
  US_COINS: '11116',
  BULLION: '39482',
  SILVER_BULLION: '39489',
  GOLD_BULLION: '39487',
  PLATINUM_BULLION: '39488',
  WORLD_COINS: '256',
  EXONUMIA: '3452',
} as const;

const BASE_URL = 'https://api.ebay.com/commerce/taxonomy/v1';
const CATEGORY_TREE_ID = '0'; // US marketplace
const CACHE_TTL_CATEGORIES_HOURS = 24;
const CACHE_TTL_ASPECTS_HOURS = 7 * 24; // 7 days

// ============================================================================
// CACHING UTILITIES
// ============================================================================

/**
 * Retrieve data from localStorage cache if still valid
 * 
 * @template T - Type of cached data
 * @param {string} key - Cache key
 * @param {number} ttlHours - Time-to-live in hours
 * @returns {T | null} Cached data if valid, null if expired or missing
 * 
 * @example
 * const cached = getCachedData<CategorySuggestion[]>('ebay_categories_coins', 24);
 */
function getCachedData<T>(key: string, ttlHours: number): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const ageMs = Date.now() - entry.timestamp;
    const maxAgeMs = ttlHours * 60 * 60 * 1000;

    if (ageMs > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }

    return entry.data;
  } catch (error) {
    console.warn(`Failed to retrieve cache for key "${key}":`, error);
    return null;
  }
}

/**
 * Store data in localStorage cache with timestamp
 * 
 * @template T - Type of data to cache
 * @param {string} key - Cache key
 * @param {T} data - Data to cache
 * 
 * @example
 * setCachedData('ebay_categories_coins', categories);
 */
function setCachedData<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.warn(`Failed to cache data for key "${key}":`, error);
  }
}

/**
 * Clear all eBay taxonomy cache entries
 * 
 * Removes all cached category suggestions and aspect requirements.
 * Useful when user wants to refresh data or troubleshoot caching issues.
 * 
 * @example
 * clearCache();
 */
export function clearCache(): void {
  try {
    const keys = Object.keys(localStorage);
    const ebayKeys = keys.filter(
      (key) => key.startsWith('ebay_category_') || key.startsWith('ebay_aspects_')
    );
    ebayKeys.forEach((key) => localStorage.removeItem(key));
    console.log(`Cleared ${ebayKeys.length} cache entries`);
  } catch (error) {
    console.warn('Failed to clear cache:', error);
  }
}

// ============================================================================
// API UTILITIES
// ============================================================================

/**
 * Make authenticated request to eBay Taxonomy API
 * 
 * @param {string} endpoint - API endpoint path
 * @param {string} token - OAuth bearer token
 * @returns {Promise<any>} Parsed JSON response
 * @throws {Error} On network error, auth failure, rate limiting, or invalid response
 */
async function fetchTaxonomyAPI<T>(endpoint: string, token: string): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error(
        'Invalid or expired OAuth token. Please reconnect your eBay account.'
      );
    }

    if (response.status === 429) {
      throw new Error(
        'Rate limited by eBay API. Please wait a moment and try again.'
      );
    }

    if (response.status === 404) {
      throw new Error('Resource not found (404). Invalid category ID or endpoint.');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `eBay API error ${response.status}: ${errorBody || response.statusText}`
      );
    }

    const data: T = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error fetching from eBay Taxonomy API: ${error}`);
  }
}

// ============================================================================
// MODULE 1: CATEGORY DISCOVERY
// ============================================================================

/**
 * Internal eBay API response for category suggestions
 */
interface EbayGetCategorySuggestionsResponse {
  categorySuggestions?: Array<{
    category?: {
      categoryId?: string;
      categoryName?: string;
      categoryTreeNodeLevel?: number;
    };
  }>;
}

/**
 * Get category suggestions for a product description
 * 
 * Uses the eBay Taxonomy API to find the best-matching categories for a
 * product description. Results are cached for 24 hours to reduce API calls.
 * 
 * @param {string} productDescription - Product description or keywords
 *                                      (e.g., "1oz silver bar", "Morgan Dollar")
 * @param {string} oauthToken - eBay OAuth bearer token with sell scope
 * @returns {Promise<CategorySuggestion[]>} Suggested categories, sorted by relevance
 * @throws {Error} If API call fails, token is invalid, or rate limited
 * 
 * @example
 * const suggestions = await getCategorySuggestions("1oz silver bar", token);
 * // Returns: [
 * //   { categoryId: "39482", categoryName: "Bullion" },
 * //   { categoryId: "39489", categoryName: "Silver Bullion" }
 * // ]
 */
export async function getCategorySuggestions(
  productDescription: string,
  oauthToken: string
): Promise<CategorySuggestion[]> {
  const cacheKey = `ebay_category_${productDescription
    .toLowerCase()
    .replace(/\s+/g, '_')
    .substring(0, 50)}`;

  // Try cache first
  const cached = getCachedData<CategorySuggestion[]>(
    cacheKey,
    CACHE_TTL_CATEGORIES_HOURS
  );
  if (cached) {
    console.log(`[Cache Hit] Category suggestions for "${productDescription}"`);
    return cached;
  }

  try {
    console.log(`[API Call] Fetching category suggestions for "${productDescription}"`);
    const encodedQuery = encodeURIComponent(productDescription);
    const endpoint = `/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?q=${encodedQuery}`;

    const response = await fetchTaxonomyAPI<EbayGetCategorySuggestionsResponse>(
      endpoint,
      oauthToken
    );

    // Parse response
    const suggestions: CategorySuggestion[] = [];
    if (response.categorySuggestions && Array.isArray(response.categorySuggestions)) {
      for (const suggestion of response.categorySuggestions) {
        if (suggestion.category?.categoryId && suggestion.category?.categoryName) {
          suggestions.push({
            categoryId: suggestion.category.categoryId,
            categoryName: suggestion.category.categoryName,
            categoryTreeNodeLevel: suggestion.category.categoryTreeNodeLevel,
          });
        }
      }
    }

    // Cache results
    setCachedData(cacheKey, suggestions);

    return suggestions;
  } catch (error) {
    console.error('Error fetching category suggestions:', error);
    throw error;
  }
}

// ============================================================================
// MODULE 2: REQUIRED ASPECTS FETCHING
// ============================================================================

/**
 * Internal eBay API response for item aspects
 */
interface EbayGetItemAspectsResponse {
  aspects?: Array<{
    localizedAspectName?: string;
    aspectDataType?: string;
    aspectConstraint?: {
      aspectRequired?: boolean;
      aspectUsage?: string;
    };
    aspectValues?: Array<{
      localizedValue?: string;
    }>;
  }>;
}

/**
 * Get required and recommended item aspects for a category
 * 
 * Fetches all required and recommended item specifics (aspects) for a given
 * category ID. This tells you what information must or should be provided
 * before creating a listing. Results are cached for 7 days.
 * 
 * @param {string} categoryId - eBay category ID (e.g., "39482for Bullion")
 * @param {string} oauthToken - eBay OAuth bearer token with sell scope
 * @returns {Promise<AspectRequirements>} Required and recommended aspects
 * @throws {Error} If category not found (404), API fails, or token invalid
 * 
 * @example
 * const aspects = await getRequiredAspects("39482", token);
 * // Returns:
 * // {
 * //   required: [
 * //     {
 * //       name: "Composition",
 * //       dataType: "STRING",
 * //       allowedValues: ["Silver", "Gold", "Platinum", ...]
 * //     },
 * //     {
 * //       name: "Fineness",
 * //       dataType: "STRING",
 * //       allowedValues: [".999", ".9999", ".95", ...]
 * //     },
 * //     {
 * //       name: "Total Precious Metal Content",
 * //       dataType: "STRING"
 * //     }
 * //   ],
 * //   recommended: [
 * //     {
 * //       name: "Brand/Mint",
 * //       dataType: "STRING"
 * //     },
 * //     {
 * //       name: "Year",
 * //       dataType: "NUMBER"
 * //     }
 * //   ]
 * // }
 */
export async function getRequiredAspects(
  categoryId: string,
  oauthToken: string
): Promise<AspectRequirements> {
  const cacheKey = `ebay_aspects_${categoryId}`;

  // Try cache first
  const cached = getCachedData<AspectRequirements>(cacheKey, CACHE_TTL_ASPECTS_HOURS);
  if (cached) {
    console.log(`[Cache Hit] Aspects for category ${categoryId}`);
    return cached;
  }

  try {
    console.log(`[API Call] Fetching aspects for category ${categoryId}`);
    const endpoint = `/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${categoryId}`;

    const response = await fetchTaxonomyAPI<EbayGetItemAspectsResponse>(
      endpoint,
      oauthToken
    );

    const required: AspectDetail[] = [];
    const recommended: AspectDetail[] = [];

    if (response.aspects && Array.isArray(response.aspects)) {
      for (const aspect of response.aspects) {
        if (!aspect.localizedAspectName) continue;

        const detail: AspectDetail = {
          name: aspect.localizedAspectName,
          dataType: parseDataType(aspect.aspectDataType),
          allowedValues: parseAllowedValues(aspect.aspectValues),
          maxLength: undefined, // Could be extended from API if available
        };

        const isRequired = aspect.aspectConstraint?.aspectRequired === true;
        const isRecommended = aspect.aspectConstraint?.aspectUsage === 'RECOMMENDED';

        if (isRequired) {
          required.push(detail);
        } else if (isRecommended) {
          recommended.push(detail);
        }
      }
    }

    const result: AspectRequirements = { required, recommended };

    // Cache results
    setCachedData(cacheKey, result);

    return result;
  } catch (error) {
    console.error(`Error fetching aspects for category ${categoryId}:`, error);
    throw error;
  }
}

/**
 * Parse eBay aspect data type to our enum
 */
function parseDataType(
  ebayDataType: string | undefined
): 'STRING' | 'STRING_ARRAY' | 'NUMBER' {
  if (ebayDataType === 'NUMBER') return 'NUMBER';
  if (ebayDataType === 'STRING_ARRAY') return 'STRING_ARRAY';
  return 'STRING'; // Default
}

/**
 * Extract allowed values from eBay aspect values array
 */
function parseAllowedValues(
  aspectValues: Array<{ localizedValue?: string }> | undefined
): string[] | undefined {
  if (!aspectValues || aspectValues.length === 0) {
    return undefined;
  }

  const values = aspectValues
    .map((av) => av.localizedValue)
    .filter((v): v is string => typeof v === 'string');

  return values.length > 0 ? values : undefined;
}

// ============================================================================
// MODULE 3: ASPECT VALIDATION
// ============================================================================

/**
 * Validate provided aspects against category requirements
 * 
 * Checks that:
 * 1. All required aspects are provided
 * 2. All provided values match allowed values (if aspect has constraints)
 * 3. Identifies missing recommended aspects for quality improvement
 * 
 * This is the main validation function used before creating a listing.
 * 
 * @param {string} categoryId - eBay category ID
 * @param {Record<string, string[]>} providedAspects - Aspects provided by user
 *                                                      (e.g., { "Composition": ["Silver"], "Fineness": [".999"] })
 * @param {string} oauthToken - eBay OAuth bearer token with sell scope
 * @returns {Promise<ValidationResult>} Detailed validation result
 * @throws {Error} If category not found or API call fails
 * 
 * @example
 * const result = await validateAspects("39482", {
 *   "Composition": ["Silver"],
 *   "Fineness": [".999"],
 *   "Total Precious Metal Content": ["1 oz"],
 *   "Brand/Mint": ["Sunshine Mint"]
 * }, token);
 * 
 * if (!result.isValid) {
 *   console.error("Missing required:", result.missingRequired);
 *   // Prompt user to fill in missing info
 * } else {
 *   console.log("Ready to list!");
 * }
 */
export async function validateAspects(
  categoryId: string,
  providedAspects: Record<string, string[]>,
  oauthToken: string
): Promise<ValidationResult> {
  try {
    const requirements = await getRequiredAspects(categoryId, oauthToken);

    const missingRequired: string[] = [];
    const invalidValues: ValidationResult['invalidValues'] = [];
    const missingSuggested: string[] = [];

    // Check required aspects
    for (const required of requirements.required) {
      const provided = providedAspects[required.name];

      if (!provided || provided.length === 0) {
        missingRequired.push(required.name);
        continue;
      }

      // Validate against allowed values if applicable
      if (required.allowedValues && required.allowedValues.length > 0) {
        for (const value of provided) {
          if (!required.allowedValues.includes(value)) {
            invalidValues.push({
              aspectName: required.name,
              providedValue: value,
              allowedValues: required.allowedValues,
            });
          }
        }
      }
    }

    // Check recommended aspects
    for (const recommended of requirements.recommended) {
      const provided = providedAspects[recommended.name];
      if (!provided || provided.length === 0) {
        missingSuggested.push(recommended.name);
      }
    }

    return {
      isValid: missingRequired.length === 0 && invalidValues.length === 0,
      missingRequired,
      invalidValues,
      missingSuggested,
    };
  } catch (error) {
    console.error('Error validating aspects:', error);
    throw error;
  }
}

// ============================================================================
// EXAMPLE WORKFLOW
// ============================================================================

/**
 * Complete workflow example: Identify item → Get category → Get aspects → Validate
 * 
 * This demonstrates the full process of listing a precious metal using AI-identified
 * product data and the eBay Taxonomy API.
 * 
 * @example
 * // Simulate AI identifying a 1oz silver bar
 * async function exampleWorkflow() {
 *   const token = "your_oauth_token";
 *   
 *   // Step 1: AI identifies the item and extracts details
 *   const aiResult = {
 *     description: "1oz silver bar",
 *     composition: "Silver",
 *     fineness: ".999",
 *     weight: "1 oz",
 *     brand: "Sunshine Mint"
 *   };
 *   
 *   try {
 *     // Step 2: Get category suggestions based on description
 *     console.log("Finding best category for:", aiResult.description);
 *     const categories = await getCategorySuggestions(aiResult.description, token);
 *     
 *     if (categories.length === 0) {
 *       console.error("No matching categories found");
 *       return;
 *     }
 *     
 *     const categoryId = categories[0].categoryId;
 *     console.log(`Selected category: ${categories[0].categoryName} (ID: ${categoryId})`);
 *     
 *     // Step 3: Get required and recommended aspects
 *     const requirements = await getRequiredAspects(categoryId, token);
 *     console.log("Required aspects:", requirements.required.map(a => a.name));
 *     console.log("Recommended aspects:", requirements.recommended.map(a => a.name));
 *     
 *     // Step 4: Build aspect payload from AI results
 *     const providedAspects: Record<string, string[]> = {
 *       "Composition": [aiResult.composition],
 *       "Fineness": [aiResult.fineness],
 *       "Total Precious Metal Content": [aiResult.weight],
 *       "Brand/Mint": [aiResult.brand]
 *     };
 *     
 *     // Step 5: Validate provided aspects
 *     const validation = await validateAspects(categoryId, providedAspects, token);
 *     
 *     if (!validation.isValid) {
 *       console.error("Validation failed!");
 *       console.error("Missing required:", validation.missingRequired);
 *       console.error("Invalid values:", validation.invalidValues);
 *       return;
 *     }
 *     
 *     if (validation.missingSuggested.length > 0) {
 *       console.warn("Missing suggested aspects:", validation.missingSuggested);
 *       // Optionally prompt user to fill in these for better listing quality
 *     }
 *     
 *     console.log("✓ All validations passed! Ready to create listing");
 *     return {
 *       categoryId,
 *       aspects: providedAspects,
 *       validation
 *     };
 *     
 *   } catch (error) {
 *     console.error("Error during workflow:", error);
 *     // Handle errors appropriately
 *     // - Show user-friendly message
 *     // - Suggest reconnecting eBay account if 401
 *     // - Suggest retrying if 429 (rate limited)
 *   }
 * }
 * 
 * // Run the example
 * // exampleWorkflow();
 */
export const exampleWorkflow = async (token: string) => {
  const aiResult = {
    description: "1oz silver bar",
    composition: "Silver",
    fineness: ".999",
    weight: "1 oz",
    brand: "Sunshine Mint"
  };

  const categories = await getCategorySuggestions(aiResult.description, token);
  const categoryId = categories[0].categoryId;

  const requirements = await getRequiredAspects(categoryId, token);

  const providedAspects: Record<string, string[]> = {
    "Composition": [aiResult.composition],
    "Fineness": [aiResult.fineness],
    "Total Precious Metal Content": [aiResult.weight],
    "Brand/Mint": [aiResult.brand]
  };

  const validation = await validateAspects(categoryId, providedAspects, token);

  return {
    categoryId,
    categoryName: categories[0].categoryName,
    requirements,
    validation,
    providedAspects
  };
};
