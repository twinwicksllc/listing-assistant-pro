#!/usr/bin/env node
/**
 * Backfills embedding + embedding_source_text on ebay_taxonomy_cache's
 * ~15,116 live leaf categories (Phase 2.2b, misclassification plan).
 *
 * Why a standalone script rather than an Edge Function: 15k single-text
 * embeds (Gemini's :embedContent has no batch endpoint -- confirmed no
 * :batchEmbedContents usage anywhere in this repo) cannot fit inside
 * Supabase's 150s Edge gateway kill, and
 * backfill-knowledge-base-embeddings/index.ts's unbounded-select +
 * serial-loop pattern (built for knowledge_base's handful of rows) does
 * not transfer at this scale.
 *
 * Why comparing TEXT, not timestamps, decides what to re-embed:
 * sync-ebay-taxonomy stamps one `now` onto every row it upserts each week
 * (index.ts:266/:103), and the table's own updated_at trigger bumps on
 * every upserted row with no IS DISTINCT FROM guard
 * (20260421000000_ebay_taxonomy_cache.sql:47-57) -- so both timestamps
 * refresh on all ~15k rows weekly regardless of whether category_name or
 * breadcrumb actually changed. embedding_source_text (this migration:
 * 20260917030000_add_category_embeddings.sql) is the only reliable
 * "did this row's text change since last embed" signal: this script
 * recomputes the same text and skips any row where it already matches.
 *
 * Data source: the live ebay_taxonomy_cache table via Supabase's REST API
 * (same paginated approach as refresh-taxonomy-snapshot.mjs), not the
 * committed corpus/ebay_taxonomy_snapshot.json -- the snapshot has no
 * embedding/embedding_source_text columns to check against, and this
 * script needs to see today's live table state (including rows written
 * out-of-band by suggestedCategories.ts's on-the-fly upserts) rather than
 * a point-in-time export.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... GEMINI_API_KEY=... \
 *     node scripts/backfill-category-embeddings.mjs [--dry-run] [--concurrency=8] [--limit=N]
 *
 * Re-run weekly after sync-ebay-taxonomy-weekly (Sun 03:11 UTC) as the
 * refresh mechanism for this phase -- no new cron is added here. Safe to
 * interrupt and re-run: already-current rows (embedding_source_text
 * matches) are skipped, so a re-run only pays for rows still pending.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error(
    "FATAL: SUPABASE_URL, SUPABASE_SERVICE_KEY, and GEMINI_API_KEY env vars are required.",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CONCURRENCY = Number(
  args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 8,
);
const LIMIT = args.find((a) => a.startsWith("--limit="))
  ? Number(args.find((a) => a.startsWith("--limit=")).split("=")[1])
  : null;

// Same model/dimension as _helpers/rag/embedding.ts's getEmbedding -- kept
// as a literal here (not imported) since this script runs under Node, not
// Deno, and that file is Deno-only (imports from "../geminiModels.ts" via
// a Deno-style relative specifier). Any change to the model there must be
// mirrored here, same as seed-knowledge-base.cjs's existing duplicate.
const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
const EMBED_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const PAGE_SIZE = 1000;

/**
 * The exact text embedded -- must match what a re-run recomputes to detect
 * "unchanged". Just `breadcrumb` alone: confirmed against the live table
 * (and corpus/ebay_taxonomy_snapshot.json) that breadcrumb's own last
 * segment already IS category_name (e.g. "Business & Industrial > ... >
 * Blood Pressure Machines & Monitors" for the "Blood Pressure Machines &
 * Monitors" leaf) -- prefixing category_name again would duplicate it in
 * the embedded text for no benefit. This also matches what the LLM ranking
 * call in category-lookup will actually be shown (the full ancestor path),
 * so retrieval and ranking see the same text shape.
 */
function buildSourceText(row) {
  return row.breadcrumb;
}

