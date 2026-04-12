import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COST_THRESHOLD = 50;
const ADMIN_EMAIL = "twinwicksllc@gmail.com";
// Approximate cost per token (Gemini Pro pricing)
const COST_PER_INPUT_TOKEN = 0.00000125;
const COST_PER_OUTPUT_TOKEN = 0.000005;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const svc = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    console.log("[COST-ALERT-CRON] Starting daily cost check...");

    // Calculate start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Query gemini_usage for this month
    const { data: usageData, error: usageErr } = await svc
      .from("gemini_usage")
      .select("prompt_tokens, completion_tokens")
      .gte("created_at", startOfMonth);

    if (usageErr) throw new Error(`Failed to query usage: ${usageErr.message}`);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const totalRequests = usageData?.length || 0;

    for (const row of usageData || []) {
      totalInputTokens += row.prompt_tokens || 0;
      totalOutputTokens += row.completion_tokens || 0;
    }

    const totalCost =
      totalInputTokens * COST_PER_INPUT_TOKEN +
      totalOutputTokens * COST_PER_OUTPUT_TOKEN;

    console.log(`[COST-ALERT-CRON] Month total: $${totalCost.toFixed(4)} across ${totalRequests} requests`);

    if (totalCost < COST_THRESHOLD) {
      console.log(`[COST-ALERT-CRON] Below threshold ($${COST_THRESHOLD}). No alert needed.`);
      return new Response(
        JSON.stringify({ alert: false, totalCost, totalRequests }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if we already sent an alert today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const { data: existingAlerts } = await svc
      .from("cost_alerts")
      .select("id")
      .gte("sent_at", todayStart)
      .limit(1);

    if (existingAlerts && existingAlerts.length > 0) {
      console.log("[COST-ALERT-CRON] Alert already sent today. Skipping.");
      return new Response(
        JSON.stringify({ alert: false, reason: "already_sent_today", totalCost, totalRequests }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email via Resend (if API key is configured)
    const resendKey = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;

    if (resendKey) {
      try {
        const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: "Teckstart Alerts <alerts@teckstart.com>",
            to: [ADMIN_EMAIL],
            subject: `⚠️ Teckstart Cost Alert: $${totalCost.toFixed(2)} this month`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #dc2626; margin-bottom: 16px;">⚠️ Monthly AI Cost Alert</h2>
                <p style="color: #374151; font-size: 16px;">Your Gemini AI costs have exceeded the <strong>$${COST_THRESHOLD.toFixed(2)}</strong> monthly threshold.</p>
                <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin: 20px 0;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Current Month Cost</td>
                      <td style="padding: 8px 0; text-align: right; font-weight: bold; font-size: 18px; color: #dc2626;">$${totalCost.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Total API Requests</td>
                      <td style="padding: 8px 0; text-align: right; font-weight: bold; font-size: 18px; color: #374151;">${totalRequests.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Input Tokens</td>
                      <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #374151;">${totalInputTokens.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Output Tokens</td>
                      <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #374151;">${totalOutputTokens.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Period</td>
                      <td style="padding: 8px 0; text-align: right; color: #374151;">${monthName}</td>
                    </tr>
                  </table>
                </div>
                <p style="color: #6b7280; font-size: 14px;">Review usage patterns on the Admin Control Center or consider implementing additional rate limits.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                <p style="color: #9ca3af; font-size: 12px;">This is an automated alert from Teckstart AI Assistant.</p>
              </div>
            `,
          }),
        });

        if (emailRes.ok) {
          emailSent = true;
          console.log("[COST-ALERT-CRON] Alert email sent successfully.");
        } else {
          const errBody = await emailRes.text();
          console.error("[COST-ALERT-CRON] Resend API error:", errBody);
        }
      } catch (emailErr) {
        console.error("[COST-ALERT-CRON] Email sending failed:", emailErr);
      }
    } else {
      console.log("[COST-ALERT-CRON] No RESEND_API_KEY configured. Skipping email. Alert still logged.");
    }

    // Record the alert in the database regardless
    await svc.from("cost_alerts").insert({
      total_cost: totalCost,
      total_requests: totalRequests,
      threshold: COST_THRESHOLD,
    });

    console.log("[COST-ALERT-CRON] Alert recorded in cost_alerts table.");

    return new Response(
      JSON.stringify({ alert: true, emailSent, totalCost, totalRequests }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[COST-ALERT-CRON] Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
