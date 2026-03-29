#!/bin/bash
# Quick test: call category-lookup with the anon key to verify it works
source /workspace/listing-assistant-pro/.env

# Remove quotes from env vars
SUPABASE_URL=$(echo $VITE_SUPABASE_URL | tr -d '"')
ANON_KEY=$(echo $VITE_SUPABASE_PUBLISHABLE_KEY | tr -d '"')

echo "Testing category-lookup at $SUPABASE_URL..."
echo ""

curl -s -X POST "$SUPABASE_URL/functions/v1/category-lookup" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "lookup", "itemType": "1889 Morgan Silver Dollar"}' | jq .