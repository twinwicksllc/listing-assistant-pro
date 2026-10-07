#!/usr/bin/env bash
# Decides whether the E2E suite has a backend to run against.
#
# The suite creates an auth user, logs in, and (in the smoke test) runs a full AI analysis, so
# it must never run against production by accident. It reads only E2E_-prefixed variables and
# secrets from the "E2E" GitHub environment. Those names exist nowhere at repository level, so
# an unset one cannot fall back to the production values stored there.
#
# Writes configured=true|false to $GITHUB_OUTPUT and exits 0 either way, so a PR is not failed
# by an environment that has not been set up. The reason is printed and added to the run summary.
set -euo pipefail

missing=()
[ -n "${E2E_SUPABASE_URL:-}" ] || missing+=("variable E2E_SUPABASE_URL")
[ -n "${E2E_SUPABASE_ANON_KEY:-}" ] || missing+=("secret E2E_SUPABASE_ANON_KEY")
[ -n "${E2E_SUPABASE_SERVICE_KEY:-}" ] || missing+=("secret E2E_SUPABASE_SERVICE_KEY")
if [ "${E2E_REQUIRE_BASE_URL:-no}" = "yes" ]; then
  [ -n "${E2E_BASE_URL:-}" ] || missing+=("variable E2E_BASE_URL")
fi

out="${GITHUB_OUTPUT:-/dev/null}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "${#missing[@]}" -gt 0 ]; then
  {
    echo "### E2E skipped: not configured"
    echo
    echo "The \`E2E\` GitHub environment is missing:"
    printf -- '- %s\n' "${missing[@]}"
    echo
    echo "Nothing ran. This is expected until a dedicated test backend is set up; the suite is"
    echo "deliberately not pointed at production."
  } | tee -a "$summary"
  echo "configured=false" >> "$out"
  exit 0
fi

# Refuse a URL that looks like the production project, even if someone configures it.
if [ -n "${E2E_FORBIDDEN_REF:-}" ] && printf '%s' "$E2E_SUPABASE_URL" | grep -q "$E2E_FORBIDDEN_REF"; then
  echo "E2E_SUPABASE_URL points at the production project; refusing to run the suite there." >&2
  echo "configured=false" >> "$out"
  exit 1
fi

echo "E2E configuration present."
echo "configured=true" >> "$out"
