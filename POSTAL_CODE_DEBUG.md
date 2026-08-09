# Postal Code Persistence Debug

## Step 1: Check Your Profile in Supabase

1. Go to https://supabase.com/dashboard
2. Select **listing-assistant-pro** project
3. Go to **Database** → **profiles** table
4. Find YOUR user row
5. Check these columns:
   - `postal_code`: Should show your ZIP code (e.g., "60046")
   - `city`: Should show your city (e.g., "Chicago")

**If BOTH columns are empty/NULL:**

- Go back to app Settings → Edit Profile
- Enter City: Chicago (or your city)
- Enter ZIP: Your zip code
- Click Save Profile
- Verify the toast says "Profile updated!"
- Then go back to Supabase and refresh the table — the values should appear

**If postal_code has a value but city is empty:**

- The city column might not exist in your database yet
- Proceed to Step 2

---

## Step 2: Add City Column (if missing)

In Supabase dashboard:

1. Click **SQL Editor** (left sidebar)
2. Copy & paste this query:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city TEXT;
```

3. Click Run
4. You should see "Query OK" or similar

---

## Step 3: Clear Stale eBay Location

eBay's "default-location" might be cached with old NYC address. To force an update:

1. Go to eBay Seller Hub
2. Navigate to **Account** → **Shipping locations**
3. Delete your "Default Seller Location" entry (if it exists)
4. Return to Teckstart and publish a new listing — it will recreate the location with your correct city/zip

---

## Step 4: Test the Fix

1. From Dra fts page, create a new listing (or reanalyze an existing one)
2. When you publish, check the browser console (F12 → Console tab) for logs:
   - Look for: `"create_draft: inventory location setup"`
   - Should show: `receivedPostalCode: "60046"` (your zip)
   - Should show: `receivedCity: "Chicago"` (your city)
   - Should show: `isFallback: false`

3. Go to eBay Draft Offers — the location should now be correct

---

## If Still Not Working

Please share:

1. Screenshot of your profile postal_code/city values in Supabase
2. Browser console logs when publishing (F12 → Console, look for "create_draft:" entries)
3. Your Seller Hub Shipping Locations list
