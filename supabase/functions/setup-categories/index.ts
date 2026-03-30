import postgres from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const databaseUrl = Deno.env.get("DATABASE_URL")!;

Deno.serve(async (req) => {
  // Allow requests without authorization
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const client = new postgres.Client(databaseUrl);

  try {
    await client.connect();

    // Create category_mappings table with all columns
    const createTableSQL = `
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
    `;

    console.log("Creating category_mappings table...");
    await client.queryArray(createTableSQL);
    console.log("✓ Table created");

    // Pre-populate with verified mappings
    const mappings = [
      [
        "wheat penny 1909-1958",
        "39455",
        "Wheat Penny (1909-1958)",
        "user_verified",
        100,
      ],
      [
        "kennedy half dollar",
        "41102",
        "Kennedy Half Dollar",
        "user_verified",
        100,
      ],
      [
        "franklin half dollar",
        "11973",
        "Franklin Half Dollar",
        "user_verified",
        100,
      ],
      ["copper rounds", "166679", "Copper Rounds", "user_verified", 100],
      ["morgan dollar", "41419", "Morgan Dollar", "user_verified", 100],
      ["peace dollar", "41421", "Peace Dollar", "user_verified", 100],
      ["barber coin", "11970", "Barber Coin", "user_verified", 100],
      [
        "liberty walking half dollar",
        "11973",
        "Liberty Walking Half Dollar",
        "user_verified",
        100,
      ],
      [
        "lincoln cent 1909-1958",
        "39455",
        "Lincoln Cent (1909-1958)",
        "user_verified",
        100,
      ],
      ["silver eagle", "165752", "Silver Eagle", "user_verified", 100],
    ];

    console.log("Inserting verified mappings...");
    for (
      const [coin_type, categoryId, categoryName, source, confidence]
        of mappings
    ) {
      try {
        await client.queryArray(
          `INSERT INTO public.category_mappings (coin_type, ebay_category_id, category_name, verification_source, confidence)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (coin_type) DO NOTHING`,
          [coin_type, categoryId, categoryName, source, confidence],
        );
      } catch (e) {
        console.log(`  - ${coin_type}: ${e.message}`);
      }
    }

    console.log("✓ Mappings inserted");

    await client.end();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Category mappings table initialized",
        count: mappings.length,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (error) {
    console.error("Setup error:", error);
    try {
      await client.end();
    } catch {
      // ignore
    }

    return new Response(
      JSON.stringify({ error: String(error) }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
});
