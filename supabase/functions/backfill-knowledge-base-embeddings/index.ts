import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";
import { GEMINI_EMBEDDING_MODEL } from "../_helpers/geminiModels.ts";
import { getEmbedding } from "../_helpers/rag/embedding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * One-off backfill for RBR-0030's embedding-model swap: re-embeds any
 * `knowledge_base` row not already embedded with the current
 * GEMINI_EMBEDDING_MODEL. Two different embedding models don't produce
 * comparable vector spaces even at the same dimension, so leaving old rows
 * on the previous model would silently degrade match_knowledge_base
 * similarity search for those rows. Not scheduled -- invoke manually once
 * via curl with CRON_SECRET after the model-tier consolidation deploys.
 * Idempotent: rows already tagged with the current model in
 * metadata.embedding_model are skipped, so re-running it (e.g. after a
 * future model swap) only re-embeds what's actually stale.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[BACKFILL-KNOWLEDGE-BASE-EMBEDDINGS] auth rejected:",
      JSON.stringify(describeCronAuthEnv(req)),
    );
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const svc = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let scanned = 0;
  let alreadyCurrent = 0;
  let backfilled = 0;
  const errors: Array<{ id: string; error: string }> = [];

  try {
    const { data: rows, error } = await svc
      .from("knowledge_base")
      .select("id, content, metadata");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const row of rows ?? []) {
      scanned++;

      if (row.metadata?.embedding_model === GEMINI_EMBEDDING_MODEL) {
        alreadyCurrent++;
        continue;
      }

      try {
        const embedding = await getEmbedding(geminiKey, row.content);
        const { error: updateError } = await svc
          .from("knowledge_base")
          .update({
            embedding,
            metadata: { ...(row.metadata ?? {}), embedding_model: GEMINI_EMBEDDING_MODEL },
          })
          .eq("id", row.id);

        if (updateError) {
          errors.push({ id: row.id, error: updateError.message });
        } else {
          backfilled++;
        }
      } catch (embedErr) {
        errors.push({
          id: row.id,
          error: embedErr instanceof Error ? embedErr.message : String(embedErr),
        });
      }
    }

    console.log(
      "[BACKFILL-KNOWLEDGE-BASE-EMBEDDINGS] done:",
      JSON.stringify({ scanned, alreadyCurrent, backfilled, errors: errors.length }),
    );

    return new Response(
      JSON.stringify({ scanned, alreadyCurrent, backfilled, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[BACKFILL-KNOWLEDGE-BASE-EMBEDDINGS] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
