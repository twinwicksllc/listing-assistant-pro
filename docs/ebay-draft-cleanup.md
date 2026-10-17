# eBay draft cleanup (`ebay-draft-cleanup`)

One-off, owner-only Edge Function that removes leftover **UNPUBLISHED** eBay offers: drafts left behind when an early
publish failed part-way (`createOffer` succeeded, `publishOffer` did not) and the item was later listed another way.

## What it will and will not do

- Deletes **offers** only. It never deletes inventory items and never touches a `PUBLISHED` offer (that would need a
  withdraw, which `CLAUDE.md` says not to automate without approval).
- Works from a caller-supplied candidate list (`offerId`, `sku`, optional `listingId`) rather than listing every offer.
  The account-wide offer list fails with errorId 25707 while any hyphenated legacy SKU exists (see
  `_helpers/ebayOfferLookup.ts`), but reading one offer by its `offerId` does not.
- Re-reads every offer from eBay right before deleting it. The list you send is a hint, not proof. An offer is deleted
  only when eBay says it is `UNPUBLISHED`, its SKU matches the list, eBay does not report its listing as `ACTIVE`, and
  neither its `listingId` nor its SKU appears among the seller's active listings (Trading API `GetMyeBaySelling`, which
  also covers listings made in Seller Hub).
- **Fails closed.** If the active-listing list cannot be read completely, nothing is deleted.
- **Dry run is the default.** Deletion happens only when the request body has `"dryRun": false`.
- Returns the full offer as eBay held it (`backup`) for every deletion, so there is a record to restore from.

## Access

The function requires a signed-in user (`requireUser`) whose user id is listed in the `EBAY_DRAFT_CLEANUP_USER_IDS`
secret (comma-separated). If the secret is unset or empty, nobody is allowed.

## Request and response

`POST /functions/v1/ebay-draft-cleanup` with a user bearer token and body
`{ "candidates": [{ "offerId": "...", "sku": "...", "listingId": "..." }], "dryRun": true }`, at most 100 candidates per
call. The response has `summary` (count per decision), `results` (one entry per candidate), `activeListingsSeen` and
`needsAuth`.

| Decision                 | Meaning                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `delete`                 | Dry run only: verified and would be deleted                                       |
| `deleted`                | Deleted; the offer is in `backup`                                                 |
| `already_gone`           | eBay no longer has the offer                                                      |
| `skip_published`         | Offer is `PUBLISHED`; left alone                                                  |
| `skip_live_listing`      | A live listing uses this offer's `listingId` or SKU; left alone                   |
| `skip_sku_mismatch`      | The offer's SKU is not the one in the list; left alone                            |
| `skip_unexpected_status` | Offer is in some other status; left alone                                         |
| `not_reached`            | Time budget spent or the token was rejected; send these again                     |
| `error`                  | eBay returned an error for this offer; nothing was deleted unless `deleted` shows |

## Running it from the signed-in app

1. Sign in to the app in your browser, open DevTools, and select the **Console** tab.
2. Paste the helper below and press Enter. A file picker opens. Choose the candidate CSV (columns `sku`, `offer_id`,
   `listing_id`).
3. Run `await cleanup.dryRun()`. It verifies every row in batches of 50 and saves a JSON report. Review it.
4. Run `await cleanup.deleteVerified()` to delete only the offers the dry run marked `delete`. It re-verifies each one
   and saves a JSON file containing the backups.

```js
(() => {
  const STORAGE_KEY = "sb-lister-auth-token";
  const BATCH = 50;

  const session = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (!session?.access_token)
    throw new Error("Not signed in: no session found.");
  const token = () =>
    JSON.parse(localStorage.getItem(STORAGE_KEY)).access_token;
  const iss = JSON.parse(
    atob(
      session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
    ),
  ).iss;
  const url =
    iss.replace(/\/auth\/v1$/, "") + "/functions/v1/ebay-draft-cleanup";

  const parseCsv = (text) => {
    const rows = [];
    let row = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
    const head = rows.shift().map((h) => h.trim());
    return rows.map((r) =>
      Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])),
    );
  };

  const save = (name, data) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    a.download = name;
    a.click();
  };

  const call = async (candidates, dryRun) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ candidates, dryRun }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${body.error ?? "request failed"}`);
    return body;
  };

  const runAll = async (candidates, dryRun) => {
    const results = [];
    let pending = candidates;
    // Rows the function could not reach in time come back as not_reached; send them again.
    for (let pass = 0; pass < 5 && pending.length; pass++) {
      const again = [];
      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        const body = await call(batch, dryRun);
        console.log(`batch ${i / BATCH + 1}`, body.summary);
        for (const r of body.results) {
          if (r.decision === "not_reached")
            again.push(batch.find((c) => c.offerId === r.offerId));
          else results.push(r);
        }
        if (body.needsAuth)
          throw new Error("eBay rejected the token. Stopping.");
      }
      pending = again;
    }
    for (const c of pending)
      results.push({ offerId: c.offerId, sku: c.sku, decision: "not_reached" });
    return results;
  };

  const summarize = (results) => {
    const s = {};
    for (const r of results) s[r.decision] = (s[r.decision] ?? 0) + 1;
    return s;
  };

  const state = { candidates: [], plan: null };

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv";
  input.onchange = async () => {
    const rows = parseCsv(await input.files[0].text());
    state.candidates = rows
      .filter((r) => r.offer_id && r.sku)
      .map((r) => ({
        offerId: r.offer_id,
        sku: r.sku,
        ...(r.listing_id ? { listingId: r.listing_id } : {}),
      }));
    console.log(
      `Loaded ${state.candidates.length} candidates. Next: await cleanup.dryRun()`,
    );
  };
  input.click();

  window.cleanup = {
    async dryRun() {
      if (!state.candidates.length) throw new Error("Choose the CSV first.");
      const results = await runAll(state.candidates, true);
      state.plan = results.filter((r) => r.decision === "delete");
      console.log("Dry run summary", summarize(results));
      save("ebay-draft-cleanup-dryrun.json", results);
      console.log(
        `${state.plan.length} offers would be deleted. Next: await cleanup.deleteVerified()`,
      );
    },
    async deleteVerified() {
      if (!state.plan) throw new Error("Run cleanup.dryRun() first.");
      const byId = new Map(state.candidates.map((c) => [c.offerId, c]));
      const results = await runAll(
        state.plan.map((r) => byId.get(r.offerId)),
        false,
      );
      console.log("Delete summary", summarize(results));
      save("ebay-draft-cleanup-deleted-with-backup.json", results);
    },
  };
})();
```
