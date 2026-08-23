# eBay API Category Finder — Research Findings & Implementation Plan

**Status:** Proposal / awaiting approval
**Scope:** Replace hardcoded category cheat-sheets and business rules with eBay's own Taxonomy + Metadata APIs as the primary resolver.
**Related:** PR #525 (leaf-only enforcement), PR #526 (coinConditionDetail schema fix)

---

## 0. Executive summary

The short version of what the research turned up:

1. **We are already doing the right thing architecturally** — `category-lookup` already calls eBay's `getCategorySuggestions` at Tier 2 and already leaf-verifies the winner. The problem is not that we lack an eBay-driven finder; it's that the finder is fed a _bad query_, its results are _scored with arbitrary arithmetic_, and it is _wrapped in hardcoded overrides_ that can undo a correct answer.
2. **The direct answer to your graded/raw question is: no, and you should be glad it's no.** Grading is not a category-selection dimension in eBay's data model. Putting "PCGS MS-65" into `q` does not and cannot reliably steer the category, because eBay models graded-vs-raw as a **condition descriptor** on the listing, not as a branch of the taxonomy. Details in §3.
3. **But the hardcoded rule can still be deleted** — just not by putting grading words in the free text. It gets replaced by a _dynamic capability probe_ against `getItemConditionPolicies`, which is the API that actually knows whether a category accepts a graded coin. Details in §4.
4. **Three real bugs were found while researching**, one of which means eBay's rank-#1 suggestion currently **always** wins and can never be overridden by a human-verified mapping. Details in §2.

---

## 1. What eBay's official documentation actually says

Sourced from eBay's live developer docs (Taxonomy API, Metadata API, "Identify and select the right category" guide, and the eBay developer blog post on the coin condition mandate).

### 1.1 `getCategorySuggestions` is the officially recommended approach

eBay explicitly recommends free-form text → `getCategorySuggestions` as the way to find a category. Confirmed properties:

- Results **are leaf nodes** — the docs describe the response as "an array of category tree leaf nodes."
- Results are **sorted by eBay's own confidence**, best first.
- Each result carries `categoryTreeNodeAncestors`, i.e. the **full breadcrumb for free**.
- The response carries `categoryTreeVersion`, which the docs recommend caching to detect tree drift.

### 1.2 THE BIG CAVEAT — this is the trap developers fall into

Directly from the docs:

> "Category suggestions returned by this method are partially determined by **live inventory data** on the eBay platform. In cases where items with similar titles are **miscategorized**, this may influence the recommendations returned and cause a **less accurate category to rank higher**. Suggestions should be treated as **recommendations rather than authoritative classifications**."

**Implication:** we must NOT delete the verification layer and blindly trust rank #1. This is precisely the trap you asked me to check for. Our `leafCategoryGuard` and leaf-verification must **stay**. What changes is that they become a _guard_, not a _replacement_.

This also explains a class of bug we've been fighting: if enough sellers dump graded world coins into a rollup like 45243, eBay's suggestion engine will happily _recommend_ 45243 — the very category that then rejects the listing at publish time. The suggestion API is a popularity signal, not a validity signal.

### 1.3 Sandbox is unusable for this

> "This call is not supported in the Sandbox environment. It will return... random or boilerplate text regardless of the query submitted."

**Implication:** all validation of this work must be done against **production** credentials. Any test we write must be either (a) a pure unit test over recorded fixtures, or (b) an explicitly-gated live smoke test. We must never assert on sandbox output.

### 1.4 `relevancy` is a trap field

