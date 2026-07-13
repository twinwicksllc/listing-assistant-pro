// Test database helpers for automated function testing
// Provides access to the test_items table and test fixture utilities

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

export function getTestClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for testing",
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

export interface TestItem {
  id: string;
  domain: string;
  title: string;
  description: string;
  price_min: number;
  price_max: number;
  listing_price: number;
  ebay_category_id: string;
  item_specifics: Record<string, any>;
  condition: string;
  image_urls?: string[] | null;
  metal_type?: string | null;
}

/**
 * Get all test items, optionally filtered by domain
 */
export async function getTestItems(domain?: string): Promise<TestItem[]> {
  const client = getTestClient();
  let query = client.from("test_items").select("*");

  if (domain) {
    query = query.eq("domain", domain);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch test items: ${error.message}`);
  }

  return data as TestItem[];
}

/**
 * Get a single test item by domain for quick testing
 */
export async function getTestItemByDomain(domain: string): Promise<TestItem> {
  const items = await getTestItems(domain);
  if (!items.length) {
    throw new Error(`No test items found for domain: ${domain}`);
  }
  return items[0];
}

/**
 * Get items by title pattern (useful for targeting specific test items)
 */
export async function getTestItemByTitle(
  titlePattern: string,
): Promise<TestItem> {
  const client = getTestClient();
  const { data, error } = await client
    .from("test_items")
    .select("*")
    .ilike("title", `%${titlePattern}%`)
    .limit(1)
    .single();

  if (error) {
    throw new Error(`Test item not found: ${titlePattern}`);
  }

  return data as TestItem;
}

/**
 * Get random test item from all items
 */
export async function getRandomTestItem(): Promise<TestItem> {
  const client = getTestClient();
  const { count, error: countError } = await client
    .from("test_items")
    .select("*", { count: "exact", head: true });

  if (countError || !count) {
    throw new Error("Failed to count test items");
  }

  const offset = Math.floor(Math.random() * count);
  const { data, error } = await client
    .from("test_items")
    .select("*")
    .range(offset, offset)
    .single();

  if (error) {
    throw new Error("Failed to fetch random test item");
  }

  return data as TestItem;
}

/**
 * Test domains available in test_items.
 * Expanded to all 12 domains matching pipelineContracts.ts so that test
 * coverage can include the newly-classifiable domains (sneakers, auto_parts,
 * luxury_handbags, musical_instruments, toys_collectibles, home_garden_tools).
 * Note: test_items rows for the new domains may need to be seeded via a
 * migration before integration tests can exercise them.
 */
export const TEST_DOMAINS = [
  "coins_bullion",
  "trading_cards",
  "jewelry",
  "electronics",
  "vintage_clothing",
  "auto_parts",
  "sneakers",
  "luxury_handbags",
  "musical_instruments",
  "toys_collectibles",
  "home_garden_tools",
  "general",
] as const;
