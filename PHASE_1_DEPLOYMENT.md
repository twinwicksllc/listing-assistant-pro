## Phase 1 Deployment Guide

**File:** `supabase/migrations/20260318100000_free_tier_tracking.sql`  
**Purpose:** Database schema changes for per-org rolling-window credit tracking and eBay metadata storage  
**Status:** Ready for staging deployment

---

### What This Migration Does

#### 1. **profiles** table additions
- `ebay_username TEXT` — Store connected eBay account username (write: exchange_code only)
- `ebay_account_type TEXT` — Store eBay account type from Identity API ('individual' | 'business')

#### 2. **organizations** table addition
- `free_tier_reset_day SMALLINT (1-31)` — Day-of-month when this org's credits reset (set at org creation, immutable thereafter)

#### 3. **usage_tracking** table addition
- `org_id TEXT` — Link each usage event to the org that performed it (enables per-org quota counting)
- `idx_usage_tracking_org_action_ts` index — Fast queries on (org_id, action_type, created_at) for rolling-window counts

#### 4. **Backfill existing rows**
- All existing `usage_tracking` rows WITHOUT `org_id` are attributed to the user's earliest org membership

#### 5. **PL/pgSQL function: get_free_tier_window_start()**
- Computes the rolling-window start date for a given `reset_day`
- Clamps day 31 → Feb 28/29 (handles months with fewer than 31 days)
- Returns UTC timestamp marking the start of the current credit period

#### 6. **subscriptions table RLS**
- Enables RLS and adds SELECT policy (users can only read their own subscription)
- Protects against cross-org subscription reads from the client

#### 7. **handle_new _user trigger update** (MANUAL)
- Must be updated to set `free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT` when a new org is created

---

### Pre-Deployment Checklist

Before applying to staging or production:

- [ ] 1. Verify `on_auth_user_created` trigger exists (calls `handle_new_user()` function)
  ```sql
  -- Check if trigger exists
  -- NOTE: Function is named handle_new_user(), but trigger is on_auth_user_created
  SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
  ```

- [ ] 2. Examine the trigger body and the associated function
  ```sql
  -- Get the full trigger definition:
  SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'on_auth_user_created';
  
  -- Get the function source code:
  SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'handle_new_user';
  ```

- [ ] 3. Inspect the `subscriptions` table schema to confirm `user_id` column name matches our RLS policy
  ```sql
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'subscriptions' AND column_name = 'user_id';
  ```

---

### Deployment Steps

#### Step 1: Apply migration to staging
```bash
# From workspace root:
supabase migration up --db-url "postgresql://<staging_db_connection_string>"
```

Or use the Supabase dashboard → Migrations → select migration file → Apply.

#### Step 2: Verify migration success
```sql
-- Check new columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name IN ('profiles', 'organizations', 'usage_tracking');

-- Check function created
SELECT proname FROM pg_proc 
WHERE proname = 'get_free_tier_window_start';

-- Check index created
SELECT indexname FROM pg_indexes 
WHERE indexname = 'idx_usage_tracking_org_action_ts';

-- Check RLS policy on subscriptions
SELECT * FROM pg_policies 
WHERE tablename = 'subscriptions' AND policyname LIKE 'Users can%';
```

#### Step 3: Manually update handle_new_user() function
**REQUIRED MANUAL STEP** — The function currently creates the personal org but does NOT set `free_tier_reset_day`. Add this UPDATE after the org INSERT:

1. Get the current function definition:
   ```sql
   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'handle_new_user';
   ```

2. Locate the section where it inserts the personal org (in the ELSE block):
   ```sql
   INSERT INTO public.organizations (id, name, owner_id)
   VALUES (
     gen_random_uuid(),
     split_part(NEW.email, '@', 1) || '''s Team',
     NEW.id
   )
   RETURNING id INTO new_org_id;
   ```

