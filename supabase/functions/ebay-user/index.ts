import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // Verify the caller is an authenticated Supabase user before proxying
    // any request to the eBay Identity API.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwtToken = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(jwtToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userToken } = await req.json();

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

    if (!userToken) {
      return new Response(JSON.stringify({ needsAuth: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user info from eBay Identity API
    const userResp = await fetch(`${apiBase}/commerce/identity/v1/user/`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
    });

    if (userResp.status === 401 || userResp.status === 403) {
      return new Response(JSON.stringify({ needsAuth: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userResp.ok) {
      const errText = await userResp.text();
      console.error("eBay user info error:", userResp.status, errText);
      return new Response(
        JSON.stringify({
          error: `eBay API error ${userResp.status}: ${errText}`,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let userData: any;
    try {
      const respText = await userResp.text();
      userData = JSON.parse(respText);
    } catch (e) {
      console.warn(`ebay-user: Failed to parse eBay user API response: ${e}`);
      return new Response(
        JSON.stringify({ error: `eBay API parse error: ${e}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const username = userData.username || "";
    const businessName = userData.businessAccount?.name || "";
    const accountType = userData.accountType || "UNKNOWN";
    const userId = userData.userId || "";

    return new Response(
      JSON.stringify({
        username,
        businessName,
        accountType,
        userId,
        needsAuth: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-user error:", errorMsg);
    console.error("Full error:", e);
    const isProduction = Deno.env.get("ENVIRONMENT") === "production";
    return new Response(
      JSON.stringify({
        error: `Server error: ${errorMsg}`,
        needsAuth: false,
        debug: !isProduction ? String(e) : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
