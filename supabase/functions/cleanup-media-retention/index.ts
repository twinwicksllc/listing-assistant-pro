import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-cleanup-secret, content-type",
  "Access-Control-Max-Age": "86400",
};

const BUCKET_ID = "listing-images";
const TTL_DAYS = 15;
const DRAFT_GRACE_DAYS = 60;
const PREFIXES = ["listing-videos/", "server-uploads/", "listing-video-frames/"];
const DAY_MS = 24 * 60 * 60 * 1000;

type DraftRow = {
  id: string;
  created_at?: string | null;
  published_at?: string | null;
  publish_status?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  video_url?: string | null;
};

type BucketStats = {
  sizeBytes: number;
  objectCount: number;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getAgeDays(createdAt: string | null | undefined, fallback: string | null | undefined): number | null {
  const source = createdAt ?? fallback;
  const parsed = parseDate(source);
  if (!parsed) return null;
  return (Date.now() - parsed.getTime()) / DAY_MS;
}

function isDraftStillActive(draft: DraftRow | null | undefined): boolean {
  if (!draft) return false;
  if (draft.published_at) return false;
  const publishStatus = String(draft.publish_status ?? "").trim().toLowerCase();
  return publishStatus !== "published";
}

async function getBucketStats(adminClient: any): Promise<BucketStats> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { sizeBytes: 0, objectCount: 0 };
  }

  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET_ID}/stats`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (!response.ok) {
      console.warn("cleanup-media-retention: bucket stats request failed", response.status, response.statusText);
      return { sizeBytes: 0, objectCount: 0 };
    }

    const payload = await response.json();
    const sizeBytes = Number(payload?.size ?? payload?.total_size ?? payload?.bytes ?? 0) || 0;
    const objectCount = Number(payload?.objects ?? payload?.object_count ?? payload?.count ?? 0) || 0;
    return { sizeBytes, objectCount };
  } catch (err) {
    console.warn("cleanup-media-retention: bucket stats request error", err);
    return { sizeBytes: 0, objectCount: 0 };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expectedSecret = Deno.env.get("MEDIA_RETENTION_SECRET");
  const providedAuth = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
  const providedSecret = req.headers.get("x-cleanup-secret");

  const isAuthorized = Boolean(serviceKey && (providedAuth === serviceKey || providedSecret === expectedSecret));
  if (!serviceKey || !isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Supabase env vars not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const beforeStats = await getBucketStats(adminClient);
    const { data: draftsData, error: draftsError } = await adminClient
      .from("drafts")
      .select("id, created_at, published_at, publish_status, image_url, image_urls, video_url");

    if (draftsError) throw draftsError;

    const drafts: DraftRow[] = Array.isArray(draftsData) ? draftsData : [];
    const deletedPaths: string[] = [];
    let keptForDraft = 0;
    let deletedCount = 0;
    let scanned = 0;

    for (const prefix of PREFIXES) {
      const { data: objects, error: listError } = await adminClient.storage
        .from(BUCKET_ID)
        .list(prefix, {
          limit: 1000,
        });
      if (listError) throw listError;

      for (const object of objects ?? []) {
        scanned += 1;
        const path = `${prefix}${object.name}`;
        const publicUrl = adminClient.storage.from(BUCKET_ID).getPublicUrl(path).data.publicUrl;
        const ageDays = getAgeDays(object.created_at ?? object.updated_at, object.created_at ?? object.updated_at);
        const referencedDrafts = drafts.filter((draft) => {
          const refs = [draft.image_url, ...(draft.image_urls ?? []), draft.video_url];
          return refs.some((value) => value === publicUrl);
        });

        const activeDraft = referencedDrafts.find((draft) => isDraftStillActive(draft));
        const draftAgeDays = activeDraft ? getAgeDays(activeDraft.created_at, activeDraft.created_at) : null;
        const shouldKeepForActiveDraft = Boolean(
          activeDraft && draftAgeDays !== null && draftAgeDays < DRAFT_GRACE_DAYS,
        );

        if (shouldKeepForActiveDraft) {
          keptForDraft += 1;
          continue;
        }

        const shouldDeleteByAge = ageDays !== null && ageDays >= TTL_DAYS;
        if (!shouldDeleteByAge) {
          continue;
        }

        const { error: removeError } = await adminClient.storage.from(BUCKET_ID).remove([path]);
        if (removeError) {
          console.warn(`cleanup-media-retention: failed to remove ${path}`, removeError.message);
          continue;
        }

        deletedPaths.push(path);
        deletedCount += 1;

        for (const draft of referencedDrafts) {
          const nextImageUrl = draft.image_url === publicUrl ? "" : draft.image_url;
          const nextImageUrls = Array.isArray(draft.image_urls)
            ? draft.image_urls.filter((url) => url !== publicUrl)
            : null;
          const nextVideoUrl = draft.video_url === publicUrl ? null : draft.video_url;

          const updatePayload: Partial<DraftRow> = {
            image_url: nextImageUrl,
            image_urls: nextImageUrls && nextImageUrls.length > 0 ? nextImageUrls : null,
            video_url: nextVideoUrl,
          };

          const { error: draftUpdateError } = await adminClient.from("drafts").update(updatePayload).eq("id", draft.id);
          if (draftUpdateError) {
            console.warn(`cleanup-media-retention: failed to update draft ${draft.id}`, draftUpdateError.message);
          }
        }
      }
    }

    const afterStats = await getBucketStats(adminClient);

    return new Response(
      JSON.stringify({
        ok: true,
        bucket: BUCKET_ID,
        scanned,
        deletedCount,
        keptForDraft,
        deletedPaths,
        beforeStats,
        afterStats,
        bytesFreed: Math.max(0, beforeStats.sizeBytes - afterStats.sizeBytes),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("cleanup-media-retention error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
