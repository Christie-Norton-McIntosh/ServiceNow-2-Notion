#!/usr/bin/env bash
# Quick PATCH test for managing-favorites page after server-side fixes
set -euo pipefail

PAGE_ID="2b8a89fe-dba5-813d-85f7-d14efd3360f0"
HTML_FILE="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/updated-pages/managing-your-favorites-in-next-experience-2025-11-27T05-52-48.html"
API_URL="http://localhost:3004/api/W2N"

echo "========================================="
echo "PATCH Test: Managing Favorites Page"
echo "========================================="
echo "Page ID: $PAGE_ID"
echo "HTML File: $(basename "$HTML_FILE")"
echo ""

# Step 1: Dry-run validation
echo "1️⃣  Running dry-run validation..."
DRY_RESPONSE=$(curl -s -m 60 -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"test\",\"databaseId\":\"178f8dc43e2780d09be1c568a04d7bf3\",\"content\":$(cat "$HTML_FILE" | jq -Rs .),\"url\":\"https://test.com\",\"dryRun\":true}" \
  2>&1)

DRY_HTTP=$(echo "$DRY_RESPONSE" | tail -n1)
DRY_BODY=$(echo "$DRY_RESPONSE" | sed '$d')

echo "   HTTP Status: $DRY_HTTP"

if [[ "$DRY_HTTP" != "200" ]]; then
  echo "   ❌ Dry-run failed"
  exit 1
fi

HAS_ERRORS=$(echo "$DRY_BODY" | jq -r '.validationResult.hasErrors // false')
IMAGE_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | map(select(.type == "image")) | length')
CALLOUT_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | map(select(.type == "callout")) | length')
BLOCK_COUNT=$(echo "$DRY_BODY" | jq -r '.data.children | length')

echo "   Validation: $([ "$HAS_ERRORS" == "false" ] && echo "✅ PASS" || echo "❌ FAIL")"
echo "   Images: $IMAGE_COUNT (expected: 4)"
echo "   Callouts: $CALLOUT_COUNT (expected: 3)"
echo "   Total blocks: $BLOCK_COUNT (expected: ~45)"
echo ""

# Step 2: Execute PATCH
echo "2️⃣  Executing PATCH..."
PATCH_RESPONSE=$(curl -s -m 180 -w "\n%{http_code}" -X PATCH "$API_URL/$PAGE_ID" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Managing your favorites in Next Experience\",\"contentHtml\":$(cat "$HTML_FILE" | jq -Rs .),\"url\":\"https://www.servicenow.com/docs/bundle/yokohama-platform-user-interface/page/get-started/servicenow-overview/concept/managing-your-favorites.html\"}" \
  2>&1)

PATCH_HTTP=$(echo "$PATCH_RESPONSE" | tail -n1)
PATCH_BODY=$(echo "$PATCH_RESPONSE" | sed '$d')

echo "   HTTP Status: $PATCH_HTTP"

if [[ "$PATCH_HTTP" == "200" ]]; then
  PATCH_SUCCESS=$(echo "$PATCH_BODY" | jq -r '.success // false')
  PATCH_VALIDATION=$(echo "$PATCH_BODY" | jq -r '.validationResult.hasErrors // true')
  
  if [[ "$PATCH_SUCCESS" == "true" && "$PATCH_VALIDATION" == "false" ]]; then
    echo "   ✅ PATCH successful with clean validation"
    
    # Show validation stats
    FINAL_IMAGE_COUNT=$(echo "$PATCH_BODY" | jq -r '.validationResult.stats.images // 0')
    FINAL_CALLOUT_COUNT=$(echo "$PATCH_BODY" | jq -r '.validationResult.stats.callouts // 0')
    FINAL_BLOCK_COUNT=$(echo "$PATCH_BODY" | jq -r '.validationResult.stats.blockCount // 0')
    
    echo ""
    echo "========================================="
    echo "FINAL VALIDATION STATS"
    echo "========================================="
    echo "Images: $FINAL_IMAGE_COUNT"
    echo "Callouts: $FINAL_CALLOUT_COUNT"
    echo "Blocks: $FINAL_BLOCK_COUNT"
    echo ""
    
    # Compare to expected
    [[ "$FINAL_IMAGE_COUNT" == "4" ]] && echo "✅ Image count correct (4)" || echo "⚠️  Image count: expected 4, got $FINAL_IMAGE_COUNT"
    [[ "$FINAL_CALLOUT_COUNT" == "3" ]] && echo "✅ Callout count correct (3)" || echo "⚠️  Callout count: expected 3, got $FINAL_CALLOUT_COUNT"
    
  else
    echo "   ❌ PATCH completed but validation failed"
    echo "$PATCH_BODY" | jq '.validationResult.errors' 2>/dev/null || echo "$PATCH_BODY"
  fi
else
  echo "   ❌ PATCH HTTP error: $PATCH_HTTP"
  echo "$PATCH_BODY"
fi
