#!/usr/bin/env bash
#
# Guards the RBR-0028 class of deploy bug.
#
# Supabase's API gateway enforces JWT verification BEFORE an Edge Function's own
# code runs. A function marked `verify_jwt = false` in supabase/config.toml only
# actually gets that setting if it is also deployed with an explicit
# `--no-verify-jwt` flag -- the bulk `supabase functions deploy` does not reliably
# apply the per-function config. When those two lists drift, the gateway rejects
# any non-JWT bearer token (notably a pg_cron `cron_secret`) with a 401 and ZERO
# function logs, because Deno never starts. That signature is very hard to
# diagnose from the outside; RBR-0028 cost a real investigation on
# competitor-prices-cron.
#
# category-hygiene-cron hit the same trap: 20260824000000 gave it
# requireCronSecret() but never added it to config.toml or the deploy list, so its
# pg_cron job would have 401'd silently the first time it fired.
#
# Two invariants, both cheap to check mechanically:
#   1. config.toml's `verify_jwt = false` set == the explicit --no-verify-jwt
#      deploy list in .github/workflows/deploy-functions.yml
#   2. every function using requireCronSecret() is in that set (a cron_secret is
#      not a JWT, so such a function CANNOT work behind the gateway's JWT gate)
#
# Usage: scripts/verify-function-auth-config.sh
# Exit 0 = consistent, 1 = drift (details on stderr).

set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="supabase/config.toml"
WORKFLOW=".github/workflows/deploy-functions.yml"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Functions marked verify_jwt = false, keyed off the nearest preceding
# [functions.<name>] header.
awk '
  /^\[functions\./ { name = $0; gsub(/^\[functions\.|\]$/, "", name) }
  /verify_jwt = false/ { if (name != "") print name }
' "$CONFIG" | sort -u > "$tmp/config.txt"

# Functions given an explicit --no-verify-jwt deploy line.
grep -o 'functions deploy [a-z-]* --project-ref .* --no-verify-jwt' "$WORKFLOW" \
  | awk '{ print $3 }' | sort -u > "$tmp/deploy.txt"

# Functions that authenticate with the cron secret.
grep -rl 'requireCronSecret' supabase/functions/*/index.ts \
  | sed 's|supabase/functions/||; s|/index.ts||' | sort -u > "$tmp/cron.txt"

status=0

if ! diff -u --label "config.toml (verify_jwt = false)" \
             --label "deploy-functions.yml (--no-verify-jwt)" \
             "$tmp/config.txt" "$tmp/deploy.txt"; then
  echo "ERROR: config.toml and the explicit deploy list have drifted." >&2
  echo "       Every verify_jwt = false function needs BOTH entries, or the" >&2
  echo "       platform JWT gate silently 401s non-JWT callers." >&2
  status=1
else
  echo "OK: $(wc -l < "$tmp/config.txt" | tr -d ' ') functions consistent across both lists."
fi

missing=$(comm -23 "$tmp/cron.txt" "$tmp/config.txt")
if [ -n "$missing" ]; then
  echo "ERROR: these use requireCronSecret() but are not verify_jwt = false:" >&2
  echo "$missing" | sed 's/^/         /' >&2
  echo "       A cron_secret is not a JWT; the gateway will 401 before the" >&2
  echo "       function runs, with no function logs at all." >&2
  status=1
else
  echo "OK: all $(wc -l < "$tmp/cron.txt" | tr -d ' ') requireCronSecret functions are verify_jwt = false."
fi

exit $status
