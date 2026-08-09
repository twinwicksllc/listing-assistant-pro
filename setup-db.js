#!/usr/bin/env node

/**
 * Setup script to create category_mappings table in Supabase
 * Run: node setup-db.js
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupDatabase() {
  console.log("Creating category_mappings table...");

  // Create table
  const { data: createTableResult, error: createTableError } = await supabase
    .rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS public.category_mappings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          coin_type TEXT NOT NULL UNIQUE,
          ebay_category_id TEXT NOT NULL,
          category_name TEXT,
          verified_at TIMESTAMPTZ DEFAULT NOW(),
          verification_source TEXT DEFAULT 'user_verified',
          confidence SMALLINT DEFAULT 100,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_category_mappings_coin_type ON public.category_mappings(coin_type);
      `,
    })
    .catch((e) => ({ data: null, error: e }));

  if (createTableError) {
    console.error("Error creating table:", createTableError);
  } else {
    console.log("✓ Table created");
  }

  // Pre-populate with verified mappings
  const mappings = [
    { coin_type: "wheat penny 1909-1958", categoryId: "39455" },
    { coin_type: "kennedy half dollar", categoryId: "41102" },
    { coin_type: "franklin half dollar", categoryId: "11973" },
    { coin_type: "copper rounds", categoryId: "166679" },
    { coin_type: "morgan dollar", categoryId: "41419" },
    { coin_type: "peace dollar", categoryId: "41421" },
    { coin_type: "barber coin", categoryId: "11970" },
    { coin_type: "liberty walking half dollar", categoryId: "11973" },
    { coin_type: "lincoln cent 1909-1958", categoryId: "39455" },
    { coin_type: "silver eagle", categoryId: "165752" },
  ];

  console.log("Inserting verified category mappings...");

  for (const mapping of mappings) {
    const { error } = await supabase
      .from("category_mappings")
      .upsert(
        {
          coin_type: mapping.coin_type,
          ebay_category_id: mapping.categoryId,
          verification_source: "user_verified",
          confidence: 100,
        },
        { onConflict: "coin_type" },
      )
      .catch((e) => ({ error: e }));

    if (error) {
      console.error(`Error inserting ${mapping.coin_type}:`, error);
    } else {
      console.log(`✓ ${mapping.coin_type} -> ${mapping.categoryId}`);
    }
  }

  console.log("\n✓ Database setup complete!");
}

setupDatabase().catch(console.error);