3. **After the INSERT...RETURNING**, add this UPDATE to set the reset day:
   ```sql
   UPDATE public.organizations
     SET free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT
     WHERE id = new_org_id;
   ```

   **Updated function (paste this):**
   ```sql
   CREATE OR REPLACE FUNCTION public.handle_new_user()
   RETURNS trigger
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
   AS $function$
   DECLARE
     new_org_id    uuid;
     pending_invite RECORD;
   BEGIN
     -- 7a. Upsert profile (safe — never fails even if row exists)
     INSERT INTO public.profiles (id, display_name, created_at, updated_at)
     VALUES (
       NEW.id,
       COALESCE(
         NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
         NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
         split_part(NEW.email, '@', 1)
       ),
       now(),
       now()
     )
     ON CONFLICT (id) DO NOTHING;

     -- 7b. Check for a pending invitation for this email
     SELECT * INTO pending_invite
     FROM public.org_invitations
     WHERE email = NEW.email AND status = 'pending'
     LIMIT 1;

     IF pending_invite IS NOT NULL THEN
       -- Invited user: join the inviting org as lister
       INSERT INTO public.org_members (org_id, user_id, role)
       VALUES (pending_invite.org_id, NEW.id, 'lister')
       ON CONFLICT (org_id, user_id) DO NOTHING;

       UPDATE public.org_invitations
       SET status = 'accepted'
       WHERE id = pending_invite.id;

     ELSE
       -- New independent user: create personal org and make them owner
       BEGIN
         INSERT INTO public.organizations (id, name, owner_id)
         VALUES (
           gen_random_uuid(),
           split_part(NEW.email, '@', 1) || '''s Team',
           NEW.id
         )
         RETURNING id INTO new_org_id;

         -- NEW: Set the free tier reset day to today (OQ-2: anchor at account creation)
         UPDATE public.organizations
           SET free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT
           WHERE id = new_org_id;

         INSERT INTO public.org_members (org_id, user_id, role)
         VALUES (new_org_id, NEW.id, 'owner');

       EXCEPTION WHEN OTHERS THEN
         RAISE WARNING 'handle_new_user: failed to create org for user % — %', NEW.id, SQLERRM;
       END;
     END IF;

     RETURN NEW;
   END;
   $function$;
   ```

#### Step 4: Test the function in staging
```sql
-- Test get_free_tier_window_start for various reset days
SELECT 
  1 as reset_day,
  public.get_free_tier_window_start(1)::date as window_start;

SELECT 
  31 as reset_day,
  public.get_free_tier_window_start(31)::date as window_start;

-- Verify it returns a date in the current or previous month
```

#### Step 5: Verify backfill success
```sql
-- Check how many rows were backfilled
SELECT COUNT(*) as backfilled_rows 
FROM public.usage_tracking 
WHERE org_id IS NOT NULL;

-- Spot-check a few rows
SELECT user_id, action_type, created_at, org_id 
FROM public.usage_tracking 
WHERE org_id IS NOT NULL 
LIMIT 5;
```

---

### Production Deployment (After Staging Validation)

1. Apply the same migration to production
2. Manually update `handle_new_user` trigger on production (same as Step 3 above)
3. Verify backfill on production

---

### Rollback Plan (If Needed)

```sql
-- Remove columns and function (reverse migration)
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS ebay_username,
  DROP COLUMN IF EXISTS ebay_account_type;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS free_tier_reset_day;

ALTER TABLE public.usage_tracking
  DROP COLUMN IF EXISTS org_id;

DROP INDEX IF EXISTS public.idx_usage_tracking_org_action_ts;
DROP FUNCTION IF EXISTS public.get_free_tier_window_start(SMALLINT);

-- Revert handle_new_user trigger to previous version
-- (Depends on what the previous version was; check git history)
```

---

### Next Steps After Phase 1

Once Phase 1 is deployed and verified on staging:

1. **Phase 2 Pre-Coding Prerequisites** (must complete before any edge function changes):
   - Add `commerce.identity.readonly` OAuth scope to `get_auth_url`
   - Remove `recordUsage('ai_analysis')` at line 151 of AnalyzePage.tsx
   - Verify subscriptions RLS policy is working
   - Refactor tier detection in analyze-item to reduce Stripe calls

2. **Phase 2 Edge Functions** — Implementation begins on:
   - `analyze-item/index.ts` — Add eBay gate, per-org quota logic, field allowlist
   - `ebay-publish/index.ts` — Add Identity API call and one-account enforcement
   - New `get-free-credits/index.ts` — Lightweight credit status endpoint
   - New `disconnect-ebay/index.ts` — Server-side eBay account disconnect

---

### Troubleshooting

**Problem:** Migration fails with "column already exists"
- **Solution:** The `IF NOT EXISTS` clauses should prevent this. If it recurs, verify the migration hasn't already been applied.

**Problem:** Backfill finds 0 rows
- **Solution:** This is expected if there's no usage data yet. Not a problem.

**Problem:** `get_free_tier_window_start()` returns wrong date
- **Solution:** Verify the function logic against the PL/pgSQL definition. Test with various reset days (1, 15, 28, 29, 30, 31).

**Problem:** RLS policy not taking effect
- **Solution:** Verify the subscriptions table has RLS enabled: `SELECT * FROM pg_tables WHERE tablename = 'subscriptions';` (should show `rowsecurity = t`).