async function fetchAllCategoryRows() {
  const pageSize = PAGE_SIZE;
  let offset = 0;
  const rows = [];
  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/ebay_taxonomy_cache` +
      `?select=category_id,category_name,breadcrumb,is_leaf,embedding_source_text` +
      `&is_leaf=eq.true` +
      `&order=category_id.asc` +
      `&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Supabase REST fetch failed (offset=${offset}): ${res.status} ${res.statusText} -- ${body}`,
      );
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
    if (LIMIT && rows.length >= LIMIT) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function getEmbedding(text) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: `models/${GEMINI_EMBEDDING_MODEL}`,
              content: { parts: [{ text }] },
              outputDimensionality: 768,
            }),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // 429/5xx are worth retrying with backoff; a 400 (e.g. malformed
        // text) will just fail identically on retry -- fail fast instead.
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`Gemini Embedding API ${res.status}: ${body}`);
        }
        throw Object.assign(
          new Error(`Gemini Embedding API ${res.status}: ${body}`),
          {
            nonRetryable: true,
          },
        );
      }

      const data = await res.json();
      const values = data?.embedding?.values;
      if (!Array.isArray(values) || values.length !== 768) {
        throw new Error(
          `Gemini Embedding API returned an unexpected shape (length=${values?.length ?? "n/a"})`,
        );
      }
      return values;
    } catch (err) {
      lastErr = err;
      if (err.nonRetryable || attempt === MAX_RETRIES) break;
      const backoffMs = 500 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

async function patchRow(categoryId, embedding, sourceText) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ebay_taxonomy_cache?category_id=eq.${encodeURIComponent(categoryId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ embedding, embedding_source_text: sourceText }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Supabase PATCH failed for ${categoryId}: ${res.status} ${res.statusText} -- ${body}`,
    );
  }
}

/**
 * Simple fixed-concurrency worker pool -- no new dependency (p-limit etc.)
 * for what's a one-off maintenance script. Each worker pulls the next
 * pending index until the queue is exhausted; one row's failure is
 * recorded and does not stop the others (resumability: re-running the
 * script picks up exactly the rows that failed or were never reached,
 * since only successfully-patched rows get a matching embedding_source_text).
 */
async function runPool(items, concurrency, worker) {
  let nextIndex = 0;
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  async function runWorker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        const outcome = await worker(item, i);
        if (outcome === "skipped") skipped++;
        else completed++;
      } catch (err) {
        failed++;
        errors.push({ categoryId: item.category_id, message: err.message });
        console.error(`  [FAIL] ${item.category_id}: ${err.message}`);
      }
      if ((completed + skipped + failed) % 250 === 0) {
        console.log(
          `  progress: ${completed + skipped + failed}/${items.length} ` +
            `(embedded=${completed}, skipped=${skipped}, failed=${failed})`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runWorker(),
    ),
  );

  return { completed, skipped, failed, errors };
}

async function main() {
  console.log(
    `Backfilling category embeddings${DRY_RUN ? " (DRY RUN -- no writes)" : ""} ` +
      `(concurrency=${CONCURRENCY}${LIMIT ? `, limit=${LIMIT}` : ""})...`,
  );

  const rows = await fetchAllCategoryRows();
  console.log(
    `Fetched ${rows.length} leaf category rows from ebay_taxonomy_cache.`,
  );

  const pending = rows.filter((row) => {
    const currentText = buildSourceText(row);
    return row.embedding_source_text !== currentText;
  });
  console.log(
    `${rows.length - pending.length} rows already current (embedding_source_text matches) -- skipping. ` +
      `${pending.length} rows pending embed.`,
  );

  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    console.log(`DRY RUN: would embed ${pending.length} rows. Sample:`);
    for (const row of pending.slice(0, 10)) {
      console.log(`  ${row.category_id}: "${buildSourceText(row)}"`);
    }
    return;
  }

  const { completed, skipped, failed, errors } = await runPool(
    pending,
    CONCURRENCY,
    async (row) => {
      const sourceText = buildSourceText(row);
      const embedding = await getEmbedding(sourceText);
      await patchRow(row.category_id, embedding, sourceText);
      return "embedded";
    },
  );

  console.log(
    `\nDone. embedded=${completed}, skipped=${skipped} (already current), failed=${failed}.`,
  );
  if (errors.length > 0) {
    console.log(
      `\n${errors.length} row(s) failed and were NOT marked current -- re-running this script will retry exactly these:`,
    );
    for (const e of errors.slice(0, 25)) {
      console.log(`  ${e.categoryId}: ${e.message}`);
    }
    if (errors.length > 25) console.log(`  ... and ${errors.length - 25} more`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
