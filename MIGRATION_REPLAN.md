# Migration and Rebrand Re-plan

**Status:** Owner decisions recorded 2026-10-06; back end first, front end after.
**Scope:** moving the legacy listing app's back end into `listrassistr-official`
(repo), `yqftpibxplachhwoclam` (production Supabase) and a new QA project, deployed
through Vercel. The legacy app is not modified and stays operable (Q-16).
**Evidence:** three code audits run 2026-10-06 over this repo (Edge Functions,
database, code bloat). Numbers below are from those audits and their stated limits.

> **Progress 2026-10-07:** steps 1 and 2 of section 8 (foundation, eBay connection) are built and deployed to QA; a complete sandbox connection is still to be verified. See DEC-0044 and `listrassistr-official/docs/STATUS_2026-10-07.md`. Two plan items changed in practice: the new QA project became a reset of `majmvgakczrpcwgxgulj` (decision 10), and production deploys by hand until `AUTO_DEPLOY_PRODUCTION` is set.

## 1. Owner decisions (2026-10-06)

| #   | Decision                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The five-question gate applies to every module (section 3). Anything copied is updated for the new schema, table, column and function names.                                                                                             |
| 2   | `auto-reprice-cron` and `auto-reprice-trigger` are obsolete and are not ported (consistent with DEC-0017). One-off backfills are dropped. `config.toml` is rebuilt for the new functions.                                                |
| 3   | `video-frame-extract` is wanted in the new app, **after** the migration.                                                                                                                                                                 |
| 4   | The `test_items` idea returns as a **category regression suite** (section 6): a few deliberately awkward fixtures per domain, run on a schedule, so a failing category or condition is found by the suite rather than one fix at a time. |
| 5   | No write-only tables. `support_tickets` becomes readable by admins. Log tables get pruning with per-table retention (section 5).                                                                                                         |
| 6   | The schema is designed fresh from the final legacy state, not replayed. `handle_new_user`, `profiles` and `subscriptions` are each defined once.                                                                                         |
| 7   | Comments are cut to what a later maintainer needs: the reason for a non-obvious choice. No PR numbers, dates, or "previously" history; that lives in git.                                                                                |
| 8   | No CRM table, function, type or doc crosses over. The CRM lives in the `rankedceo-crm` project; the new schema is written from migrations, never exported from it.                                                                       |
| 9   | Teams (`organizations`, `org_members`, `org_invitations` and related functions) are **not** migrated.                                                                                                                                    |
| 10  | A new, separate QA Supabase project for the new app. The shared legacy QA project is left to the legacy app.                                                                                                                             |
| 11  | Back end first. Front-end work waits until the back end is done, and the owner reviews HTML mock-ups of options before any screen is built (section 7).                                                                                  |
| 12  | Backend home: `listrassistr-official` repo, production project `yqftpibxplachhwoclam`, Vercel deployment for the web app.                                                                                                                |

## 2. Target environments

| Layer    | Production                       | QA                                                     |
| -------- | -------------------------------- | ------------------------------------------------------ |
| Repo     | `listrassistr-official` `main`   | `qa` branch (fast-forwarded from `main`)               |
| Supabase | `yqftpibxplachhwoclam`           | **new project, to be created by the owner (O-QA-NEW)** |
| Web      | `app.listrassistr.com` on Vercel | `qa.listrassistr.com`                                  |

The existing shared QA project `majmvgakczrpcwgxgulj` stays with the legacy app. The
new QA project is created by the owner in the Supabase dashboard; no assistant action
creates projects or touches provider settings. Until it exists, schema work is checked
by migration review and local linting only, and nothing is pushed anywhere.

Production `yqftpibxplachhwoclam` was empty of application schema on 2026-08-27 and has
had open sign-up since. **Before the first migration is applied there, re-check what
exists** (tables, users, functions). That check is a read-only owner step.

## 3. The module gate

Every module passes these five checks before it is added to the new repo:

1. **Used?** Callers, schedule, last change. Dead code is dropped.
2. **Belongs?** It serves a seller task in the new app.
3. **Trim.** Remove history comments, dead branches, duplicate helpers, raw `console`.
4. **Split or rewrite.** One job per module. Rewrite only where the design is wrong.
5. **Rename and test.** New schema names, new function names, new brand text, tests
   ported or written, and a port card filled in (`docs/port-cards/<module>.md`).

A port card records: source files, what was dropped and why, renames, tests, and open
questions. It is the review record for the module.

## 4. Disposition

| Item                                                                                       | Decision                                                                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `auto-reprice-cron`, `auto-reprice-trigger`                                                | **Drop.** Obsolete (owner).                                                                                       |
| `setup-categories`, `backfill-ebay-token-encryption`, `backfill-knowledge-base-embeddings` | **Drop.** One-offs; a new project has no plaintext tokens to backfill. A re-embed job is written fresh if needed. |
| `agenticPrePass`, `imageParsing`, `categoryLookupClient` (helpers)                         | **Drop.** No importer found (re-verified 2026-10-06).                                                             |
| Top-level `_helpers/pipelineContracts.ts`                                                  | **Drop** if confirmed unused; `agent-system/pipelineContracts.ts` is the one in use.                              |
| `agent-system/` (controller, registry, domain signals, visual and market agents)           | **Port.** The audit said it was unreferenced; `analyze-item` loads it with a dynamic import.                      |
| Teams tables and functions                                                                 | **Not migrated** (owner).                                                                                         |
| `test_items`                                                                               | **Rebuilt** as the regression suite (section 6), not copied.                                                      |
| `video-frame-extract`                                                                      | **After migration** (owner). Its plan docs are the starting point.                                                |
| Legacy dashboards (v1 and v2), home, archived pages                                        | **Not ported.** The front end is designed fresh (section 7).                                                      |
| Stripe / billing                                                                           | **Gated** on the LLC.                                                                                             |
| Hardcoded admin emails, `rankedceo.com` sender, legacy project ref                         | **Replaced** by configuration for the new domain.                                                                 |

