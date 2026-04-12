# Location Data Flow Fix — Step-by-Step Guide

## Problem Summary
Listings are being published with a default location (New York) instead of your configured location (Chicago, 60046). The postal code flows through correctly but the city is missing from the database.

## Root Cause
The migration to add the `city` column to the `profiles` table exists in your codebase but **has not been executed in your Supabase database**.

### Evidence
Logs from your last publish attempt show:
```
create_draft: _debug_postalCode: 60046        ← ✓ Correct
create_draft: _debug_city: undefined          ← ✗ Missing
```

While postal_code is coming through, city is undefined because the database column doesn't exist.

---

## Step 1: Verify Your Current Setup

### Check your profile settings are saved:
1. Go to your app → Settings
2. Click on the Profile section
3. Verify you see:
   - City: (or empty)
   - ZIP / Postal Code: 60046
4. Make note of what's currently entered

### Check Supabase Status:
1. Go to https://supabase.com/dashboard
2. Select your **listing-assistant-pro** project
3. Navigate to **Migrations** tab
4. Look for these two migrations:
   - ✓ `20260314000000_ebay_token_storage_and_auction_duration` (should be green/complete)
   - ? `20260318000000_add_city_to_profiles` (should be green/complete)

If the second one is **not** green or doesn't exist, proceed to Step 2.

---

## Step 2: Execute the Missing Migration

### Option A: Via Supabase Dashboard (Recommended)

1. **Navigate to SQL Editor:**
   - In Supabase dashboard → click **SQL Editor** (left sidebar)

2. **Run this query** (copy & paste):
```sql
-- Add city column to profiles table for eBay inventory location
-- postal_code already exists (from 20260314000000 migration)
-- city is used alongside postal_code when creating the eBay inventory location
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city TEXT;

COMMENT ON COLUMN public.profiles.city IS
  'Seller city — used alongside postal_code for eBay inventory location address';
```

3. **Verify it succeeded:**
   - You should see "SQL executed successfully" or similar
   - No error message should appear

### Option B: Via Local Supabase CLI
```bash
cd /workspaces/listing-assistant-pro
supabase db execute supabase/migrations/20260318000000_add_city_to_profiles.sql
```

---

## Step 3: Verify the Database Column Exists

1. In Supabase dashboard → **Database** (left sidebar)
2. Click on **profiles** table
3. Look for these columns in the column list:
   - `postal_code` (text)
   - `city` (text)

Both should be present now.

---

## Step 4: Re-save Your Profile

1. Go back to your app Settings → Profile
2. In the **Shipping Location** section, enter:
   - **City:** Chicago (or whatever city you want)
   - **ZIP / Postal Code:** 60046
3. Click **Save Profile**
4. You should see: "Profile updated!" confirmation toast

---

## Step 5: Test the Data Flow

### Method A: Check the Database Directly
1. Supabase dashboard → **Database** → **profiles** table
2. Find your user row
3. Verify both columns are populated:
   - `postal_code`: `60046`
   - `city`: `Chicago`

### Method B: Watch Function Logs While Publishing

1. Supabase dashboard → **Functions** → select **ebay-publish**
2. Click on the **Logs** tab
3. Publish a test draft (with a cheap item)
4. Watch the logs in real-time

Look for these log entries:
```
get_stored_token: database query result
  dbPostalCode: 60046
  dbCity: Chicago
```

And later:
```
create_draft: inventory location setup
  receivedPostalCode: 60046
  receivedCity: Chicago
  effectivePostalCode: 60046
  effectiveCity: Chicago
  isFallback: false
```

If you see these values correctly populated, the fix is working!

### Method C: Check the Listing on eBay

1. Publish a test draft
2. Once published, go to the eBay listing
3. Click on "See Details" or scroll to the location section
4. You should see your location (Chicago, 60046) instead of the default

---

## Troubleshooting

### Problem: Still seeing postal code but city is undefined

**Check:**
1. Did the SQL query in Step 2 run successfully? (Look for errors)
2. Did you save your profile again after running the migration?
3. Wait a few seconds and try publishing again (some sync delay is normal)

**If still not working:**
- Check the Supabase function logs for the exact error
- Screenshot the logs and share them

### Problem: Column already exists error

That's fine! This means the migration already ran.Just proceed to Step 3 and verify the data is populated.

### Problem: Profile save shows an error

1. Check the browser console for JavaScript errors
2. Try refreshing the page and saving again
3. Check your network tab in browser DevTools for any failed API calls

---

## Data Flow Diagram

After the fix is applied, here's how location data should flow:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Profile Modal (Your Settings)                             │
│    • You enter: City="Chicago", ZIP="60046"                 │
│    • Click: Save Profile                                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Supabase Database (profiles table)                       │
│    • postal_code: "60046" ✓                                 │
│    • city: "Chicago" ✓                                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. usePublishDraft Hook                                     │
│    • Calls getEbayToken()                                   │
│    • Returns: {token, postalCode: "60046", city: "Chicago"}│
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ebay-publish Function                                    │
│    • Receives: postalCode="60046", city="Chicago"           │
│    • Creates inventory location with both values            │
│    • Sends to eBay API                                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. eBay Listing                                              │
│    • Shows: Location = Chicago, 60046                       │
│    • (Not the default New York fallback)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## What Changed in Code

**Migration added:**
- `supabase/migrations/20260318000000_add_city_to_profiles.sql` adds `city` column

**Code updates for diagnostics:**
- `src/hooks/usePublishDraft.ts` — Enhanced logging in `getEbayToken()`
- `supabase/functions/ebay-publish/index.ts` — Enhanced logging in:
  - `get_stored_token` action (database query details)
  - `create_draft` action (location setup details)

**No breaking changes** — just better visibility into the data flow.

---

## Next Steps

1. ✅ Execute migration in Step 2
2. ✅ Verify database in Step 3
3. ✅ Save profile in Step 4
4. ✅ Test with one draft in Step 5
5. ✅ Publish normally once verified

By following these steps, your listings should now use your configured location (Chicago, 60046) instead of defaulting to New York.

---

## Questions?

If logs show unexpected values or errors:
1. Screenshot the Supabase SQL Editor output
2. Screenshot the Function Logs during publish
3. Share the output — this will help diagnose any remaining issues

