import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userToken } = await req.json();
    if (!userToken) throw new Error("No eBay user token provided");

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const apiBase =
      ebayEnv === "production"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

    const authHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    };

    const fetchPolicies = async (policyType: string) => {
      const resp = await fetch(
        `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
        { headers: authHeaders }
      );
      if (!resp.ok) {
        console.warn(`Could not fetch ${policyType} policies:`, resp.status);
        return [];
      }
      const data = await resp.json();
      const key = `${policyType}Policies`;
      const policies = data[key] || [];
      return policies.map((p: any) => ({
        id: p[`${policyType}PolicyId`] || p.policyId || "",
        name: p.name || "(unnamed)",
      }));
    };

    const [fulfillment, payment, returns] = await Promise.all([
      fetchPolicies("fulfillment"),
      fetchPolicies("payment"),
      fetchPolicies("return"),
    ]);

    return new Response(
      JSON.stringify({ fulfillment, payment, returns }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-policies error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
