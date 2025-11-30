#!/usr/bin/env bash
# Diagnostic: Check validation response for managing-favorites page
set -euo pipefail

HTML_FILE="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/managing-your-favorites-in-next-experience-2025-11-27T05-52-48.html"
API_URL="http://localhost:3004/api/W2N"

echo "========================================="
echo "VALIDATION DIAGNOSTIC"
echo "========================================="
echo "File: $(basename "$HTML_FILE")"
echo ""

# Run dry-run to get validation result
echo "Running dry-run validation..."
DRY_RESPONSE=$(curl -s -m 60 -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"test\",\"databaseId\":\"178f8dc43e2780d09be1c568a04d7bf3\",\"content\":$(cat "$HTML_FILE" | jq -Rs .),\"url\":\"https://test.com\",\"dryRun\":true}" \
  2>&1)

DRY_HTTP=$(echo "$DRY_RESPONSE" | tail -n1)
DRY_BODY=$(echo "$DRY_RESPONSE" | sed '$d')

echo ""
echo "========================================="
echo "HTTP RESPONSE"
echo "========================================="
echo "Status: $DRY_HTTP"
echo ""

if [[ "$DRY_HTTP" != "200" ]]; then
  echo "❌ HTTP error - cannot validate"
  echo "$DRY_BODY" | head -n 20
  exit 1
fi

echo "========================================="
echo "VALIDATION RESULT"
echo "========================================="

HAS_ERRORS=$(echo "$DRY_BODY" | jq -r '.validationResult.hasErrors // "MISSING"')
echo "hasErrors: $HAS_ERRORS"
echo ""

if [[ "$HAS_ERRORS" == "true" ]]; then
  echo "❌ VALIDATION FAILED (hasErrors=true)"
  echo ""
  
  ERROR_COUNT=$(echo "$DRY_BODY" | jq -r '.validationResult.issues | length')
  echo "Error count: $ERROR_COUNT"
  echo ""
  echo "Errors:"
  echo "$DRY_BODY" | jq -r '.validationResult.issues[]' | head -n 10
  echo ""
elif [[ "$HAS_ERRORS" == "false" ]]; then
  echo "✅ VALIDATION PASSED (hasErrors=false)"
  echo ""
  WARNING_COUNT=$(echo "$DRY_BODY" | jq -r '.validationResult.warnings | length')
  echo "Warning count: $WARNING_COUNT"
  if [[ "$WARNING_COUNT" -gt 0 ]]; then
    echo "Warnings:"
    echo "$DRY_BODY" | jq -r '.validationResult.warnings[]' | head -n 5
  fi
else
  echo "⚠️  VALIDATION RESULT MISSING OR MALFORMED"
  echo "hasErrors value: $HAS_ERRORS"
  echo ""
  echo "Full validationResult object:"
  echo "$DRY_BODY" | jq '.validationResult' 2>/dev/null || echo "Failed to parse"
fi

echo ""
echo "========================================="
echo "ELEMENT COUNTS"
echo "========================================="

IMAGE_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | map(select(.type == "image")) | length')
CALLOUT_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | map(select(.type == "callout")) | length')
BLOCK_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | length')
TABLE_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | map(select(.type == "table")) | length')

echo "Blocks: $BLOCK_COUNT"
echo "Images: $IMAGE_COUNT"
echo "Callouts: $CALLOUT_COUNT"
echo "Tables: $TABLE_COUNT"
echo ""

# Extract expected counts from HTML comment
echo "========================================="
echo "EXPECTED VS ACTUAL (from HTML comment)"
echo "========================================="
echo "From HTML comment header:"
grep -m1 "Validation Errors:" "$HTML_FILE" | sed 's/.*Validation Errors: /  Errors: /' || echo "  (no errors line)"
grep -m1 "Warnings:" "$HTML_FILE" | sed 's/.*Warnings: /  Warnings: /' || echo "  (no warnings line)"
echo ""

echo "Current extraction:"
echo "  Images: $IMAGE_COUNT (comment says: expected 4, got 3)"
echo "  Callouts: $CALLOUT_COUNT (comment says: expected 3, got 6)"
echo "  Blocks: $BLOCK_COUNT (comment says: expected ≤45, got 49)"
echo ""

# Decision
echo "========================================="
echo "DECISION"
echo "========================================="
if [[ "$HAS_ERRORS" == "false" ]]; then
  echo "✅ Current validation PASSES - file would move to updated-pages/"
  echo "   This seems WRONG given the errors in the HTML comment."
  echo "   Possible causes:"
  echo "   1. Server-side fixes already applied (inline icons filtered, callouts deduped)"
  echo "   2. Validation thresholds too permissive"
  echo "   3. HTML comment reflects OLD extraction before fixes"
elif [[ "$HAS_ERRORS" == "true" ]]; then
  echo "❌ Current validation FAILS - file would stay in pages-to-update/"
  echo "   This is CORRECT - page should not pass with these errors."
else
  echo "⚠️  Cannot determine - validation response unclear"
fi

echo ""
echo "Saving full response to /tmp/managing-favorites-validation-diagnostic.json"
echo "$DRY_BODY" | jq '.' > /tmp/managing-favorites-validation-diagnostic.json
