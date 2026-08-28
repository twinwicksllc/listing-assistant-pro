# Progressive Autonomy for the eBay Listing Agent

**Status:** Backlog — planning only. No branch, no implementation, not scheduled.
Unrelated to the ListrAssistr rebrand; safe to pick up independently, on this repo
or the post-migration one, whenever there's a dedicated slot for it.

## Objective

Let sellers opt into higher levels of automation (pricing, photo enhancement,
draft generation, batch publishing) while preserving trust, auditability, and
human control, structured around the Six UX Patterns for AI Agents framework:
Intent Capture, Thought Trace, Risk-Tiered Approval, Escalation, Observability,
Memory Governance.

## Relationship to what already exists in this codebase

This isn't a green-field feature — it overlaps with things already built or
already decided:

- **`FEATURE_TODO.md` Feature #6 ("Auto-Optimization")** already plans
  `reprice_rules`, `optimization_suggestions`, `relist_history`, and
  `bulk-reprice`/`ebay-relist` functions. That's the same surface area as this
  plan's pricing autonomy tier. **Don't build two parallel repricing systems** —
  when this is picked up, reconcile against Feature #6 first; either this plan
  supersedes it or Feature #6's tables become the "reversible action" substrate
  this plan's approval layer sits on top of.
- **DEC-0017** (`REBRAND_PHASE_0_DECISION_LOG.md`) already records an owner
  decision that `auto-reprice-cron` will **not** be scheduled — unattended
  repricing alters live eBay prices, full stop. **Confirmed by the owner: this
  stands, no override.** Automated/unattended pricing changes are explicitly
  out of scope for this agent's autonomy design — pricing actions live
  permanently in the Explicit Confirmation Gate tier (Pattern 3), never in
  auto-approve, regardless of plan tier or seller opt-in. Don't design an
  auto-approve pricing path "for later" — there is no later for this.
- **The six-stage `analyze-item` pipeline** (identification → category
  resolution → aspects → generation → verification → regeneration) and the
  category-resolver v2 precedence logic are the thing being wrapped in
  autonomy controls, not replaced. This plan adds a permission/approval/audit
  layer around outputs of that pipeline — it doesn't change the pipeline.
- **RAG grounding** (`_helpers/rag/`, pgvector `knowledge_base` table) and
  `category_aspects_cache`/`competitor_prices` caches are exactly the kind of
  state the Memory Governance deletion pipeline (pattern 6) has to reach —
  scope that against the real cache/table list at implementation time, not
  against a guess.
- **Plan-tier gating** (`PLANS` in `src/contexts/AuthContext.tsx`) is the
  existing mechanism for gating features by subscription tier — autonomy
  levels should slot into that, not invent a second gating system.

## Pattern 1 — Intent Capture & Scoped Permissions

- New settings surface (e.g. `src/v2/pages/AgentSettingsPage.tsx`) where a
  seller defines operational boundaries before any autonomy is enabled.
- Data model: `agent_permissions` (`user_id`/`org_id`, `category_scopes text[]`,
  `min_floor_price numeric`, `max_daily_auto_listings int`,
  `auto_publish_threshold numeric`, `can_read_comps boolean`,
  `can_write_publish boolean`, `updated_at`).
- Separate read vs. write permission: "analyze comps & draft" is a different
  grant from "publish directly to eBay" — model as two booleans or a small
  enum, not one on/off switch.
- Any instruction derived from an external/scraped source (competitor listing
  text, a scraped comp description) must render a confirmation step before
  it's trusted as an input — this is the prompt-injection/bad-data guard, and
  it applies to the same data `ebay-competitor-search`/`competitor-prices-cron`
  already pull in.

## Pattern 2 — Thought Trace & Verifiable Evidence

- New table: `agent_decision_trace` (`draft_id`, `decision_type` — category,
  condition, title_keywords, starting_price — `reasoning_text`,
  `cited_sources jsonb` [comp row ids from `competitor_prices`/
  `market_price_history`, image attribute refs], `confidence_score`,
  `created_at`).