## 5. Schema principles

The new schema is written from the final legacy state, not by replaying 91 migrations.

- **One definition each.** `profiles`, `subscriptions`, `handle_new_user` and the
  `updated_at` trigger function exist once. No `IF NOT EXISTS` re-creation, no
  drift-reconcile migrations.
- **Right tables, not today's tables.** Overlapping `drafts` columns are consolidated;
  columns nothing reads are not created; names are chosen for what the data is
  (for example `ai_usage`, not `gemini_usage`, since the table also records other providers).
- **Allowlist.** CI fails if a migration creates a table that is not on the owned list.
- **RLS on every user table**, with the policy stated in the migration.
- **Retention is part of every append-only table**, with the job in the same migration set:

| Table (new name decided in the schema PR) | Holds                         | Retention                                                                        |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| listing edit log                          | per-edit audit rows           | **30 days** (owner: edits do not need a long life)                               |
| eBay API call log                         | one row per Browse API call   | **90 days** (enough to size quota trends)                                        |
| eBay rate-limit polls                     | periodic quota snapshots      | **12 months**, then rolled up to daily (owner: longer for later efficiency work) |
| category hygiene log                      | cron run results              | **90 days**                                                                      |
| analysis attempts, AI usage               | per-analysis cost and outcome | **13 months** (annual cost comparison)                                           |
| support tickets                           | user reports                  | kept until closed, then **12 months**                                            |

These are defaults I chose while the owner was away; each is one line to change.

- **Support tickets** get an admin read path (an `admin` role or allowlisted claim and a
  policy), and an admin list screen in the later front end. Users can read their own.
- **Category hygiene** stays only if it does something the taxonomy sync does not. The
  port card for `category-hygiene-cron` decides this; if the sync already covers it, the
  job and its log table are dropped rather than kept as write-only.

## 6. Category regression suite

**Goal:** catch a broken category, condition or aspect rule across domains before a
seller does, instead of discovering them one at a time.

- A fixtures table (or checked-in JSON) holding a small set of deliberately awkward items
  per domain: a coin, bullion, a trading card, clothing, an electronic, jewelry, a general
  item, and edge cases (graded slab, mixed lot, missing condition, wrong-domain title).
  The legacy `test_items` had ~60 rows; the new set starts at **3-4 per domain** and grows
  when a bug is found (each fixed bug adds its fixture).
- Each fixture records the item input and the **expected outcome** (domain, leaf category,
  required aspects, allowed condition codes), not a snapshot of whatever the model returned.
- Two layers: an offline replay against the frozen taxonomy snapshot (runs in CI, no
  credentials, like the legacy corpus gate), and a scheduled monthly run against live
  functions in QA that reports to admins.
- Placeholder URLs and fake prices from the old fixtures are not reused.

## 7. Front end (after the back end)

Not started until the back end is done. The existing standard is the base:
`docs/FRONTEND_UX_STANDARD.md` and `docs/SELLER_EXPERIENCE_BLUEPRINT.md` in
`listrassistr-official` (a new seller experience, not a port; WCAG 2.2 AA; Core Web
Vitals targets; workflow design gate). The owner reviews standards were checked
2026-10-04 and accepts them as current for now.

- **Options first.** For each of the first screens, I produce HTML renderings of options
  for the owner to pick from before any component is written.
- **Fresh and functional.** No legacy layout is carried over. Brand covers voice and copy
  as well as colour: the "Sovereign" and "Teckstart" text and the "Sovereign AI Assistant"
  line in AI output do not survive.
- **Foundations decided once, with options shown:** shared component primitives, token
  source, routing and data fetching, test conventions.

## 8. Order of work (back end)

1. **Foundation.** `supabase/` folder in `listrassistr-official`; consolidated schema
   (auth profile, eBay connection, usage and limits) with retention; shared function
   helpers written once (CORS, auth guard, logger, eBay app token, error shape);
   `config.toml`; CI guards (owned-table allowlist, CRM-name check); port-card template.
2. **eBay connection.** `ebay-user`, `disconnect-ebay`, token refresh and encryption, the
   OAuth slice of publish, the account-deletion webhook; component tests for the connect card.
3. **Listings read path.** `ebay-listings` and inventory sync, carrying the known-SKU
   enumeration, with its log and retention.
4. **Taxonomy and category resolution.** Cache tables, `category-lookup`, taxonomy sync,
   golden corpus and the regression suite from section 6.
5. **Analysis.** `analyze-item` split into modules with `agent-system/`, usage limits and
   the free tier; the "Sovereign" text removed from prompts.
6. **Publish.** Drafts, single publish, then bulk; sequential `LA#####` SKUs from the start.
7. **After migration:** `video-frame-extract`, editor, COGS, market research, repricing
   (re-justified against seller tasks), billing after the LLC.

Each step ends with tests passing, the port cards filled in, and a PR; nothing is deployed
to a provider without the owner.

## 9. Guardrails

- Never run an export, dump, `db pull` or type generation against
  `wcednzaxmxwfiijzmjmx` (the shared legacy project that also holds the CRM).
- Read legacy **migration files** and **code** only.
- No provider, DNS, Stripe, eBay or Supabase dashboard change without explicit owner
  approval; this plan authorizes repository work in `listrassistr-official` only.
- Secrets are never written to the repo, the PRs or chat.