The `relevancy` field in the response is documented as "reserved for internal or future use." We must not read it or sort on it. (We currently don't — good.)

---

## 2. Bugs found in the current implementation

### 2.1 🔴 CRITICAL — eBay rank #1 mathematically _always_ wins the lock

`DETERMINISTIC_LOCK_THRESHOLD = 92`. For an eBay rank-#1 candidate:

```
rawScore (i=0)        = 80 - 0*4 = 80
sourceWeight(ebay_api)= 12
                        ------
minimum effectiveScore = 92    ← equals the threshold exactly
```

Verified by direct arithmetic replication (`scripts/score-probe.mjs`):

| candidate                                    | effectiveScore | locks?          |
| -------------------------------------------- | -------------- | --------------- |
| eBay #1, zero token overlap, leaf verified   | **92**         | ✅ yes          |
| eBay #1, leaf verification _failed_ (`null`) | **92**         | ✅ **yes**      |
| eBay #1, confirmed non-leaf (−30)            | 77             | no (guarded)    |
| Best possible user-verified DB mapping       | 100            | **unreachable** |

Two consequences:

1. **A human-verified mapping (score 100) can never beat eBay rank #1**, because the lock check runs _before_ the sorted-candidate loop. The entire `db_exact_user_verified: 15` weight is dead code whenever eBay returns any leaf. If a user manually corrects a category, that correction is silently ignored on the next lookup.
2. **The lock fires even when leaf verification never happened.** The guard is `verifiedLeaf !== false`, so `null` (network error, timeout, API 500) passes. A transient failure ⇒ we lock in an unverified category.

Also note ranks #2–#5 are **never leaf-verified at all** (`if (i === 0)`), yet they sit in the candidate pool at 88/84/80/76 and can win the sorted loop with `verifiedLeaf === null`.

### 2.2 🟠 Broken duplicate implementation

`supabase/functions/_helpers/ebayTaxonomy.ts:53` has a second `getCategorySuggestions()` using a **malformed URL**:

```
❌ /commerce/taxonomy/v1/category_suggestions?q=…&category_tree_id=0
✅ /commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=…
```

This would 404 on every call and silently `return []`. It currently has **no edge-function callers** (dead code), but it's a live landmine. Delete it and re-point anything to the canonical implementation.

### 2.3 🟡 The query we send is the wrong text

Tier 2 is called with `itemType: listing.title` — the _marketing title_. Titles are keyword-stuffed for search ("RARE!! 1883 Shield Nickel PCGS MS-65 GEM BU L@@K"), which is exactly the kind of noisy input that amplifies the live-inventory bias in §1.2. We should send a **clean descriptive phrase**, not the sales title.

---

## 3. Your question answered: can graded/raw go in the free text instead of business rules?

**Short answer: the grading words already reach eBay today, and they are the wrong tool for the job.**

### 3.1 They already reach eBay

I replicated the sanitizer (`scripts/sanitize-probe.mjs`). Grading vocabulary **survives it intact**:

| input                                                       | sanitized `q`                                      | grading tokens surviving      |
| ----------------------------------------------------------- | -------------------------------------------------- | ----------------------------- |
| `1883 Shield Nickel PCGS MS-65 Certified #12345678`         | `1883 Shield Nickel PCGS MS-65 Certified 12345678` | PCGS, MS-65, Certified        |
| `1883 Shield Nickel Raw Ungraded Fine`                      | `1883 Shield Nickel Raw Ungraded Fine`             | Raw, Ungraded                 |
| `1921 Morgan Silver Dollar NGC MS64 Slabbed Certified Coin` | _(unchanged)_                                      | NGC, MS64, Slabbed, Certified |

Only `#` and `$` are stripped; the 180-char truncation effectively never fires because eBay titles cap at 80. So **adding graded/raw to `q` is not a change — it's the status quo.** And the status quo is that graded coins still landed in 45243. That's the empirical disproof.

### 3.2 Why it structurally cannot work

eBay's own coin-mandate documentation states that grading is delivered through `getItemConditionPolicies` → `conditionDescriptors`, and critically:

> "these coin categories are **not leaf categories**, so condition grading is available for **all leaf categories descending from** the above categories (except for rolls, sets, and lots)."

Read that carefully: grading availability is a property that flows down to **every** coin leaf. There is no "graded Morgan dollar" category sitting next to a "raw Morgan dollar" category. The taxonomy branches on **what the coin is** (series, country, denomination, date range). Grading is an orthogonal axis expressed as `conditionDescriptors` (grading company, grade, cert number) on the listing.

So asking `getCategorySuggestions` to disambiguate graded-vs-raw is asking it to branch on an axis **the taxonomy does not have**. At best the words are inert; at worst they add noise that drags in miscategorized live inventory (§1.2).

### 3.3 What grading _actually_ controls

It's a **publish-time validity constraint**, not a selection input:

- Graded coin ⇒ condition `LIKE_NEW` / conditionId **2750** ("Graded").
- Some categories (notably rollups like **45243**) **do not accept 2750** ⇒ `invalid condition for category 45243`.

That's why the business rule exists. It isn't compensating for a bad category _concept_ — the concept "world coin" was right. It's compensating for the fact that the chosen **node cannot accept the condition we need**.

### 3.4 ✅ So here's the rule that _can_ replace it

Stop hardcoding "45243 rejects graded." Instead **ask eBay**:

> For each candidate category, if the item is graded, call `getItemConditionPolicies` and require that the returned `itemConditions` include conditionId **2750**. If it doesn't, that candidate is disqualified — move to the next suggestion.

This is strictly better than the hardcoded rule because:

- It's **self-maintaining** — if eBay changes 45243's policy, or another rollup develops the same problem, we adapt with no code change.
- It **generalises** — today we only know about 45243. There are almost certainly others we haven't hit in production yet.
- It **catches the rolls/sets/lots exclusion for free** — those leaves won't report grading descriptors.
- It **kills the whole family** of hardcoded rules at once: the reroute in `publish-create-draft.ts:171`, the graded-fallback logic in `analyze-item/index.ts:2447`, and the graded warnings in the `domainPrompts.ts` cheat-sheet.
- We already have the plumbing — `category-lookup` action `conditions` (line 2013) and `publish-helpers.ts:2622` both call this endpoint and already surface `conditionDescriptors`.

**Net: the free-text idea doesn't work, but your underlying instinct — "delete the hardcoding, ask eBay" — is exactly right. It's just a different eBay endpoint than the one you had in mind.**

---

## 4. Proposed architecture

```
      Gemini                      eBay Taxonomy API              eBay Metadata API
  ┌──────────────┐            ┌──────────────────────┐        ┌────────────────────┐
  │ describes    │            │ getCategorySuggestions│       │ getItemCondition   │
  │ the ITEM     │───phrase──▶│  → ranked leaf list   │──────▶│ Policies           │
  │ (no IDs)     │            └──────────────────────┘        │ → can it take 2750?│
  └──────────────┘                        │                    └────────────────────┘
                                          ▼                              │
                                 leaf + active verify                    ▼
                                          │                    disqualify candidates
                                          ▼                    that reject our condition
                                  leafCategoryGuard  ◀───────────────────┘
                                    (final net)
```

**Principle: Gemini describes, eBay decides, policy validates, guard protects.**

### Phase 1 — Fix the scoring so eBay can be trusted _and_ overridden

- Decouple the lock from the source weight. Either raise `DETERMINISTIC_LOCK_THRESHOLD` above 92 or drop eBay rank-#1 `rawScore` so the lock reflects _evidence_, not arithmetic coincidence.
- Require `verifiedLeaf === true` (not `!== false`) for the deterministic lock. Never lock on `null`.
- Let a **user-verified** DB mapping outrank the eBay lock. Human corrections must win — otherwise the correction UI is a lie.
- Leaf-verify the top **3** candidates, not just rank #1, so the fallback chain is trustworthy.

### Phase 2 — Feed it a better query

- Add a dedicated `categoryQuery` field to the `create_listing` tool schema: a clean 4–8 word descriptive phrase (`"1883 Shield Nickel five cent US coin"`), explicitly **excluding** marketing fluff, grades, and cert numbers.
- Send `categoryQuery` to Tier 2 instead of `listing.title`.
- Keep the existing sanitizer as a safety net.

### Phase 3 — Dynamic condition-capability gate (replaces the hardcoded rules)

- Add `assertCategoryAcceptsCondition(categoryId, conditionId)` backed by `getItemConditionPolicies`, cached.
- In the candidate loop: if the item is graded, disqualify any candidate whose policy lacks 2750.
- Then delete: the `GRADED_UNFRIENDLY_WORLD_PARENTS` reroute, the `analyze-item` graded fallback block, and the graded rules in the prompt cheat-sheet.

### Phase 4 — Cache & drift detection

- Persist suggestion results (`q` → categoryId, breadcrumb, `categoryTreeVersion`) in `ebay_taxonomy_cache`. Populate breadcrumbs from the free `categoryTreeNodeAncestors`.
- On `categoryTreeVersion` change, invalidate. This makes the weekly cron _useful_ rather than cosmetic.

### Phase 5 — Shrink the hardcoding

- Delete the broken duplicate in `_helpers/ebayTaxonomy.ts` (§2.2).
- Reduce the ~30-ID cheat-sheet in the `categoryId` description to a short list of genuine disambiguation traps (bullion-vs-numismatic is a real judgement call eBay's API gets wrong), and let the API handle the rest.
- **Keep** `leafCategoryGuard` — §1.2 says we must.

---

## 5. What we deliberately do NOT delete

Because the docs tell us not to:

| Keep                                              | Why                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `leafCategoryGuard` / `KNOWN_PARENT_CATEGORY_IDS` | Suggestions are "recommendations, not authoritative"; live-inventory bias is real |
| Leaf verification via `getCategorySubtree`        | The only authoritative leaf check                                                 |
| `COIN_LEAF_FALLBACKS`                             | Needed when the API is down; small and verified                                   |
| Bullion-vs-numismatic prompt guidance             | Genuine semantic judgement the suggestion API demonstrably gets wrong             |

---

## 6. Validation plan

Because **sandbox returns boilerplate** (§1.3), testing is split:

1. **Unit tests over recorded production fixtures** — deterministic, CI-safe. Covers scoring, disqualification, guard behaviour.
2. **A gated live probe script** run manually against production creds, recording real `getCategorySuggestions` + `getItemConditionPolicies` output for the coin corpus (Shield Nickel graded/raw, Morgan graded, Cook Islands colorized proof, generic silver bar).
3. **Regression corpus** — every category bug we've hit (88433 dime rollup, 45243 graded world coin, 11952 Shield Nickel) becomes a permanent test case.

⚠️ **Blocker:** this sandbox has **no eBay/Supabase/Gemini credentials** (`env` check returned empty), so step 2 needs you or a CI secret.

---

## 7. Open questions for you

1. **Should a user-verified mapping always beat eBay's suggestion?** I believe yes, but it changes current behaviour.
2. **Phase 3 adds one `getItemConditionPolicies` call per graded-coin lookup** (cached). Acceptable latency, or defer the check to publish time only?
3. **How aggressively do you want the cheat-sheet trimmed?** Minimal (bullion traps only) or leave the coin IDs as a warm-start?
4. **Can you provide production credentials / run the live probe?** Without it, Phase 3 ships on documented behaviour rather than observed behaviour.