- UI: a "Thought Trace" drawer, scannable, one entry per decision, each with a
  deep link into the cited comp/attribute so the seller can verify without
  leaving the page (link into the same rows `PriceTrendChart`/
  `MarketWatchCard` already render, if Feature #5 ships first).

## Pattern 3 — Risk-Tiered Approvals

- Action taxonomy split into two tiers by blast radius:
  - **Auto-approve / reversible:** image background cleanup, category
    tagging, draft creation, standard SEO description — all with 1-click undo.
  - **Explicit confirmation gate:** publishing above a seller-set value
    threshold, bulk price updates, accepting a below-target best offer,
    returns handling. Per DEC-0017, **any pricing action — including
    bulk/offer/floor-price changes — stays in this tier permanently.** This is
    not a staged rollout toward eventual auto-approve; it's a hard boundary.
- Diff view: Original vs. Agent-Suggested, side by side, with
  Approve / Modify / Reject controls per field, not just per listing.

## Pattern 4 — Escalation Flow & Async Inbox

- New table: `agent_escalations` (`draft_id`, `trigger_type` — enum:
  `low_confidence_condition`, `counterfeit_risk`, `ambiguous_variation`,
  `missing_item_specifics`, `price_outlier` — `context_package jsonb`
  [what was attempted, extracted metadata, confidence scores, the specific
  blocker], `status`, `resolved_at`).
- "Needs Review" queue UI (async — the agent doesn't block on it), and a
  "Return to Agent" action once the seller resolves the blocker, so the
  pipeline resumes from where it stopped rather than restarting.

## Pattern 5 — Observability & Health Telemetry

- Event schema: `agent_events` (`event_type`, `listing_id`, `model`, `tool`,
  `latency_ms`, `api_cost_usd`, `blocked boolean`, `created_at`) — same shape
  of thing `gemini_usage` already tracks for cost, extended to cover
  success/failure and latency per action, not just per API call.
- **Key metric: human override/edit rate per attribute** (pricing, condition,
  title) — requires diffing the agent-suggested value against the final saved
  value per field. This is the signal that catches both model degradation and
  seller rubber-stamping; it needs its own comparison, not just an audit log,
  since "the seller didn't touch it" and "the seller approved it" look
  identical in a plain approval log.

## Pattern 6 — Memory Governance & Provenance

- `seller_agent_preferences` table: default shipping/handling policy, template
  styling, return policy, preferred margin target — check first whether any of
  this already lives elsewhere (e.g. business policies fetched live via
  `ebay-publish/auth.ts` rather than stored locally) to avoid a second source
  of truth for the same setting.
- Provenance surfacing: when a stored preference shapes a draft, say so inline
  ("Applied your standard 3-day handling policy") rather than leaving it
  silent.
- Deletion pipeline: deleting a preference or template in the UI must purge it
  from the pgvector `knowledge_base` store, from `category_aspects_cache`-style
  caches if preferences ever get baked into cached prompts, and from any
  in-flight agent context window — audit the real cache/table list at
  implementation time against this list, since caches get added over time.

## Deliverables (for whenever this is picked up)

1. **Data schema** — the six tables sketched above
   (`agent_permissions`, `agent_decision_trace`, `agent_escalations`,
   `agent_events`, `seller_agent_preferences`, plus whatever Feature #6
   reconciliation produces for reprice/relist), with FKs to `drafts`/
   `profiles`/`organizations` and RLS following the existing pattern for
   user-scoped tables.
2. **Wireframes** — Seller Approval/Diff Inbox (queue list → per-item diff →
   Approve/Modify/Reject) and the Thought Trace drawer (per-decision list →
   cited-source deep link). Sketch these against the existing v2 component
   library (`src/v2/components/`) rather than from scratch.
3. **API contract** — an action taxonomy shape shared by both the diff inbox
   and the escalation queue, e.g. `{ action_type, blast_radius: "reversible" |
"gated", reversible: boolean, requires_confirmation: boolean, undo_token? }`,
   plus the escalation `context_package` shape from Pattern 4.

## Open questions to resolve before a branch is opened

- Reconcile with `FEATURE_TODO.md` Feature #6 — same tables, don't duplicate.
- Decide plan-tier gating (which `PLANS` tier unlocks which autonomy level) —
  scoped to the non-pricing autonomy tiers only, per the DEC-0017 boundary
  above.
- Budget the extra LLM calls Thought Trace generation implies — it's a new
  cost line per decision, not per listing.
