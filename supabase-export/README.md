Run the Supabase storage export script

Usage

Set the required environment variables and run the npm script:

```bash
# temporary env (one-shot)
SERVICE_ROLE_KEY='your_service_role_key' SUPABASE_URL='https://wcednzaxmxwfiijzmjmx.supabase.co' npm run export

# or export into the session, then run
export SERVICE_ROLE_KEY='your_service_role_key'
export SUPABASE_URL='https://wcednzaxmxwfiijzmjmx.supabase.co'
npm run export
```

Security

- Do not commit `SERVICE_ROLE_KEY` to source control.
- Use CI secrets or your environment's secret manager for automation.
- Do not commit `storage_objects.json` either -- it contains real object
  paths, owner UUIDs, and etags for every file in the project's storage
  buckets. `.gitignore` excludes it, but don't fight that by force-adding it.
  Keep exports on local disk only.

Notes

- The script writes `storage_objects.json` to the current working directory.
- The script expects `node` (v18+) and the dependencies installed (`npm install`).
