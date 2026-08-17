import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const BUCKET_ID = "listing-images";
const TTL_DAYS = 15;
const DRAFT_GRACE_DAYS = 60;
// Historical reference only -- superseded by the full recursive bucket walk
// below. Kept as documentation of the prefixes this function has always
// intended to cover: listing-videos/{user_id}/... and
// listing-video-frames/{user_id}/... both nest a per-user subfolder, which a
// single non-recursive list() call (what this function did before) can
// never see into -- it only returns the subfolder placeholder, never the
// file inside it. server-uploads/ is flat and was the only one of the three
// this function could ever have actually found a real object in.
const PREFIXES = [
  "listing-videos/",
  "server-uploads/",
  "listing-video-frames/",
];
const DAY_MS = 24 * 60 * 60 * 1000;
// Supabase Storage list() pages at up to this many entries per call; must
// paginate past it explicitly or large folders silently get truncated. This
// is the exact bug that undercounted an earlier one-off export script by
// 78% -- it never looped past a single page.
const LIST_PAGE_SIZE = 1000;

type DraftRow = {
  id: string;
  created_at?: string | null;
  published_at?: string | null;
  publish_status?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  video_url?: string | null;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getAgeDays(
  createdAt: string | null | undefined,
  fallback: string | null | undefined,
): number | null {
  const source = createdAt ?? fallback;
  const parsed = parseDate(source);
  if (!parsed) return null;
  return (Date.now() - parsed.getTime()) / DAY_MS;
}

function isDraftStillActive(draft: DraftRow | null | undefined): boolean {
  if (!draft) return false;
  if (draft.published_at) return false;
  const publishStatus = String(draft.publish_status ?? "")
    .trim()
    .toLowerCase();
  return publishStatus !== "published";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Uses the same CRON_SECRET pattern adopted for cost-alert-cron and
  // sync-ebay-taxonomy (see authGuard.ts) rather than this function's own
  // former bespoke MEDIA_RETENTION_SECRET/x-cleanup-secret check, so there is
  // one consistent, tested cron-auth mechanism instead of several one-off
  // ones. Also accepts the service-role key directly, so a manual dashboard
  // trigger or another internal caller still works.
  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[cleanup-media-retention] auth rejected:",
      JSON.stringify(describeCronAuthEnv(req)),
    );
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Supabase env vars not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Dry-run mode: report exactly what a real run would delete/update without
  // touching storage or the drafts table. Intended for a manual verification
  // pass before this function is put on a recurring schedule, since unlike
  // the other scheduled functions this one deletes production storage
  // objects and mutates drafts rows -- accept via JSON body ({"dryRun":true})
  // or a query string (?dryRun=true) so it is easy to trigger either way from
  // the dashboard or a net.http_post test call.
  let dryRun = new URL(req.url).searchParams.get("dryRun") === "true";
  if (!dryRun && req.method === "POST") {
    try {
      const body = await req.json();
      dryRun = body?.dryRun === true;
    } catch {
      // No body, or not JSON -- fine, dryRun stays false.
    }
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const { data: draftsData, error: draftsError } = await adminClient
      .from("drafts")
      .select(
        "id, created_at, published_at, publish_status, image_url, image_urls, video_url",
      );

    if (draftsError) throw draftsError;

    const drafts: DraftRow[] = Array.isArray(draftsData) ? draftsData : [];
    const deletedPaths: string[] = [];
    let keptForDraft = 0;
    let deletedCount = 0;
    let scanned = 0;
    // Computed from the objects actually listed below, rather than a
    // whole-bucket stats call -- there is no documented Supabase Storage
    // REST endpoint for bucket-level stats, and the previous
    // /storage/v1/bucket/{id}/stats call had been silently 404ing since this
    // function was written, always falling back to {sizeBytes:0}.
    let bytesScanned = 0;
    let bytesFreed = 0;

    type StorageFile = {
      path: string;
      created_at?: string | null;
      updated_at?: string | null;
      metadata?: { size?: number } | null;
    };

    // Walks the entire bucket recursively, descending into every folder at
    // every depth, paginating each folder's contents past LIST_PAGE_SIZE.
    // Both are required correctness, not optimizations: a flat list() call
    // per known prefix (what this function did before) can never see a file
    // that sits under a per-user subfolder -- listing-videos/{user_id}/... and
    // listing-video-frames/{user_id}/... both nest one, so the old code could
    // only ever have found files under server-uploads/, the one flat
    // prefix -- and a single unpaginated call silently truncates past 1000
    // entries, the exact bug that undercounted an earlier one-off export
    // script by 78%.
    async function listAllFilesRecursive(prefix: string): Promise<StorageFile[]> {
      const files: StorageFile[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await adminClient.storage
          .from(BUCKET_ID)
          .list(prefix, { limit: LIST_PAGE_SIZE, offset });
        if (error) throw error;
        const page = data ?? [];
        for (const entry of page) {
          if (entry.id != null) {
            files.push({
              path: `${prefix}${entry.name}`,
              created_at: entry.created_at,
              updated_at: entry.updated_at,
              metadata: entry.metadata,
            });
          } else {
            const nested = await listAllFilesRecursive(`${prefix}${entry.name}/`);
            files.push(...nested);
          }
        }
        if (page.length < LIST_PAGE_SIZE) break;
        offset += LIST_PAGE_SIZE;
      }
      return files;
    }

    // Applies the TTL/active-draft/dry-run decision to one file -- the same
    // policy for every file regardless of which folder it came from.
    async function processFile(file: StorageFile) {
      scanned += 1;
      const objectSizeBytes = Number(file.metadata?.size) || 0;
      bytesScanned += objectSizeBytes;
      const path = file.path;
      const publicUrl = adminClient.storage.from(BUCKET_ID).getPublicUrl(path)
        .data.publicUrl;
      const ageDays = getAgeDays(
        file.created_at ?? file.updated_at,
        file.created_at ?? file.updated_at,
      );
      const referencedDrafts = drafts.filter((draft) => {
        const refs = [
          draft.image_url,
          ...(draft.image_urls ?? []),
          draft.video_url,
        ];
        return refs.some((value) => value === publicUrl);
      });

      const activeDraft = referencedDrafts.find((draft) => isDraftStillActive(draft));
      const draftAgeDays = activeDraft ? getAgeDays(activeDraft.created_at, activeDraft.created_at) : null;
      const shouldKeepForActiveDraft = Boolean(
        activeDraft &&
          draftAgeDays !== null &&
          draftAgeDays < DRAFT_GRACE_DAYS,
      );

      if (shouldKeepForActiveDraft) {
        keptForDraft += 1;
        return;
      }

      const shouldDeleteByAge = ageDays !== null && ageDays >= TTL_DAYS;
      if (!shouldDeleteByAge) {
        return;
      }

      if (dryRun) {
        // Report what would happen without touching storage or drafts.
        deletedPaths.push(path);
        deletedCount += 1;
        bytesFreed += objectSizeBytes;
        return;
      }

      const { error: removeError } = await adminClient.storage
        .from(BUCKET_ID)
        .remove([path]);
      if (removeError) {
        console.warn(
          `cleanup-media-retention: failed to remove ${path}`,
          removeError.message,
        );
        return;
      }

      deletedPaths.push(path);
      deletedCount += 1;
      bytesFreed += objectSizeBytes;

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

        const { error: draftUpdateError } = await adminClient
          .from("drafts")
          .update(updatePayload)
          .eq("id", draft.id);
        if (draftUpdateError) {
          console.warn(
            `cleanup-media-retention: failed to update draft ${draft.id}`,
            draftUpdateError.message,
          );
        }
      }
    }

    // One recursive walk of the whole bucket finds everything: the bare
    // {user_id}/ folders from ordinary imageUpload.ts uploads (never covered
    // before, why 4,716 of 4,735 listing-images objects ended up orphaned --
    // RBR-0033), plus the three known prefixes, including the per-user
    // subfolders under listing-videos/ and listing-video-frames/ that a flat
    // list() call could never see into.
    const allFiles = await listAllFilesRecursive("");
    for (const file of allFiles) {
      await processFile(file);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dryRun,
        bucket: BUCKET_ID,
        knownPrefixes: PREFIXES,
        scanned,
        bytesScanned,
        deletedCount,
        bytesFreed,
        keptForDraft,
        deletedPaths,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("cleanup-media-retention error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unexpected error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
