#!/bin/bash
# Run all 60 test cases from category-test-fixtures.json against production category-lookup
source /workspace/listing-assistant-pro/.env

SUPABASE_URL=$(echo $VITE_SUPABASE_URL | tr -d '"')
ANON_KEY=$(echo $VITE_SUPABASE_PUBLISHABLE_KEY | tr -d '"')
FIXTURES="/workspace/listing-assistant-pro/supabase/functions/_tests/category-test-fixtures.json"

TOTAL=0
PASS=0
FAIL=0
NONLEAF=0
ERRORS=0

# Results file
RESULTS="/workspace/listing-assistant-pro/test-results.txt"
echo "CATEGORY LOOKUP TEST RESULTS - $(date -u)" > "$RESULTS"
echo "================================================================" >> "$RESULTS"
echo "" >> "$RESULTS"

# Parse each test case from JSON
COUNT=$(jq '.cases | length' "$FIXTURES")

for i in $(seq 0 $((COUNT - 1))); do
  ID=$(jq -r ".cases[$i].id" "$FIXTURES")
  GROUP=$(jq -r ".cases[$i].group" "$FIXTURES")
  INPUT=$(jq -r ".cases[$i].input" "$FIXTURES")
  EXPECTED=$(jq -r ".cases[$i].expectedCategoryId" "$FIXTURES")
  EXPECTED_BREAD=$(jq -r ".cases[$i].expectedBreadcrumb" "$FIXTURES")

  # Call category-lookup
  RESP=$(curl -s -X POST "$SUPABASE_URL/functions/v1/category-lookup" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"action\": \"lookup\", \"itemType\": \"$INPUT\"}" 2>/dev/null)

  ACTUAL=$(echo "$RESP" | jq -r '.categoryId // "NONE"')
  ACTUAL_NAME=$(echo "$RESP" | jq -r '.categoryName // "?"')
  SOURCE=$(echo "$RESP" | jq -r '.source // "?"')
  SCORE=$(echo "$RESP" | jq -r '.effectiveScore // "?"')
  LEAF=$(echo "$RESP" | jq -r '.verifiedLeaf // "null"')
  REASON=$(echo "$RESP" | jq -r '.reasonSelected // "?"')
  ERROR=$(echo "$RESP" | jq -r '.error // empty')

  TOTAL=$((TOTAL + 1))

  if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    STATUS="ERROR"
    ERRORS=$((ERRORS + 1))
  elif [ "$ACTUAL" = "$EXPECTED" ]; then
    STATUS="PASS"
    PASS=$((PASS + 1))
  else
    STATUS="FAIL"
    FAIL=$((FAIL + 1))
  fi

  if [ "$LEAF" = "false" ]; then
    NONLEAF=$((NONLEAF + 1))
  fi

  # Print live
  if [ "$STATUS" = "PASS" ]; then
    echo "  ✓ [$ID] $INPUT → $ACTUAL ($SOURCE, score=$SCORE)"
  elif [ "$STATUS" = "ERROR" ]; then
    echo "  ✗ [$ID] $INPUT → ERROR: $ERROR"
  else
    echo "  ✗ [$ID] $INPUT → got $ACTUAL ($ACTUAL_NAME), expected $EXPECTED"
  fi

  # Log to file
  echo "[$STATUS] $ID ($GROUP)" >> "$RESULTS"
  echo "  Input:    $INPUT" >> "$RESULTS"
  echo "  Expected: $EXPECTED ($EXPECTED_BREAD)" >> "$RESULTS"
  echo "  Actual:   $ACTUAL ($ACTUAL_NAME)" >> "$RESULTS"
  echo "  Source:   $SOURCE | Score: $SCORE | Leaf: $LEAF" >> "$RESULTS"
  echo "  Reason:   $REASON" >> "$RESULTS"
  if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "  ERROR:    $ERROR" >> "$RESULTS"
  fi
  echo "" >> "$RESULTS"

  # Small delay to avoid rate limiting
  sleep 0.3
done

echo ""
echo "================================================================"
echo "  SUMMARY"
echo "================================================================"
echo "  Total:      $TOTAL"
echo "  Passed:     $PASS ($((PASS * 100 / TOTAL))%)"
echo "  Failed:     $FAIL"
echo "  Errors:     $ERRORS"
echo "  Non-leaf:   $NONLEAF"
echo "================================================================"

# Also append summary to results file
echo "" >> "$RESULTS"
echo "================================================================" >> "$RESULTS"
echo "SUMMARY" >> "$RESULTS"
echo "  Total:      $TOTAL" >> "$RESULTS"
echo "  Passed:     $PASS ($((PASS * 100 / TOTAL))%)" >> "$RESULTS"
echo "  Failed:     $FAIL" >> "$RESULTS"
echo "  Errors:     $ERRORS" >> "$RESULTS"
echo "  Non-leaf:   $NONLEAF" >> "$RESULTS"
echo "================================================================" >> "$RESULTS"