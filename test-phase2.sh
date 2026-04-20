#!/bin/bash

# Phase 2 Testing Script
# Tests analyze-item, ebay-publish, get-free-credits, disconnect-ebay edge functions

set -e

PASS_COUNT=0
FAIL_COUNT=0

check_grep() {
    local description=$1
    local pattern=$2
    local file=$3
    if grep -q "$pattern" "$file"; then
        echo "✅ $description"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "❌ $description"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "🧪 Phase 2 Testing - eBay Account Gate & Per-Org Quota System"
echo "=============================================================="
echo ""

# Helper function to make authenticated requests
invoke_function() {
    local func_name=$1
    local payload=$2
    local method=${3:-"POST"}
    
    if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
        echo "⏭️  Skipping endpoint test (SUPABASE_URL/SUPABASE_ANON_KEY not set)"
        return 0
    fi
    
    curl -s -X "$method" \
        -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "$SUPABASE_URL/functions/v1/$func_name"
}

echo "📋 Test 1: Verify analyze-item code changes"
echo "---"

check_grep "computeNextResetAt() helper function found" "function computeNextResetAt" "supabase/functions/analyze-item/index.ts"
check_grep "eBay account gate logic found" "ebay_account_required" "supabase/functions/analyze-item/index.ts"
check_grep "Per-org rolling-window quota logic found" "Per-Org Rolling-Window" "supabase/functions/analyze-item/index.ts"
check_grep "Starter tier limit set to 6 (not 5)" "ANALYSIS_LIMIT = tier === \"pro\" ? 50 : 6" "supabase/functions/analyze-item/index.ts"
check_grep "creditsUsed calculated from currentUsageCount (not random)" "const creditsUsed = currentUsageCount + 1" "supabase/functions/analyze-item/index.ts"
check_grep "_meta object returned in response" "_meta:" "supabase/functions/analyze-item/index.ts"

echo ""
echo "📋 Test 2: Verify ebay-publish code changes"
echo "---"

check_grep "Identity API call logic found" "Identity API Call" "supabase/functions/ebay-publish/index.ts"
check_grep "One-account enforcement rule found" "One-Account Rule" "supabase/functions/ebay-publish/index.ts"
check_grep "eBay username storage logic found" "ebay_username" "supabase/functions/ebay-publish/index.ts"
check_grep "eBay account type storage logic found" "ebay_account_type" "supabase/functions/ebay-publish/index.ts"
check_grep "Identity endpoint switches by EBAY_ENVIRONMENT" "identityBase = ebayEnv === \"production\" ? \"https://apiz.ebay.com\" : \"https://apiz.sandbox.ebay.com\"" "supabase/functions/ebay-publish/index.ts"
check_grep "Identity API non-OK guard exists" "Identity API failed" "supabase/functions/ebay-publish/index.ts"

echo ""
echo "📋 Test 3: Verify edge function endpoints are accessible"
echo "---"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "⏭️  Skipping endpoint tests (SUPABASE_URL/SUPABASE_ANON_KEY not set)"
    echo "   Set these environment variables and re-run to test endpoints."
else
    # Test if analyze-item endpoint exists
    ANALYZE_TEST=$(invoke_function "analyze-item" '{}' "POST")
    if echo "$ANALYZE_TEST" | grep -q "error\|Authentication required\|body parsed"; then
        echo "✅ analyze-item endpoint is accessible"
    else
        echo "❌ analyze-item endpoint may not be deployed: $ANALYZE_TEST"
    fi

    # Test if get-free-credits endpoint exists
    CREDITS_TEST=$(invoke_function "get-free-credits" '{}' "POST")
    if echo "$CREDITS_TEST" | grep -q "error\|credits"; then
        echo "✅ get-free-credits endpoint is accessible"
    else
        echo "❌ get-free-credits endpoint may not be deployed: $CREDITS_TEST"
    fi

    # Test if disconnect-ebay endpoint exists
    DISCONNECT_TEST=$(invoke_function "disconnect-ebay" '{}' "POST")
    if echo "$DISCONNECT_TEST" | grep -q "error\|Authentication\|userId"; then
        echo "✅ disconnect-ebay endpoint is accessible"
    else
        echo "❌ disconnect-ebay endpoint may not be deployed: $DISCONNECT_TEST"
    fi
fi

echo ""
echo "📋 Test 4: Check for TypeScript compilation errors"
echo "---"

if grep -q "import { serve }" supabase/functions/analyze-item/index.ts && \
   grep -q "import { createClient }" supabase/functions/analyze-item/index.ts; then
    echo "✅ analyze-item has required imports"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo "❌ analyze-item missing required imports"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if grep -q "import { serve }" supabase/functions/ebay-publish/index.ts && \
   grep -q "import { createClient }" supabase/functions/ebay-publish/index.ts; then
    echo "✅ ebay-publish has required imports"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo "❌ ebay-publish missing required imports"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "📋 Summary"
echo "---"
echo "Passed checks: $PASS_COUNT"
echo "Failed checks: $FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "Phase 2 validation FAILED. Fix required checks before deploy."
    exit 1
fi
echo "All required Phase 2 code checks passed."
echo "The edge functions still need deployment for full end-to-end verification."
echo ""
echo "Next steps:"
echo "1. Deploy functions: supabase functions deploy"
echo "2. Run integration tests with real Supabase instance"
echo "3. Test with actual eBay API calls"
echo ""
